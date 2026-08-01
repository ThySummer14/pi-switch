import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-desktop-"));
const secret = "sk-bridge-secret-must-not-leak";
const fakePi = join(dir, "fake-pi");
const fakePiArgs = join(dir, "fake-pi-args.txt");

writeFileSync(fakePi, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PI_SWITCH_TEST_ARGS\"\nexit 0\n");
chmodSync(fakePi, 0o700);

writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "m1" }));
writeFileSync(join(dir, "profiles.json"), JSON.stringify({ defaultProfile: "code", profiles: { code: { mode: "code", desktopCwd: dir } } }));
writeFileSync(join(dir, "models.json"), JSON.stringify({
  providers: {
    relay: {
      baseUrl: "https://relay.example",
      api: "openai-completions",
      apiKey: secret,
      models: [{ id: "m1" }],
    },
  },
}));

test("desktop dashboard exposes key state but never the key value", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "dashboard", payload: {} }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.data.providers[0].keyInline, true);
  assert.equal(response.data.providers[0].keyOk, true);
  assert.equal("apiKeySpec" in response.data.providers[0], false);
  assert.equal(response.data.profiles[0].cwd, dir);
  assert.equal(response.data.profiles[0].cwdSource, "desktop");
  assert.equal(response.data.profiles[0].fixedCwd, false);
  assert.equal(response.data.workspaceCwd, dir);
});

test("desktop MCP actions use the default profile workspace and do not echo env values", () => {
  const sharedBody = JSON.stringify({ mcpServers: {
    shared: { command: "npx", args: ["shared-mcp"], env: { TOKEN: "shared-mcp-secret" } },
  } });
  writeFileSync(join(dir, ".mcp.json"), sharedBody);
  const invoke = (action, payload) => {
    const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PI_CODING_AGENT_DIR: dir },
      input: JSON.stringify({ action, payload }),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("shared-mcp-secret"), false);
    return JSON.parse(result.stdout);
  };

  const dashboard = invoke("dashboard", {});
  assert.equal(dashboard.data.mcp.find(row => row.name === "shared").effectiveLayer, "project");
  const added = invoke("upsertMcp", { name: "local", command: "node", args: ["server.mjs"], env: { API_KEY: "local-secret" }, cwd: dir });
  assert.equal(added.data.action, "added");
  const saved = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
  assert.equal(saved.providers.relay.apiKey, secret);
  const mcpConfig = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf8"));
  assert.deepEqual(mcpConfig.mcpServers.local, { command: "node", args: ["server.mjs"], env: { API_KEY: "local-secret" } });
  assert.equal(invoke("deleteMcp", { name: "local", cwd: dir }).data.action, "deleted");
  assert.equal(readFileSync(join(dir, ".mcp.json"), "utf8"), sharedBody);
});

test("desktop exports provider metadata without any key value", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "exportConfig", payload: {} }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  const relay = response.data.providers.find(provider => provider.name === "relay");
  assert.equal("apiKey" in relay, false);
  assert.equal(relay.keyConfigured, true);
});

test("desktop previews and restores a sanitized config without replacing existing keys", () => {
  const restoreDir = mkdtempSync(join(tmpdir(), "pi-switch-restore-"));
  const existingKey = "existing-key-placeholder";
  writeFileSync(join(restoreDir, "settings.json"), JSON.stringify({ defaultProvider: "existing", defaultModel: "old-model" }));
  writeFileSync(join(restoreDir, "models.json"), JSON.stringify({ providers: {
    existing: { baseUrl: "https://old.example", api: "openai-completions", apiKey: existingKey, models: [{ id: "old-model" }] },
  } }));
  const config = {
    format: "pi-switch-config",
    version: 1,
    providers: [
      { name: "existing", baseUrl: "https://new.example", api: "openai-completions", models: [{ id: "new-model" }], keyConfigured: true, keyStorage: "inline" },
      { name: "new-provider", baseUrl: "https://new-provider.example", api: "openai-completions", models: [{ id: "new-model" }], keyConfigured: true, keyStorage: "command" },
    ],
    settings: { defaultProvider: "new-provider", defaultModel: "new-model", defaultThinkingLevel: "high" },
  };
  const env = { ...process.env, PI_CODING_AGENT_DIR: restoreDir };
  const preview = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url), env, input: JSON.stringify({ action: "previewRestore", payload: { config } }), encoding: "utf8",
  });
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout).data, { providersAdded: 1, providersUpdated: 1, modelsImported: 2, keysPreserved: 1, warnings: [] });

  const restored = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url), env, input: JSON.stringify({ action: "restoreConfig", payload: { config } }), encoding: "utf8",
  });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.stdout.includes(existingKey), false);
  const models = JSON.parse(readFileSync(join(restoreDir, "models.json"), "utf8"));
  assert.equal(models.providers.existing.apiKey, existingKey);
  assert.equal("apiKey" in models.providers["new-provider"], false);
  assert.equal(JSON.parse(readFileSync(join(restoreDir, "settings.json"), "utf8")).defaultProvider, "new-provider");
});

