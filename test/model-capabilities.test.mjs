import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-capabilities-"));
process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {
  relay: {
    baseUrl: "https://relay.example",
    api: "openai-completions",
    apiKey: "test-key",
    models: [{ id: "grok-4.5", input: ["text"], reasoning: false }],
  },
  sync: {
    baseUrl: "https://sync.example",
    api: "openai-completions",
    apiKey: "test-key",
    models: [
      { id: "grok-4.5", input: ["text"], reasoning: false },
      { id: "manual-model", input: ["text"], reasoning: false, capabilities: {
        input: { confidence: "confirmed", source: "manual" },
        reasoning: { confidence: "confirmed", source: "manual" },
      } },
      { id: "confirmed-model", input: ["text"], reasoning: false, capabilities: {
        input: { confidence: "confirmed", source: "server" },
        reasoning: { confidence: "confirmed", source: "server" },
      } },
    ],
  },
} }));
writeFileSync(join(dir, "settings.json"), "{}\n");

const capabilities = await import("../src/model-capabilities.js");
const providers = await import("../src/providers.js");

test("unknown models fail open for images but keep reasoning explicitly unconfirmed", () => {
  const result = capabilities.inferModelCapabilities("gateway/new-model", { api: "openai-completions" });
  assert.deepEqual(result.input, ["text", "image"]);
  assert.equal(result.reasoning, false);
  assert.equal(result.capabilities.input.confidence, "unknown");
  assert.equal(result.capabilities.reasoning.confidence, "unknown");
  assert.equal(result.contextWindow, 200_000);
  assert.equal(result.capabilities.contextWindow.confidence, "unknown");
});

test("known model registry uses real large context windows", () => {
  const expected = [
    ["kimi-k3", 1_048_576],
    ["deepseek/deepseek-v4-pro", 1_000_000],
    ["grok-4.5", 500_000],
    ["step-3.7-flash", 262_144],
    ["qwen3-coder-plus", 1_048_576],
    ["openai/gpt-5.3-codex", 400_000],
    ["qwen/Qwen3-Coder-480B-A35B-Instruct", 262_144],
    ["qwen3.8-max-preview", 1_000_000],
  ];
  for (const [id, contextWindow] of expected) {
    const result = capabilities.createModelDefaults(id, "relay");
    assert.equal(result.contextWindow, contextWindow, id);
    assert.equal(result.capabilities.contextWindow.confidence, "inferred", id);
  }
  assert.equal(capabilities.createModelDefaults("grok-4.5[1M]", "relay").contextWindow, 1_000_000);
});

test("provider context metadata wins over the model registry and parses common shapes", () => {
  const result = capabilities.inferModelContextWindow("kimi-k3", {
    declared: { top_provider: { context_length: "512k" } },
  });
  assert.equal(result.contextWindow, 512_000);
  assert.equal(result.contextWindowConfidence, "confirmed");
  assert.equal(result.contextWindowSource, "server");
});

test("legacy rows with a correct known context are inferred without rewriting them", () => {
  const inspected = capabilities.inspectModelCapabilities({ id: "grok-4.5", contextWindow: 500_000 });
  assert.equal(inspected.contextWindowConfidence, "inferred");
  assert.equal(inspected.contextWindowSource, "model-context-registry");
  assert.equal(inspected.needsReview, true, "other legacy capability fields remain reviewable");
});

test("known grok family inference prevents the old text-only/false regression", () => {
  const result = capabilities.inferModelCapabilities("grok-4.5", { api: "openai-responses" });
  assert.deepEqual(result.input, ["text", "image"]);
  assert.equal(result.reasoning, true);
  assert.equal(result.capabilities.input.confidence, "inferred");
  assert.equal(result.capabilities.reasoning.confidence, "inferred");
});

