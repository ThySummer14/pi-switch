import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const coreDir = process.env.PI_SWITCH_CORE_DIR || join(import.meta.dirname, "..", "src");
const fromCore = file => import(pathToFileURL(join(coreDir, file)).href);

const providers = await fromCore("providers.js");
const store = await fromCore("store.js");
const mcp = await fromCore("mcp.js");
const skills = await fromCore("skills.js");
const agents = await fromCore("agents.js");
const profiles = await fromCore("profiles.js");
const doctor = await fromCore("doctor.js");
const keychain = await fromCore("keychain.js");
const importer = await fromCore("import-ccswitch.js");
const transfer = await fromCore("config-transfer.js");
const providerCatalog = await fromCore("provider-catalog.js");
const { createModelDefaults } = await fromCore("model-capabilities.js");
const { spawn } = await import("node:child_process");

function publicProvider(row) {
  return {
    name: row.name,
    api: row.api,
    baseUrl: row.baseUrl,
    keyOk: row.keyOk,
    keySource: row.keySource,
    keyError: row.keyError,
    keyInline: row.keyInline,
    models: row.models,
    modelObjects: row.modelObjects,
    isDefault: row.isDefault,
    defaultModel: row.defaultModel,
  };
}

function keyStorageKind(spec) {
  if (typeof spec !== "string" || !spec) return "missing";
  if (spec.startsWith("!")) return "command";
  if (spec.startsWith("$")) return "environment";
  return "inline";
}

function publicProviderMutation(name, provider) {
  return {
    name,
    api: provider.api,
    baseUrl: provider.baseUrl,
    modelCount: provider.models?.length || 0,
    keyStorage: keyStorageKind(provider.apiKey),
  };
}

function dashboard() {
  const settings = store.loadSettings();
  const catalog = providerCatalog.getProviderCatalog();
  let profileRows = [];
  try {
    profileRows = profiles.listProfiles({ currentCwd: homedir(), useDesktopCwd: true });
  } catch {
    // Doctor reports the concrete profile config error.
  }
  const workspaceCwd = profileRows.find(profile => profile.isDefault)?.cwd
    || profileRows[0]?.cwd
    || homedir();
  return {
    providers: providers.listProviders().map(publicProvider),
    settings: {
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      defaultThinkingLevel: settings.defaultThinkingLevel,
    },
    mcp: mcp.listServers(workspaceCwd).map(({ env, ...row }) => row),
    skillPaths: skills.listSkillPaths(),
    skillCatalog: skills.listSkills(),
    agents: agents.listAgents(workspaceCwd),
    profiles: profileRows,
    workspaceCwd,
    apiTypes: providers.API_TYPES,
    thinkingLevels: providers.THINKING_LEVELS,
    providerPresets: catalog.presets,
    providerCatalog: catalog.status,
    keychainAvailable: process.platform === "darwin",
    ccSwitchAvailable: importer.ccSwitchAvailable(),
  };
}

function modelDefaults(id, providerName, patch = {}) {
  return createModelDefaults(id, providerName, patch);
}

function piBinary() {
  if (process.env.PI_SWITCH_PI_BIN) return process.env.PI_SWITCH_PI_BIN;
  const local = join(homedir(), ".local", "bin", "pi");
  return existsSync(local) ? local : "pi";
}

function appendLimited(current, chunk, limit = 8_000) {
  return `${current}${chunk}`.slice(-limit);
}

function cleanProbeError(stdout, stderr, secret) {
  let text = `${stderr}\n${stdout}`.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (secret) text = text.split(secret).join("[REDACTED]");
  return text.slice(-2_000) || "Pi 未返回具体错误";
}

function runPiPrint(row, { timeoutMs = 30_000 } = {}) {
  const model = row.defaultModel || row.models[0];
  if (!model) return Promise.resolve({ ok: false, ms: 0, error: "这个 Provider 尚未配置模型" });
  const secret = store.resolveApiKey(row.apiKeySpec).value;
  const args = [
    "--print",
    "--no-session",
    "--no-tools",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
    "--thinking", "off",
    "--provider", row.name,
    "--model", model,
    "Reply with OK.",
  ];
  const started = Date.now();
  return new Promise(resolve => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(piBinary(), args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => { stdout = appendLimited(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = appendLimited(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ ok: false, ms: Date.now() - started, model, error: error.message });
    });
    child.on("close", code => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (timedOut) resolve({ ok: false, ms, model, error: `真实调用 ${timeoutMs / 1000} 秒后超时` });
      else if (code === 0) resolve({ ok: true, ms, model });
      else resolve({ ok: false, ms, model, error: cleanProbeError(stdout, stderr, secret) });
    });
  });
}

