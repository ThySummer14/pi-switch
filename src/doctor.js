/**
 * doctor.js — one pass over the whole config looking for the ways a pi setup
 * breaks quietly. Each finding names the file and what to do about it.
 */

import { existsSync } from "node:fs";
import { agentDirStatus, listAgents, unreachableAgentFiles } from "./agents.js";
import { listServers } from "./mcp.js";
import { inferModelCapabilities, inspectModelCapabilities } from "./model-capabilities.js";
import { repairCommand, runMaintenanceChecks } from "./maintenance.js";
import { paths, tildify } from "./paths.js";
import { listProfiles } from "./profiles.js";
import { listProviders, probeProvider, diffModels } from "./providers.js";
import { listCcPlugins, listSkillPaths } from "./skills.js";
import { loadModels, loadSettings } from "./store.js";
import { validateModelsConfig } from "./validate.js";

/** { level: "error"|"warn"|"ok", area, message, fix? } */
function finding(level, area, message, fix) {
  return { level, area, message, fix };
}

/**
 * Run every check. `probe` also hits the network for each provider, which is
 * slower but is the only way to catch a wrong model id or a dead key.
 */
export async function runDoctor({ probe = false, cwd = process.cwd(), onStage } = {}) {
  const localStarted = Date.now();
  const findings = [];
  const fileFindings = checkFiles();
  findings.push(...fileFindings);
  const modelsInvalid = fileFindings.some(
    item => item.level === "error" && item.area === "files" && item.message.startsWith("models.json invalid:"),
  );
  if (!modelsInvalid) findings.push(...checkDefaults());
  findings.push(...checkProfiles());
  if (!modelsInvalid) findings.push(...checkProviderKeys());
  if (!modelsInvalid) findings.push(...checkModelCapabilities());
  if (!modelsInvalid) findings.push(...checkAgents(cwd));
  findings.push(...checkSkills());
  findings.push(...checkMcp(cwd));
  findings.push(...checkMaintenance());
  const localErrors = findings.filter(item => item.level === "error").length;
  const localWarnings = findings.filter(item => item.level === "warn").length;
  onStage?.({
    id: "local",
    label: "本地配置",
    ok: localErrors === 0,
    ms: Date.now() - localStarted,
    detail: `${localErrors} 个错误，${localWarnings} 个警告`,
  });
  if (probe && !modelsInvalid) {
    const networkStarted = Date.now();
    const providerCount = listProviders().length;
    const reachability = await checkReachability();
    findings.push(...reachability);
    const networkErrors = reachability.filter(item => item.level === "error").length;
    onStage?.({
      id: "network",
      label: "Provider 网络检查",
      ok: networkErrors === 0,
      ms: Date.now() - networkStarted,
      detail: `${providerCount} 个 Provider 已检查`,
    });
  } else if (probe) {
    onStage?.({
      id: "network",
      label: "Provider 网络检查",
      ok: false,
      ms: 0,
      detail: "models.json 无效，已跳过网络检查",
    });
  }
  return findings;
}

function checkMaintenance() {
  let checks;
  try {
    checks = runMaintenanceChecks();
  } catch (error) {
    return [finding("error", "maintenance", error.message, tildify(paths.maintenanceChecks))];
  }

  return checks.map((check) => {
    if (check.status === "ok") {
      return finding("ok", "maintenance", `${check.label}: applied`);
    }
    if (check.status === "missing") {
      return finding(
        "error",
        "maintenance",
        `${check.label}: local patch is not applied`,
        repairCommand(check.script),
      );
    }
    if (check.status === "incompatible") {
      return finding(
        "error",
        "maintenance",
        `${check.label}: upstream source is incompatible; automatic repair is disabled`,
        `inspect ${tildify(check.script)} and the upgraded package before changing anything`,
      );
    }
    return finding(
      "error",
      "maintenance",
      `${check.label}: ${check.reason ?? "check failed unexpectedly"}`,
      tildify(check.script),
    );
  });
}

function checkProfiles() {
  let profiles;
  try {
    profiles = listProfiles();
  } catch (err) {
    return [finding("error", "profiles", err.message, tildify(paths.profiles))];
  }
  const out = [];
  const defaultProfile = profiles.find(profile => profile.isDefault);
  if (!defaultProfile) {
    out.push(finding("error", "profiles", "defaultProfile does not name a configured profile", tildify(paths.profiles)));
  }
  for (const profile of profiles) {
    if (!profile.exists) {
      out.push(finding("error", "profiles", `${profile.name}: cwd does not exist`, profile.cwd));
    }
    if (profile.desktopCwd && !profile.desktopCwdExists) {
      out.push(finding("error", "profiles", `${profile.name}: desktopCwd does not exist`, profile.desktopCwd));
    }
  }
  if (out.length === 0) {
    out.push(finding("ok", "profiles", `${profiles.length} startup profile(s) valid; default=${defaultProfile.name}`));
  }
  return out;
}

