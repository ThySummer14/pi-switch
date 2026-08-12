import assert from "node:assert/strict";
import { test } from "node:test";
import { getProviderPreset, PROVIDER_PRESETS } from "../src/provider-presets.js";

test("provider presets are credential-free and have complete form defaults", () => {
  assert.ok(PROVIDER_PRESETS.length >= 4);
  assert.equal(new Set(PROVIDER_PRESETS.map(preset => preset.id)).size, PROVIDER_PRESETS.length);
  for (const preset of PROVIDER_PRESETS) {
    assert.equal("apiKey" in preset, false);
    assert.equal(typeof preset.label, "string");
    assert.equal(typeof preset.description, "string");
    assert.equal(typeof preset.api, "string");
    assert.equal(typeof preset.baseUrl, "string");
    assert.equal(typeof preset.model, "string");
  }
});

test("preset lookup falls back to the custom template", () => {
  assert.equal(getProviderPreset("volcengine-agent-plan").model, "kimi-k2.6");
  assert.equal(getProviderPreset("does-not-exist").id, "custom");
});

test("OpenCode Zen preset targets the documented free DeepSeek model", () => {
  const preset = getProviderPreset("opencode-zen");
  assert.equal(preset.baseUrl, "https://opencode.ai/zen/v1");
  assert.equal(preset.api, "openai-completions");
  assert.equal(preset.model, "deepseek-v4-flash-free");
});