async function testProviderWithPi(row, { timeoutMs = 30_000 } = {}) {
  const result = await runPiPrint(row, { timeoutMs });
  const chatStage = {
    id: "chat",
    label: "真实对话",
    ok: result.ok,
    ms: result.ms,
    detail: result.ok ? "模型返回成功" : result.error,
  };
  if (!result.ok) return { ...result, stages: [chatStage] };

  // A successful chat proves the configured model works. The model-list probe
  // is supplementary: several compatible gateways intentionally do not expose
  // /models, so its failure must never turn a real connection into a failure.
  try {
    const modelProbeStarted = Date.now();
    const listed = await providers.probeProvider(row.raw, { timeoutMs: 5_000 });
    if (!listed.ok) {
      return {
        ...result,
        stages: [
          chatStage,
          {
            id: "models",
            label: "模型列表",
            ok: false,
            ms: listed.ms ?? Date.now() - modelProbeStarted,
            detail: listed.error || "服务端没有返回模型列表",
          },
        ],
        modelCheck: { ok: false, status: listed.status, error: listed.error },
      };
    }
    return {
      ...result,
      stages: [
        chatStage,
        {
          id: "models",
          label: "模型列表",
          ok: true,
          ms: listed.ms ?? Date.now() - modelProbeStarted,
          detail: `返回 ${listed.models.length} 个模型`,
        },
      ],
      modelCheck: { ok: true, status: listed.status, ms: listed.ms, modelCount: listed.models.length },
      diff: providers.diffModels(row.models, listed.models),
    };
  } catch (error) {
    return {
      ...result,
      stages: [
        chatStage,
        { id: "models", label: "模型列表", ok: false, ms: 0, detail: error?.message || String(error) },
      ],
      modelCheck: { ok: false, error: error?.message || String(error) },
    };
  }
}