function checkFiles() {
  const out = [];
  if (!existsSync(paths.settings)) {
    out.push(finding("error", "files", `settings.json missing at ${tildify(paths.settings)}`, "run pi once to create it"));
  }
  if (!existsSync(paths.models)) {
    out.push(finding("warn", "files", `models.json missing at ${tildify(paths.models)}`, "pi will fall back to built-in providers only"));
  } else {
    try {
      validateModelsConfig(loadModels());
    } catch (err) {
      out.push(finding("error", "files", `models.json invalid: ${err.message}`, tildify(paths.models)));
    }
  }
  return out;
}

function checkDefaults() {
  const settings = loadSettings();
  const providers = listProviders();
  const out = [];
  const name = settings.defaultProvider;
  if (!name) {
    out.push(finding("warn", "default", "settings.defaultProvider is unset", "pi-switch use <provider>"));
    return out;
  }
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    out.push(finding(
      "error",
      "default",
      `defaultProvider "${name}" is not defined in models.json`,
      "pi refuses to start — pick an existing provider with pi-switch use",
    ));
    return out;
  }
  if (settings.defaultModel && !provider.models.includes(settings.defaultModel)) {
    out.push(finding(
      "error",
      "default",
      `defaultModel "${settings.defaultModel}" is not defined under provider "${name}"`,
      `available: ${provider.models.join(", ")}`,
    ));
  }
  return out;
}

function checkProviderKeys() {
  const out = [];
  for (const p of listProviders()) {
    if (!p.keyOk) {
      out.push(finding("error", "key", `${p.name}: ${p.keyError}`, keyFix(p)));
      continue;
    }
    if (p.keyInline) {
      out.push(finding(
        "warn",
        "key",
        `${p.name}: api key is stored in plaintext in models.json`,
        `pi-switch key ${p.name} --keychain moves it into the login keychain`,
      ));
    }
    if ((p.models || []).length === 0) {
      out.push(finding("warn", "provider", `${p.name}: no models defined`, "pi cannot select this provider"));
    }
  }
  return out;
}

