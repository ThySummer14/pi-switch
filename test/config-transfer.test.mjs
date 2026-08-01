import assert from "node:assert/strict";
import { test } from "node:test";
import { exportConfig, planRestoreConfig } from "../src/config-transfer.js";

const models = {
  providers: {
    relay: {
      baseUrl: "https://relay.example/v1",
      api: "openai-completions",
      apiKey: "placeholder-key",
      headers: { authorization: "placeholder-header" },
      models: [{ id: "grok-4.5", contextWindow: 128000, maxTokens: 8192, input: ["text"], reasoning: false }],
    },
  },
};
const settings = { defaultProvider: "relay", defaultModel: "grok-4.5", defaultThinkingLevel: "medium" };

test("config export omits API keys while preserving provider metadata", () => {
  const exported = exportConfig(models, settings, new Date("2026-07-31T00:00:00.000Z"));
  assert.equal(exported.format, "pi-switch-config");
  assert.equal(exported.exportedAt, "2026-07-31T00:00:00.000Z");
  assert.equal("apiKey" in exported.providers[0], false);
  assert.equal(exported.providers[0].keyConfigured, true);
  assert.equal(exported.providers[0].keyStorage, "inline");
  assert.equal(JSON.stringify(exported).includes("placeholder-key"), false);
  assert.equal(JSON.stringify(exported).includes("placeholder-header"), false);
});

test("restore preview keeps existing key references and adds unkeyed providers", () => {
  const exported = exportConfig(models, settings, new Date("2026-07-31T00:00:00.000Z"));
  exported.providers.push({
    name: "new-relay",
    baseUrl: "https://new.example/v1",
    api: "openai-completions",
    models: [{ id: "new-model" }],
    keyConfigured: true,
    keyStorage: "command",
  });
  exported.settings.defaultProvider = "new-relay";
  exported.settings.defaultModel = "new-model";

  const result = planRestoreConfig(models, settings, exported);
  assert.equal(result.nextModels.providers.relay.apiKey, "placeholder-key");
  assert.equal("apiKey" in result.nextModels.providers["new-relay"], false);
  assert.deepEqual(result.nextSettings, { defaultProvider: "new-relay", defaultModel: "new-model", defaultThinkingLevel: "medium" });
  assert.deepEqual(result.summary, {
    providersAdded: 1,
    providersUpdated: 1,
    modelsImported: 2,
    keysPreserved: 1,
    warnings: [],
  });
});

test("restore rejects files that try to carry a credential field", () => {
  const exported = exportConfig(models, settings);
  exported.providers[0].apiKey = "should-not-be-accepted";
  assert.throws(() => planRestoreConfig(models, settings, exported), /包含凭据字段/);
});