test("desktop reveals a provider key only through the explicit read action", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "readProviderKey", payload: { name: "relay" } }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, data: { key: secret } });
});

test("desktop can add a provider with a Chinese name", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({
      action: "addProvider",
      payload: {
        name: "米醋中转",
        baseUrl: "https://unicode.example/v1",
        api: "openai-completions",
        key: "test-key",
        model: "grok-4.5",
        storeKeychain: false,
      },
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stdout.includes("test-key"), false);
  assert.deepEqual(JSON.parse(result.stdout).data, {
    name: "米醋中转",
    api: "openai-completions",
    baseUrl: "https://unicode.example/v1",
    modelCount: 1,
    keyStorage: "inline",
  });
  const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
  assert.equal(models.providers["米醋中转"].models[0].id, "grok-4.5");
});

test("desktop dashboard exposes credential-free provider presets", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "dashboard", payload: {} }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.ok(response.data.providerPresets.some(preset => preset.id === "volcengine-agent-plan"));
  assert.equal(response.data.providerCatalog.source, "bundled");
  assert.match(response.data.providerCatalog.url, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.equal(response.data.providerCatalog.remotePresetCount, 0);
  assert.equal(response.data.keychainAvailable, true);
  assert.equal(result.stdout.includes(secret), false);
  assert.equal(response.data.providerPresets.some(preset => "apiKey" in preset), false);
});

test("desktop refuses to add over an existing provider before touching its key", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({
      action: "addProvider",
      payload: {
        name: "relay",
        baseUrl: "https://replacement.example/v1",
        api: "openai-completions",
        key: "replacement-secret",
        model: "replacement-model",
        storeKeychain: false,
      },
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout.includes("replacement-secret"), false);
  assert.match(JSON.parse(result.stdout).error, /already exists/);
  const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
  assert.equal(models.providers.relay.apiKey, secret);
  assert.equal(models.providers.relay.baseUrl, "https://relay.example");
});

test("desktop connection test runs the selected model through pi", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
      PI_SWITCH_PI_BIN: fakePi,
      PI_SWITCH_TEST_ARGS: fakePiArgs,
    },
    input: JSON.stringify({ action: "testProvider", payload: { name: "relay" } }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.data.ok, true);
  assert.equal(response.data.model, "m1");
  assert.equal(response.data.modelCheck.ok, false, "model-list failure must remain separate from a successful chat");
  assert.deepEqual(response.data.stages.map(stage => stage.id), ["chat", "models"]);
  assert.equal(response.data.stages[0].ok, true);
  assert.equal(response.data.stages[1].ok, false);
  const args = readFileSync(fakePiArgs, "utf8").split("\n");
  assert.deepEqual(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 2), ["--provider", "relay"]);
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "m1"]);
  assert.equal(args.includes("--no-session"), true);
  assert.equal(args.includes(secret), false);
});

test("desktop provider edits return only a safe summary", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({
      action: "updateProvider",
      payload: { name: "relay", baseUrl: "https://relay.example/v1", api: "openai-completions" },
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  assert.deepEqual(JSON.parse(result.stdout).data, {
    name: "relay",
    api: "openai-completions",
    baseUrl: "https://relay.example/v1",
    modelCount: 1,
    keyStorage: "inline",
  });
});

test("desktop can duplicate a provider without returning its key", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({
      action: "duplicateProvider",
      payload: { source: "relay", name: "relay-副本" },
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    data: {
      source: "relay",
      name: "relay-副本",
      api: "openai-completions",
      modelCount: 1,
      keyStorage: "inline",
    },
  });
  const models = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
  assert.deepEqual(models.providers["relay-副本"].models, models.providers.relay.models);
  assert.equal(models.providers["relay-副本"].apiKey, secret);
});

