/**
 * cc-switch → pi conversion. The fixtures are shaped like real rows from
 * cc-switch.db, including the Claude Code [1M] model-id suffix and a baseUrl
 * that already ends in /v1.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { convert, planImportNames } from "../src/import-ccswitch.js";

test("a Claude Code provider maps onto anthropic-messages, dropping the [1M] suffix", () => {
  const { converted } = convert("claude", {
    env: {
      ANTHROPIC_BASE_URL: "https://relay.example/v1",
      ANTHROPIC_AUTH_TOKEN: "sk-test",
      ANTHROPIC_MODEL: "claude-opus-5[1M]",
      ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "claude-sonnet-5",
    },
  }, "relay");

  assert.equal(converted.api, "anthropic-messages");
  // /v1 is stripped: pi's client appends /v1/messages itself.
  assert.equal(converted.baseUrl, "https://relay.example");
  assert.equal(converted.apiKey, "sk-test");
  assert.deepEqual(converted.models.map(m => m.id), ["claude-sonnet-5", "claude-opus-5"]);
  // Relays that swallow `thinking` return empty text, so reasoning starts off.
  assert.equal(converted.models[0].reasoning, false);
});

test("a Claude Code provider with no base url or no key is rejected with a reason", () => {
  assert.throws(() => convert("claude", { env: { ANTHROPIC_AUTH_TOKEN: "k" } }), /ANTHROPIC_BASE_URL/);
  assert.throws(() => convert("claude", { env: { ANTHROPIC_BASE_URL: "https://x" } }), /ANTHROPIC_AUTH_TOKEN/);
});

test("a Codex provider reads base_url and model out of its TOML blob", () => {
  const { converted } = convert("codex", {
    auth: { OPENAI_API_KEY: "sk-codex" },
    config: 'model_provider = "custom"\nmodel = "gpt-5.6-sol"\n\n[model_providers.custom]\nbase_url = "https://relay.example/v1"\nwire_api = "responses"\n',
  }, "relay plus");

  assert.equal(converted.api, "openai-responses");
  assert.equal(converted.baseUrl, "https://relay.example/v1");
  assert.deepEqual(converted.models.map(m => m.id), ["gpt-5.6-sol"]);
});

test('a Codex provider with wire_api "chat" maps to openai-completions', () => {
  const { converted } = convert("codex", {
    auth: { OPENAI_API_KEY: "k" },
    config: 'model = "m"\nbase_url = "https://x"\nwire_api = "chat"\n',
  }, "n");
  assert.equal(converted.api, "openai-completions");
});

test("an OpenClaw provider is already in pi's shape and keeps its models", () => {
  const { converted } = convert("openclaw", {
    baseUrl: "https://maas.example/v2",
    apiKey: "id:secret",
    api: "openai-completions",
    models: [{ id: "glm5", name: "GLM5", contextWindow: 100_000, maxTokens: 16_384 }],
  }, "maas");

  assert.equal(converted.api, "openai-completions");
  assert.deepEqual(converted.models.map(m => m.id), ["glm5"]);
  assert.equal(converted.models[0].contextWindow, 100_000);
});

test("planImportNames never reuses an existing provider name", () => {
  const rows = [
    { id: "a", appType: "claude", name: "DeepSeek" },
    { id: "b", appType: "claude-desktop", name: "DeepSeek" },
    { id: "c", appType: "codex", name: "botcf plus" },
  ];
  const plan = planImportNames(rows, ["deepseek"]);
  assert.deepEqual(plan.map(p => p.name), ["deepseek-claude", "deepseek-claude-desktop", "botcf-plus"]);
  assert.equal(plan[0].renamedFrom, "deepseek");
  assert.equal(plan[2].renamedFrom, null);
});

test("planImportNames falls back to the row id when the name has no usable characters", () => {
  const plan = planImportNames([{ id: "abcdef123456", appType: "claude", name: "!!!" }]);
  assert.equal(plan[0].name, "ccsw-abcdef12");
});

test("a name that collides twice gets a numeric suffix", () => {
  const rows = [
    { id: "a", appType: "claude", name: "relay" },
    { id: "b", appType: "claude", name: "relay" },
  ];
  const plan = planImportNames(rows, ["relay"]);
  assert.deepEqual(plan.map(p => p.name), ["relay-claude", "relay-2"]);
});
