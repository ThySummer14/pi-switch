/**
 * Provider CRUD, key resolution and MCP layering, all against a throwaway
 * PI_CODING_AGENT_DIR so the real ~/.pi/agent is never touched.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-config-"));
process.env.PI_CODING_AGENT_DIR = dir;

writeFileSync(join(dir, "models.json"), JSON.stringify({
  providers: {
    relay: {
      baseUrl: "https://relay.example",
      api: "anthropic-messages",
      apiKey: "sk-inline",
      models: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }],
    },
    other: {
      baseUrl: "https://other.example",
      api: "openai-completions",
      apiKey: "$PI_SWITCH_TEST_KEY",
      models: [{ id: "m1" }],
    },
  },
}));
writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "claude-opus-5" }));

const providers = await import("../src/providers.js");
const store = await import("../src/store.js");
const mcp = await import("../src/mcp.js");

test("listProviders reports the default and how each key resolves", () => {
  const rows = providers.listProviders();
  const relay = rows.find(p => p.name === "relay");
  assert.equal(relay.isDefault, true);
  assert.equal(relay.defaultModel, "claude-opus-5");
  assert.equal(relay.keyInline, true);
  assert.equal(relay.keyOk, true);

  const other = rows.find(p => p.name === "other");
  assert.equal(other.keyOk, false);
  assert.match(other.keyError, /PI_SWITCH_TEST_KEY is not set/);
});

test("resolveApiKey reads env vars and shell commands", () => {
  process.env.PI_SWITCH_TEST_KEY = "from-env";
  assert.equal(store.resolveApiKey("$PI_SWITCH_TEST_KEY").value, "from-env");
  delete process.env.PI_SWITCH_TEST_KEY;

  assert.equal(store.resolveApiKey("!/bin/echo from-cmd").value, "from-cmd");
  assert.equal(store.resolveApiKey("!/bin/false").value, null);
  assert.equal(store.resolveApiKey("literal").source, "literal");
});

test("setDefault refuses a model the provider does not define", () => {
  assert.throws(() => providers.setDefault("relay", "gpt-5"), /not defined under provider "relay"/);
  assert.throws(() => providers.setDefault("nope"), /not in models.json/);
});

test("setDefault writes both fields and backs up the old settings.json", () => {
  const result = providers.setDefault("other", "m1");
  assert.deepEqual(result, { provider: "other", model: "m1" });
  const settings = store.loadSettings();
  assert.equal(settings.defaultProvider, "other");
  assert.equal(settings.defaultModel, "m1");

  const backups = readdirSync(join(dir, "pi-switch-backups"));
  assert.ok(backups.some(f => f.startsWith("settings.json.")), "settings.json was backed up");
});

test("a provider cannot be deleted while it is the default", () => {
  assert.throws(() => providers.deleteProvider("other"), /is the default provider/);
  providers.setDefault("relay", "claude-opus-5");
  providers.deleteProvider("other");
  assert.equal(providers.getProvider("other"), null);
});

test("the active default model cannot be deleted", () => {
  assert.throws(() => providers.deleteModel("relay", "claude-opus-5"), /is the active default/);
  providers.deleteModel("relay", "claude-sonnet-5");
  assert.deepEqual(providers.getProvider("relay").models.map(m => m.id), ["claude-opus-5"]);
});

test("upsertProvider validates the api name and requires a baseUrl", () => {
  assert.throws(() => providers.upsertProvider("x", { api: "made-up", baseUrl: "https://x" }), /is not an api pi implements/);
  assert.throws(() => providers.upsertProvider("x", { api: "openai-completions" }), /baseUrl is required/);
  assert.throws(() => providers.upsertProvider("bad name", { api: "openai-completions", baseUrl: "https://x" }), /may only contain Unicode letters/);
  assert.throws(() => providers.upsertProvider("bad/name", { api: "openai-completions", baseUrl: "https://x" }), /may only contain Unicode letters/);
});

test("provider names support Chinese and other Unicode letters", () => {
  const config = {
    api: "openai-completions",
    baseUrl: "https://unicode.example/v1",
    apiKey: "test-key",
    models: [{ id: "m1" }],
  };
  providers.upsertProvider("米醋中转", config);
  assert.deepEqual(providers.getProvider("米醋中转"), config);
});

test("duplicateProvider copies models and key references without resolving the key", () => {
  const source = providers.getProvider("relay");
  const result = providers.duplicateProvider("relay", "relay-副本");
  assert.deepEqual(result, {
    source: "relay",
    name: "relay-副本",
    api: "anthropic-messages",
    modelCount: source.models.length,
    keyStorage: "inline",
  });

  const copy = providers.getProvider("relay-副本");
  assert.notEqual(copy, source);
  assert.deepEqual(copy.models, source.models);
  assert.equal(copy.apiKey, source.apiKey);
  assert.throws(() => providers.duplicateProvider("relay", "relay-副本"), /already exists/);
  assert.throws(() => providers.duplicateProvider("relay", "bad name"), /may only contain Unicode letters/);
  assert.throws(() => providers.duplicateProvider("relay", "relay"), /different name/);
});

test("a provider that pi's schema would reject is never written", () => {
  const good = { api: "openai-completions", baseUrl: "https://x", apiKey: "k", models: [{ id: "m" }] };

  // Empty strings are the dangerous case: pi's schema is minLength 1, and one
  // failure makes it load ZERO providers — not just skip this entry.
  assert.throws(() => providers.upsertProvider("p", { ...good, apiKey: "" }), /must not be empty/);
  assert.throws(
    () => providers.upsertProvider("p", { ...good, models: [{ id: "m", name: "" }] }),
    /models\.0\.name: must not be empty/,
  );

  // A partial cost object fails pi's schema; all four rates are required.
  assert.throws(
    () => providers.upsertProvider("p", { ...good, models: [{ id: "m", cost: { input: 1 } }] }),
    /needs all of input, output, cacheRead, cacheWrite/,
  );

  // Numeric strings are a natural mistake when values come from a prompt.
  assert.throws(
    () => providers.upsertProvider("p", { ...good, models: [{ id: "m", contextWindow: "200000" }] }),
    /contextWindow: must be a number, not the string/,
  );

  assert.throws(
    () => providers.upsertProvider("p", { ...good, models: [{ id: "m", input: ["audio"] }] }),
    /input\.0: must be one of text, image/,
  );
  assert.throws(
    () => providers.upsertProvider("p", { ...good, models: [{ id: "dup" }, { id: "dup" }] }),
    /"dup" is defined twice/,
  );

  assert.equal(providers.getProvider("p"), null, "nothing was written for any rejected shape");
});

test("setThinking rejects a level pi would silently ignore", () => {
  assert.throws(() => providers.setThinking("turbo"), /is not a thinking level/);
  providers.setThinking("medium");
  assert.equal(store.loadSettings().defaultThinkingLevel, "medium");
});

test("upsertModel fills conservative defaults and merges on re-add", () => {
  providers.upsertModel("relay", { id: "new-model" });
  const added = providers.getProvider("relay").models.find(m => m.id === "new-model");
  assert.equal(added.contextWindow, 200_000);
  assert.equal(added.reasoning, false);

  providers.upsertModel("relay", { id: "new-model", reasoning: true });
  const merged = providers.getProvider("relay").models.find(m => m.id === "new-model");
  assert.equal(merged.reasoning, true);
  assert.equal(merged.contextWindow, 200_000, "unspecified fields survive the merge");
});

test("batchUpdateModels changes only explicit fields and locks those capabilities", () => {
  providers.upsertProvider("batch", {
    baseUrl: "https://batch.example",
    api: "openai-completions",
    apiKey: "test-key",
    models: [
      { id: "one", contextWindow: 100_000, maxTokens: 8_000, input: ["text"], reasoning: false, capabilities: { input: { confidence: "inferred", source: "catalog" }, reasoning: { confidence: "unknown", source: "unknown" }, contextWindow: { confidence: "inferred", source: "catalog" } } },
      { id: "two", contextWindow: 200_000, maxTokens: 16_000, input: ["text"], reasoning: false, capabilities: { input: { confidence: "inferred", source: "catalog" }, reasoning: { confidence: "unknown", source: "unknown" }, contextWindow: { confidence: "inferred", source: "catalog" } } },
      { id: "untouched", contextWindow: 300_000, maxTokens: 32_000, input: ["text"], reasoning: false },
    ],
  });

  const result = providers.batchUpdateModels("batch", ["one", "two", "one"], {
    contextWindow: 500_000,
    maxTokens: 24_000,
    input: ["text", "image"],
    reasoning: true,
  });
  assert.deepEqual(result, {
    provider: "batch",
    updated: ["one", "two"],
    fields: ["contextWindow", "maxTokens", "input", "reasoning"],
  });

  const rows = providers.getProvider("batch").models;
  for (const id of ["one", "two"]) {
    const model = rows.find(row => row.id === id);
    assert.equal(model.contextWindow, 500_000);
    assert.equal(model.maxTokens, 24_000);
    assert.deepEqual(model.input, ["text", "image"]);
    assert.equal(model.reasoning, true);
    assert.deepEqual(model.capabilities.input, { confidence: "confirmed", source: "manual" });
    assert.deepEqual(model.capabilities.reasoning, { confidence: "confirmed", source: "manual" });
    assert.deepEqual(model.capabilities.contextWindow, { confidence: "confirmed", source: "manual" });
  }
  assert.equal(rows.find(row => row.id === "untouched").contextWindow, 300_000);

  const beforeMaxOnly = structuredClone(rows.find(row => row.id === "one").capabilities);
  providers.batchUpdateModels("batch", ["one"], { maxTokens: 25_000 });
  const afterMaxOnly = providers.getProvider("batch").models.find(row => row.id === "one");
  assert.equal(afterMaxOnly.maxTokens, 25_000);
  assert.deepEqual(afterMaxOnly.capabilities, beforeMaxOnly, "a maximum-output-only batch leaves capability evidence intact");

  const beforeInvalidEdit = readFileSync(join(dir, "models.json"), "utf8");
  assert.throws(
    () => providers.batchUpdateModels("batch", ["one", "missing"], { reasoning: false }),
    /model\(s\) not found/,
  );
  assert.equal(readFileSync(join(dir, "models.json"), "utf8"), beforeInvalidEdit, "a rejected batch does not write a partial update");
});

test("diffModels finds configured ids the endpoint does not offer", () => {
  const diff = providers.diffModels(["a", "b"], ["a", "c"]);
  assert.deepEqual(diff.missing, ["b"]);
  assert.deepEqual(diff.extra, ["c"]);

  // An endpoint that lists nothing is unknown, not "everything is missing".
  assert.equal(providers.diffModels(["a"], []).unknown, true);
});

test("diffModels treats a dated variant as an alias, not a missing model", () => {
  const diff = providers.diffModels(
    ["claude-haiku-4-5", "claude-fable-5"],
    ["claude-haiku-4-5-20251001", "claude-opus-5"],
  );
  assert.deepEqual(diff.missing, ["claude-fable-5"], "no plausible match → missing");
  assert.deepEqual(diff.aliased, [{ id: "claude-haiku-4-5", candidates: ["claude-haiku-4-5-20251001"] }]);
  // The dated id backing an alias is not also offered as "new".
  assert.deepEqual(diff.extra, ["claude-opus-5"]);
});

test("diffModels ignores a Claude Code [1M] suffix on a declared id", () => {
  const diff = providers.diffModels(["claude-opus-5[1M]"], ["claude-opus-5"]);
  assert.deepEqual(diff.missing, []);
  assert.deepEqual(diff.extra, []);
});

test("modelsUrlCandidates handles the base-url shapes relays actually use", () => {
  // Plain root: the OpenAI convention.
  assert.deepEqual(providers.modelsUrlCandidates("https://api.deepseek.com"), [
    "https://api.deepseek.com/v1/models",
    "https://api.deepseek.com/models",
  ]);

  // Already versioned — appending /v1 would give /v1/v1/models.
  assert.deepEqual(providers.modelsUrlCandidates("https://api.example.com/v1"), [
    "https://api.example.com/v1/models",
  ]);

  // A non-v1 version segment (Ark, Zhipu): /models first, /v1/models as fallback.
  assert.deepEqual(providers.modelsUrlCandidates("https://ark.example.com/api/coding/v3"), [
    "https://ark.example.com/api/coding/v3/models",
    "https://ark.example.com/api/coding/v3/v1/models",
  ]);

  // An Anthropic-compat path usually serves its list at the root too.
  assert.deepEqual(providers.modelsUrlCandidates("https://relay.example/api/anthropic"), [
    "https://relay.example/api/anthropic/v1/models",
    "https://relay.example/api/anthropic/models",
    "https://relay.example/v1/models",
    "https://relay.example/models",
  ]);

  // Longest suffix wins: /api/anthropic, not /anthropic.
  assert.ok(providers.modelsUrlCandidates("https://x.test/api/anthropic").includes("https://x.test/v1/models"));

  assert.deepEqual(providers.modelsUrlCandidates("   "), []);
  // Trailing slashes never produce a doubled separator.
  assert.deepEqual(providers.modelsUrlCandidates("https://api.example.com//"), [
    "https://api.example.com/v1/models",
    "https://api.example.com/models",
  ]);
});

test("MCP toggling writes a pi-owned layer and never edits the shared config", () => {
  // <cwd>/.mcp.json is a shared, non-pi layer: it carries the real command and
  // credentials, and pi-switch must leave it byte-identical.
  const sharedFile = join(dir, ".mcp.json");
  const sharedBody = JSON.stringify({ mcpServers: { ctx: { command: "npx", args: ["ctx"], env: { TOKEN: "secret" } } } });
  writeFileSync(sharedFile, sharedBody);

  assert.equal(mcp.listServers(dir).find(s => s.name === "ctx").disabled, false);

  mcp.setDisabled("ctx", true, { scope: "project", cwd: dir });
  const disabled = mcp.listServers(dir).find(s => s.name === "ctx");
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.disabledBy, "pi-project");
  assert.equal(readFileSync(sharedFile, "utf-8"), sharedBody, "the shared config is untouched");

  // Re-enabling drops our flag rather than persisting `disabled: false` forever.
  mcp.setDisabled("ctx", false, { scope: "project", cwd: dir });
  assert.equal(mcp.listServers(dir).find(s => s.name === "ctx").disabled, false);
  assert.equal(store.readJson(join(dir, ".pi", "mcp.json")).mcpServers.ctx, undefined);

  // The override file only ever holds the flag — no command, no credentials.
  mcp.setDisabled("ctx", true, { scope: "project", cwd: dir });
  assert.deepEqual(store.readJson(join(dir, ".pi", "mcp.json")).mcpServers.ctx, { disabled: true });

  assert.throws(() => mcp.setDisabled("ghost", true, { cwd: dir }), /not defined in any config layer/);
});

test("MCP CRUD writes only a pi-owned override and never copies shared secrets", () => {
  const sharedBody = JSON.stringify({ mcpServers: {
    remote: { command: "npx", args: ["remote-server"], env: { TOKEN: "shared-secret" }, lifecycle: "lazy" },
    readonly: { command: "npx", args: ["readonly-server"] },
  } });
  // Use the project's shared layer for this isolated fixture.
  const cwd = dir;
  writeFileSync(join(cwd, ".mcp.json"), sharedBody);

  const added = mcp.upsertServer("local", {
    command: "node",
    args: ["server.mjs"],
    env: { API_KEY: "local-secret" },
    lifecycle: "eager",
  }, { scope: "project", cwd });
  assert.equal(added.action, "added");
  assert.deepEqual(store.readJson(join(cwd, ".pi", "mcp.json")).mcpServers.local, {
    command: "node",
    args: ["server.mjs"],
    env: { API_KEY: "local-secret" },
    lifecycle: "eager",
  });

  mcp.upsertServer("local", { url: "https://mcp.example/sse" }, { scope: "project", cwd });
  assert.deepEqual(store.readJson(join(cwd, ".pi", "mcp.json")).mcpServers.local, {
    url: "https://mcp.example/sse",
    lifecycle: "eager",
    env: { API_KEY: "local-secret" },
  });

  const updated = mcp.upsertServer("remote", { lifecycle: "eager" }, { scope: "project", cwd });
  assert.equal(updated.action, "updated");
  const override = store.readJson(join(cwd, ".pi", "mcp.json")).mcpServers.remote;
  assert.deepEqual(override, { lifecycle: "eager" });
  assert.equal(readFileSync(join(cwd, ".mcp.json"), "utf-8"), sharedBody);
  assert.deepEqual(mcp.listServers(cwd).find(row => row.name === "remote").envKeys, ["TOKEN"]);

  assert.equal(mcp.deleteServer("local", { scope: "project", cwd }).action, "deleted");
  assert.throws(() => mcp.deleteServer("readonly", { scope: "project", cwd }), /shared config is read-only/);
});

test("writeJson leaves no temp file behind", () => {
  mkdirSync(join(dir, "sub"), { recursive: true });
  const target = join(dir, "sub", "thing.json");
  store.writeJson(target, { a: 1 });
  assert.deepEqual(store.readJson(target), { a: 1 });
  assert.deepEqual(readdirSync(join(dir, "sub")), ["thing.json"]);
});

test("writeJson keeps the file's mode, and defaults a new file to 0600", () => {
  const secret = join(dir, "secret.json");
  writeFileSync(secret, "{}");
  chmodSync(secret, 0o600);
  store.writeJson(secret, { key: "sk-value" });
  assert.equal(statSync(secret).mode & 0o777, 0o600, "a 0600 file stays 0600 across a rewrite");

  const fresh = join(dir, "fresh.json");
  store.writeJson(fresh, { a: 1 });
  assert.equal(statSync(fresh).mode & 0o777, 0o600, "a file pi-switch creates is not world-readable");
});

test("a backup inherits the source file's mode, so a key is not leaked to 0644", () => {
  const secret = join(dir, "secret2.json");
  writeFileSync(secret, JSON.stringify({ key: "sk-value" }));
  chmodSync(secret, 0o600);
  const backupPath = store.writeJson(secret, { key: "sk-rotated" });
  assert.ok(backupPath, "a backup was made");
  assert.equal(statSync(backupPath).mode & 0o777, 0o600);
});

test("backups are pruned to the newest 10 per file", () => {
  const churn = join(dir, "churn.json");
  writeFileSync(churn, "{}");
  for (let i = 0; i < 14; i++) store.writeJson(churn, { i });
  const kept = readdirSync(join(dir, "pi-switch-backups")).filter(f => f.startsWith("churn.json."));
  assert.equal(kept.length, 10);
});

test("readJson reports which file is malformed", () => {
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{ not json");
  assert.throws(() => store.readJson(bad), /bad\.json is not valid JSON/);
});