test("Claude Code context markers do not hide known family capabilities", () => {
  const result = capabilities.inferModelCapabilities("grok-4.5[1M]", { api: "openai-responses" });
  assert.deepEqual(result.input, ["text", "image"]);
  assert.equal(result.reasoning, true);
  assert.equal(result.capabilities.input.source, "model-family-registry");
});

test("CC Switch catalog text defaults are hints, not locks", () => {
  const result = capabilities.inferCcSwitchCatalogCapabilities("gateway/new-model", {
    api: "openai-responses",
    catalog: {
      input_modalities: ["text"],
      supported_reasoning_levels: [{ effort: "high" }],
      default_reasoning_level: "high",
      supports_reasoning_summaries: true,
    },
  });
  assert.deepEqual(result.input, ["text", "image"]);
  assert.equal(result.capabilities.input.confidence, "unknown");
  assert.equal(result.reasoning, false);
  assert.equal(result.capabilities.reasoning.confidence, "unknown");
});

test("confirmed text-only model ids stay text-only while unknown suffixes fail open", () => {
  const textOnly = capabilities.inferModelCapabilities("deepseek/deepseek-v4-pro", { api: "openai-completions" });
  assert.deepEqual(textOnly.input, ["text"]);
  assert.equal(textOnly.capabilities.input.confidence, "inferred");

  const futureVariant = capabilities.inferModelCapabilities("deepseek/deepseek-v4-pro-20260731", { api: "openai-completions" });
  assert.deepEqual(futureVariant.input, ["text", "image"]);
  assert.equal(futureVariant.capabilities.input.confidence, "unknown");
});

test("server capability declarations take precedence over inference", () => {
  const result = capabilities.inferModelCapabilities("grok-4.5", {
    declared: { input_modalities: ["text"], supports_reasoning: false },
  });
  assert.deepEqual(result.input, ["text"]);
  assert.equal(result.reasoning, false);
  assert.equal(result.capabilities.input.confidence, "confirmed");
  assert.equal(result.capabilities.reasoning.confidence, "confirmed");
});

test("catalog parser metadata is not treated as a reasoning declaration", () => {
  const result = capabilities.inferModelCapabilities("relay-model", {
    declared: {
      inputModalities: ["text"],
      supports_reasoning_summaries: true,
      default_reasoning_level: "high",
    },
  });
  assert.deepEqual(result.input, ["text"]);
  assert.equal(result.reasoning, false);
  assert.equal(result.capabilities.reasoning.confidence, "unknown");
});

test("repair updates legacy known rows and leaves the manual path available", () => {
  const result = providers.repairModelCapabilities("relay");
  assert.deepEqual(result.changed, ["grok-4.5"]);
  const model = providers.getProvider("relay").models[0];
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.reasoning, true);
  assert.equal(model.capabilities.input.source, "model-family-registry");
  assert.equal(model.capabilities.reasoning.source, "model-family-registry");
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(dir, "models.json"), "utf8")));
});

test("repair fills a missing context window for a known model", () => {
  providers.upsertProvider("missing-context", {
    baseUrl: "https://missing-context.example",
    api: "openai-completions",
    apiKey: "test-key",
    models: [{ id: "kimi-k3", input: ["text"], reasoning: false }],
  });
  const result = providers.repairModelCapabilities("missing-context", "kimi-k3");
  assert.deepEqual(result.changed, ["kimi-k3"]);
  const model = providers.getProvider("missing-context").models.find(item => item.id === "kimi-k3");
  assert.equal(model.contextWindow, 1_048_576);
  assert.equal(model.capabilities.contextWindow.source, "model-context-registry");
});

test("Qwen 3.8 Anthropic endpoints cannot disable thinking", () => {
  const defaults = capabilities.createModelDefaults("qwen3.8-max-preview", "千问", {
    api: "anthropic-messages",
  });
  assert.deepEqual(defaults.thinkingLevelMap, { off: null });

  providers.upsertProvider("qwen-compat", {
    baseUrl: "https://qwen.example/apps/anthropic",
    api: "anthropic-messages",
    apiKey: "test-key",
    models: [{ id: "qwen3.8-max-preview", contextWindow: 1_000_000, reasoning: true }],
  });
  const result = providers.repairModelCapabilities("qwen-compat");
  assert.deepEqual(result.changed, ["qwen3.8-max-preview"]);
  const model = providers.getProvider("qwen-compat").models[0];
  assert.deepEqual(model.thinkingLevelMap, { off: null });
});