function sameInput(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Detect legacy rows that silently turned unknown capabilities into false/text.
 * This is a warning rather than an error: Pi still has a valid model entry, but
 * the user should confirm the upstream behavior before sending images or
 * enabling a thinking level.
 */
function checkModelCapabilities() {
  const out = [];
  for (const provider of listProviders()) {
    for (const model of provider.modelObjects || []) {
      const actual = inspectModelCapabilities(model);
      const inferred = inferModelCapabilities(model.id, { api: provider.api });
      const hasEvidence = model.capabilities && typeof model.capabilities === "object";
      const hasContextEvidence = hasEvidence && model.capabilities.contextWindow;
      const prefix = `${provider.name}/${model.id}`;
      if (!hasEvidence && inferred.capabilities.reasoning.confidence === "inferred" && !actual.reasoning) {
        out.push(finding(
          "warn",
          "capability",
          `${prefix}: reasoning is disabled but the model family is known to support it`,
          "open 模型页面编辑该模型并确认 Reasoning",
        ));
      }
      if (!hasEvidence && inferred.capabilities.input.confidence === "inferred" &&
        !sameInput(actual.input, inferred.input)) {
        out.push(finding(
          "warn",
          "capability",
          `${prefix}: input is ${actual.input.join("+")} but the model family is known to accept images`,
          "open 模型页面编辑该模型并确认图片输入",
        ));
      }
      if (!hasContextEvidence && inferred.capabilities.contextWindow.confidence === "inferred" &&
        actual.contextWindow !== inferred.contextWindow) {
        out.push(finding(
          "warn",
          "context",
          `${prefix}: context window is ${actual.contextWindow} but the model registry lists ${inferred.contextWindow}`,
          "open 模型页面或运行修复已知能力，确认服务端上下文限制",
        ));
      }
      if (actual.inputConfidence === "unknown" || actual.reasoningConfidence === "unknown") {
        out.push(finding(
          "warn",
          "capability",
          `${prefix}: capability evidence is unknown (runtime values are ${actual.input.join("+")} / reasoning ${actual.reasoning ? "on" : "off"})`,
          "open 模型页面确认能力；不要把未知当成服务端明确不支持",
        ));
      }
      if (actual.contextWindowConfidence === "unknown") {
        out.push(finding(
          "warn",
          "context",
          `${prefix}: context window evidence is unknown (runtime fallback is ${actual.contextWindow})`,
          "打开模型页面确认服务端上下文窗口，不要把 200K fallback 当成真实上限",
        ));
      }
    }
  }
  return out;
}

function keyFix(p) {
  if (p.keySource?.startsWith("env:")) return `export ${p.keySource.slice(4)}=… in your shell rc`;
  if (p.keySource?.startsWith("cmd:")) return "the key command failed — check the keychain entry exists";
  return `pi-switch key ${p.name}`;
}

function checkAgents(cwd) {
  const out = [];
  for (const dir of agentDirStatus(cwd)) {
    if (dir.state === "not-a-directory") {
      out.push(finding("error", "agents", `${tildify(dir.dir)} exists but is not a directory`));
    }
  }
  for (const nested of unreachableAgentFiles(cwd)) {
    out.push(finding(
      nested.ccPluginsOwned ? "ok" : "error",
      "agents",
      nested.ccPluginsOwned
        ? `${nested.count} converted agent(s) in ${tildify(nested.dir)} (cc-plugins owned — the subagents loader does not read subdirectories, so these are inert)`
        : `${nested.count} agent file(s) in ${tildify(nested.dir)} will never load — the loader does not recurse into subdirectories`,
      nested.ccPluginsOwned
        ? "expected: cc-plugins bridges skills, not agents. Hand-write pi agents in the agents/ root."
        : `move them up into ${tildify(paths.agents)}`,
    ));
    if (nested.ccPluginsOwned) {
      out.push(finding(
        "warn",
        "agents",
        `never hand-write files into ${tildify(nested.dir)} — cc-plugins rm -rf's that directory when its refcount hits zero`,
      ));
    }
  }
  for (const agent of listAgents(cwd)) {
    for (const problem of agent.problems) {
      out.push(finding(problem.level, "agents", `${agent.name}.md — ${problem.message}`, tildify(agent.file)));
    }
  }
  return out;
}

function checkSkills() {
  const out = [];
  for (const row of listSkillPaths()) {
    if (row.kind === "exclude") continue;
    if (!row.exists) {
      out.push(finding("error", "skills", `settings.skills path does not exist: ${row.entry}`, "pi-switch skills prune"));
      continue;
    }
    if (row.count === 0) {
      out.push(finding("warn", "skills", `${row.entry} contains no SKILL.md`, "the entry loads nothing"));
    }
  }
  for (const plugin of listCcPlugins()) {
    if (plugin.exists === false) {
      out.push(finding("error", "skills", `ccPlugins path does not exist: ${plugin.local}`, "remove it from settings.ccPlugins"));
    }
  }
  return out;
}

function checkMcp(cwd) {
  const out = [];
  const servers = listServers(cwd);
  if (servers.length === 0) {
    out.push(finding("warn", "mcp", "no MCP servers configured in any layer"));
  }
  for (const s of servers) {
    for (const [name, value] of Object.entries(s.env || {})) {
      if (typeof value === "string" && /^\$\{?(\w+)\}?$/.test(value)) {
        const varName = value.replace(/[${}]/g, "");
        if (!process.env[varName]) {
          out.push(finding("warn", "mcp", `${s.name}: env ${name} references $${varName}, which is unset in this shell`));
        }
      }
    }
  }
  return out;
}

async function checkReachability() {
  const out = [];
  const providers = listProviders();
  const results = await Promise.all(
    providers.map(async p => ({ p, result: await probeProvider(p.raw) })),
  );
  for (const { p, result } of results) {
    if (!result.ok) {
      out.push(finding("error", "reach", `${p.name}: ${result.error}`, p.baseUrl));
      continue;
    }
    const diff = diffModels(p.models, result.models);
    if (!diff.unknown && diff.missing.length > 0) {
      out.push(finding(
        "error",
        "reach",
        `${p.name}: model(s) ${diff.missing.join(", ")} are configured but the endpoint does not list them`,
        "requests will fail with model_not_found",
      ));
    }
    for (const a of diff.aliased ?? []) {
      out.push(finding(
        "warn",
        "reach",
        `${p.name}: "${a.id}" is not listed verbatim — the endpoint offers ${a.candidates.join(", ")}`,
        "usually an undated alias the relay accepts; pin the dated id to be sure",
      ));
    }
    out.push(finding("ok", "reach", `${p.name}: reachable in ${result.ms}ms, ${result.models.length} models listed`));
  }
  return out;
}