test("desktop batch model edits preserve credentials and return only a safe summary", () => {
  const batchDir = mkdtempSync(join(tmpdir(), "pi-switch-batch-"));
  const batchSecret = "batch-bridge-secret-must-not-leak";
  writeFileSync(join(batchDir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "m1" }));
  writeFileSync(join(batchDir, "models.json"), JSON.stringify({ providers: {
    relay: {
      baseUrl: "https://relay.example",
      api: "openai-completions",
      apiKey: batchSecret,
      models: [
        { id: "m1", contextWindow: 100_000, maxTokens: 8_000, input: ["text"], reasoning: false },
        { id: "m2", contextWindow: 200_000, maxTokens: 16_000, input: ["text"], reasoning: false },
      ],
    },
  } }));

  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: batchDir },
    input: JSON.stringify({ action: "batchUpdateModels", payload: {
      provider: "relay",
      ids: ["m1", "m2"],
      patch: { contextWindow: 500_000, reasoning: true },
    } }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(batchSecret), false);
  assert.deepEqual(JSON.parse(result.stdout).data, {
    provider: "relay",
    updated: ["m1", "m2"],
    fields: ["contextWindow", "reasoning"],
  });
  const saved = JSON.parse(readFileSync(join(batchDir, "models.json"), "utf8")).providers.relay;
  assert.equal(saved.apiKey, batchSecret);
  assert.equal(saved.models[0].contextWindow, 500_000);
  assert.equal(saved.models[1].reasoning, true);
  assert.equal(saved.models[0].capabilities.contextWindow.source, "manual");
  assert.equal(saved.models[1].capabilities.reasoning.source, "manual");
});

test("desktop sync previews and applies explicit model capabilities", async () => {
  const syncDir = mkdtempSync(join(tmpdir(), "pi-switch-sync-"));
  writeFileSync(join(syncDir, "settings.json"), JSON.stringify({}));
  writeFileSync(join(syncDir, "models.json"), JSON.stringify({ providers: {
    relay: {
      baseUrl: "http://127.0.0.1",
      api: "openai-completions",
      apiKey: "test-sync-key",
      models: [{ id: "grok-4.5", input: ["text"], reasoning: false }],
    },
  } }));

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "grok-4.5", input_modalities: ["text", "image"], supports_reasoning: true, context_length: 500000 }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const env = { ...process.env, PI_CODING_AGENT_DIR: syncDir };
    const request = apply => new Promise(resolve => {
      const child = spawn(process.execPath, ["desktop/bridge.mjs"], {
        cwd: new URL("..", import.meta.url),
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("close", status => resolve({ status, stdout, stderr }));
      child.stdin.end(JSON.stringify({ action: "syncProvider", payload: { name: "relay", apply } }));
    });
    const modelsPath = join(syncDir, "models.json");
    const models = JSON.parse(readFileSync(modelsPath, "utf8"));
    models.providers.relay.baseUrl = `http://127.0.0.1:${port}`;
    writeFileSync(modelsPath, JSON.stringify(models));

    const preview = await request(false);
    assert.equal(preview.status, 0, preview.stderr);
    const previewData = JSON.parse(preview.stdout).data;
    assert.deepEqual(previewData.capabilityUpdates.map(update => update.id), ["grok-4.5"]);
    assert.deepEqual(previewData.capabilityRefresh.changed, []);

    const applied = await request(true);
    assert.equal(applied.status, 0, applied.stderr);
    const appliedData = JSON.parse(applied.stdout).data;
    assert.deepEqual(appliedData.capabilityRefresh.changed, ["grok-4.5"]);
    const saved = JSON.parse(readFileSync(modelsPath, "utf8")).providers.relay.models[0];
    assert.deepEqual(saved.input, ["text", "image"]);
    assert.equal(saved.reasoning, true);
    assert.equal(saved.contextWindow, 500000);
    assert.equal(saved.capabilities.input.source, "server");
    assert.equal(saved.capabilities.reasoning.source, "server");
    assert.equal(saved.capabilities.contextWindow.source, "server");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