test("Kimi OpenAI endpoints use the system role instead of developer", () => {
  for (const api of ["openai-completions", "openai-responses"]) {
    const defaults = capabilities.createModelDefaults("kimi-k3", "火山引擎", { api });
    assert.deepEqual(defaults.compat, { supportsDeveloperRole: false }, api);
  }

  providers.upsertProvider("kimi-legacy", {
    baseUrl: "https://ark.example/api/plan/v3",
    api: "openai-completions",
    apiKey: "test-key",
    models: [{ id: "kimi-k3", contextWindow: 1_048_576, reasoning: true }],
  });
  const result = providers.repairModelCapabilities("kimi-legacy", "kimi-k3");
  assert.deepEqual(result.changed, ["kimi-k3"]);
  assert.deepEqual(providers.getProvider("kimi-legacy").models[0].compat, { supportsDeveloperRole: false });
});

test("repair preserves confirmed server declarations", () => {
  providers.upsertModel("relay", {
    id: "grok-4.5",
    input: ["text"],
    reasoning: false,
    capabilities: {
      input: { confidence: "confirmed", source: "server" },
      reasoning: { confidence: "confirmed", source: "server" },
      contextWindow: { confidence: "confirmed", source: "server" },
    },
    contextWindow: 500_000,
  });

  const result = providers.repairModelCapabilities("relay", "grok-4.5");
  assert.deepEqual(result.changed, []);
  const model = providers.getProvider("relay").models[0];
  assert.deepEqual(model.input, ["text"]);
  assert.equal(model.reasoning, false);
  assert.equal(model.contextWindow, 500_000);
  assert.equal(model.capabilities.input.source, "server");
  assert.equal(model.capabilities.reasoning.source, "server");
  assert.equal(model.capabilities.contextWindow.source, "server");
});

test("model sync applies explicit server capabilities to legacy rows", () => {
  const plan = providers.planModelCapabilityRefresh("sync", [{
    id: "grok-4.5",
    input_modalities: ["text", "image"],
    supports_reasoning: true,
  }]);
  assert.deepEqual(plan.map(item => item.id), ["grok-4.5"]);

  const result = providers.refreshModelCapabilities("sync", [{
    id: "grok-4.5",
    input_modalities: ["text", "image"],
    supports_reasoning: true,
  }]);
  assert.deepEqual(result.changed, ["grok-4.5"]);
  const model = providers.getProvider("sync").models.find(item => item.id === "grok-4.5");
  assert.deepEqual(model.input, ["text", "image"]);
  assert.equal(model.reasoning, true);
  assert.equal(model.capabilities.input.source, "server");
  assert.equal(model.capabilities.reasoning.source, "server");
});

test("model sync preserves manual and confirmed capability locks", () => {
  const details = [
    { id: "manual-model", input_modalities: ["text", "image"], supports_reasoning: true },
    { id: "confirmed-model", input_modalities: ["text", "image"], supports_reasoning: true },
  ];
  assert.deepEqual(providers.planModelCapabilityRefresh("sync", details), []);
  assert.deepEqual(providers.refreshModelCapabilities("sync", details).changed, []);
  const models = providers.getProvider("sync").models;
  const manual = models.find(item => item.id === "manual-model");
  const confirmed = models.find(item => item.id === "confirmed-model");
  assert.deepEqual(manual.input, ["text"]);
  assert.equal(manual.reasoning, false);
  assert.deepEqual(confirmed.input, ["text"]);
  assert.equal(confirmed.reasoning, false);
});