async function execute(action, payload = {}) {
  switch (action) {
    case "dashboard":
      return dashboard();
    case "syncProviderCatalog":
      return providerCatalog.syncProviderCatalog();
    case "resetProviderCatalog":
      return providerCatalog.resetProviderCatalog();
    case "exportConfig":
      return transfer.exportConfig(store.loadModels(), store.loadSettings());
    case "previewRestore":
      return transfer.planRestoreConfig(store.loadModels(), store.loadSettings(), payload.config).summary;
    case "restoreConfig": {
      let summary;
      store.updateModels(currentModels => {
        const planned = transfer.planRestoreConfig(currentModels, store.loadSettings(), payload.config);
        summary = planned.summary;
        return planned.nextModels;
      });
      store.updateSettings(currentSettings => {
        const planned = transfer.planRestoreConfig(store.loadModels(), currentSettings, payload.config);
        summary = planned.summary;
        return planned.nextSettings;
      });
      return summary;
    }
    case "activateProvider":
      return providers.setDefault(payload.provider, payload.model);
    case "setThinking":
      return providers.setThinking(payload.level);
    case "testProvider": {
      const row = providers.listProviders().find(item => item.name === payload.name);
      if (!row) throw new Error(`provider "${payload.name}" not found`);
      return testProviderWithPi(row);
    }
    case "readProviderKey": {
      const row = providers.listProviders().find(item => item.name === payload.name);
      if (!row) throw new Error(`provider "${payload.name}" not found`);
      const resolved = store.resolveApiKey(row.apiKeySpec);
      if (!resolved.value) throw new Error(resolved.error || "API key 无法读取");
      return { key: resolved.value };
    }
    case "addProvider": {
      const { name, baseUrl, api, key, model, storeKeychain } = payload;
      if (!key) throw new Error("API key is required");
      if (providers.getProvider(name)) throw new Error(`provider "${name}" already exists`);
      let apiKey = key;
      if (storeKeychain && process.platform === "darwin") {
        const service = keychain.serviceNameFor(name);
        keychain.setKey(service, key);
        apiKey = keychain.keychainSpec(service);
      }
      const config = {
        baseUrl: baseUrl.replace(/\/+$/, ""),
        api,
        apiKey,
        ...(api === "anthropic-messages" ? { authHeader: true } : {}),
        models: [modelDefaults(model, name, { api })],
      };
      const saved = providers.upsertProvider(name, config);
      return publicProviderMutation(name, saved);
    }
    case "duplicateProvider":
      return providers.duplicateProvider(payload.source, payload.name);
    case "updateProvider":
      return publicProviderMutation(
        payload.name,
        providers.patchProvider(payload.name, { baseUrl: payload.baseUrl.replace(/\/+$/, ""), api: payload.api }),
      );
    case "rotateKey": {
      const row = providers.listProviders().find(item => item.name === payload.name);
      if (!row) throw new Error(`provider "${payload.name}" not found`);
      if (!payload.key) throw new Error("API key is required");
      if (payload.storeKeychain && process.platform === "darwin") {
        const existing = keychain.parseKeychainSpec(row.apiKeySpec);
        const service = existing?.service ?? keychain.serviceNameFor(payload.name);
        keychain.setKey(service, payload.key);
        if (!existing) providers.patchProvider(payload.name, { apiKey: keychain.keychainSpec(service) });
        return { storage: "keychain" };
      }
      providers.patchProvider(payload.name, { apiKey: payload.key });
      return { storage: "plaintext" };
    }
    case "deleteProvider":
      providers.deleteProvider(payload.name);
      return true;
    case "upsertModel": {
      return providers.upsertModel(payload.provider, payload.model);
    }
    case "batchUpdateModels":
      return providers.batchUpdateModels(payload.provider, payload.ids, payload.patch);
    case "repairModelCapabilities":
      return providers.repairModelCapabilities(payload.provider, payload.model);
    case "deleteModel":
      providers.deleteModel(payload.provider, payload.id);
      return true;
    case "syncProvider": {
      const row = providers.listProviders().find(item => item.name === payload.name);
      if (!row) throw new Error(`provider "${payload.name}" not found`);
      const result = await providers.probeProvider(row.raw);
      if (!result.ok) throw new Error(result.error);
      const diff = providers.diffModels(row.models, result.models);
      const capabilityUpdates = providers.planModelCapabilityRefresh(row.name, result.modelDetails);
      let capabilityRefresh = { provider: row.name, changed: [] };
      if (payload.apply) {
        capabilityRefresh = providers.refreshModelCapabilities(row.name, result.modelDetails);
        const details = new Map((result.modelDetails || []).map(item => [item.id, item]));
        for (const id of diff.extra) {
          const detail = details.get(id);
          providers.upsertModel(row.name, {
            id,
            name: `${id} (${row.name})`,
            capabilitySource: detail,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          });
        }
      }
      return { ...result, diff, capabilityUpdates, capabilityRefresh };
    }
    case "toggleMcp":
      return mcp.setDisabled(payload.name, payload.disabled, { scope: payload.scope || "global", cwd: payload.cwd || process.cwd() });
    case "upsertMcp": {
      const patch = {
        ...(payload.command !== undefined ? { command: payload.command } : {}),
        ...(payload.args !== undefined ? { args: payload.args } : {}),
        ...(payload.url !== undefined ? { url: payload.url } : {}),
        ...(payload.lifecycle !== undefined ? { lifecycle: payload.lifecycle } : {}),
        ...(payload.env !== undefined ? { env: payload.env } : {}),
      };
      return mcp.upsertServer(payload.name, patch, { scope: payload.scope || "global", cwd: payload.cwd || process.cwd() });
    }
    case "deleteMcp":
      return mcp.deleteServer(payload.name, { scope: payload.scope || "global", cwd: payload.cwd || process.cwd() });
    case "addSkillPath":
      return skills.addSkillPath(payload.path);
    case "removeSkillPath":
      skills.removeSkillPath(payload.path);
      return true;
    case "pruneSkillPaths":
      return skills.pruneSkillPaths();
    case "doctor":
      return doctor.runDoctor({ probe: payload.probe === true });
    case "importPreview": {
      if (!importer.ccSwitchAvailable()) return { importable: [], skipped: [] };
      const rows = importer.readCcSwitchProviders();
      const usable = rows.filter(row => row.converted);
      const plan = importer.planImportNames(usable, providers.listProviders().map(row => row.name));
      return {
        importable: plan.map(({ row, name, renamedFrom }) => ({ sourceName: row.name, appType: row.appType, targetName: name, renamedFrom })),
        skipped: rows.filter(row => !row.converted).map(row => ({ name: row.name, reason: row.reason })),
      };
    }
    case "importAll": {
      const rows = importer.readCcSwitchProviders().filter(row => row.converted);
      const plan = importer.planImportNames(rows, providers.listProviders().map(row => row.name));
      const useKeychain = payload.storeKeychain === true && process.platform === "darwin";
      let keychainCount = 0;
      let plaintextCount = 0;
      for (const { row, name } of plan) {
        const converted = structuredClone(row.converted);
        if (useKeychain && converted.apiKey) {
          const service = keychain.serviceNameFor(name);
          keychain.setKey(service, converted.apiKey);
          converted.apiKey = keychain.keychainSpec(service);
          keychainCount += 1;
        } else {
          plaintextCount += 1;
        }
        providers.upsertProvider(name, converted);
      }
      return { count: plan.length, keychainCount, plaintextCount };
    }
    case "launchProfile": {
      const profile = profiles.resolveProfile(payload.name, { currentCwd: homedir(), useDesktopCwd: true });
      const piArgs = profiles.buildProfileArgs(profile);
      const profileEnv = profiles.profileEnvironment(profile);
      const envArgs = Object.entries(profileEnv).map(([key, value]) => shellQuote(`${key}=${value}`));
      const envPrefix = envArgs.length > 0 ? `env ${envArgs.join(" ")} ` : "";
      const command = `cd ${shellQuote(profile.cwd)} && ${envPrefix}pi ${piArgs.map(shellQuote).join(" ")}`;
      const script = `tell application "Terminal" to do script ${JSON.stringify(command)}`;
      const child = spawn("/usr/bin/osascript", ["-e", script], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }
    default:
      throw new Error(`unknown desktop action: ${action}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

try {
  const request = JSON.parse(input || "{}");
  const data = await execute(request.action, request.payload);
  process.stdout.write(JSON.stringify({ ok: true, data }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exitCode = 1;
}
