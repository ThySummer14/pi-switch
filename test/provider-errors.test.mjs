import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnoseProviderError } from "../src/provider-errors.js";

test("diagnoses an OpenAI-compatible endpoint that rejects developer roles", () => {
  const result = diagnoseProviderError("The parameter `messages.role` specified in the request are not valid: invalid value: `developer`, supported values are: `system`, `assistant`, `user`, `tool`.");
  assert.equal(result.code, "developer-role-unsupported");
  assert.match(result.message, /system/);
});

test("diagnoses an OpenCode Zen web-page 404", () => {
  const result = diagnoseProviderError("Error: 404 <!DOCTYPE html><html lang=\"en\"><head><title>Not Found | opencode</title></head>");
  assert.equal(result.code, "opencode-zen-web-404");
  assert.match(result.message, /https:\/\/opencode\.ai\/zen\/v1/);
});

test("diagnoses a Volcano Agent Plan model entitlement error", () => {
  const result = diagnoseProviderError("OpenAI API error (404): {\"code\":\"UnsupportedModel\",\"message\":\"The requested model does not support the agent plan feature.\"}");
  assert.equal(result.code, "unsupported-agent-plan-model");
  assert.match(result.title, /Agent Plan/);
  assert.match(result.message, /kimi-k3/);
});

test("diagnoses a Qwen endpoint that requires thinking", () => {
  const result = diagnoseProviderError('400 event:error data:{"message":"The value of the enable_thinking parameter is restricted to True."}');
  assert.equal(result.code, "thinking-required");
  assert.match(result.message, /Thinking/);
});

test("keeps unrelated provider errors available for their raw details", () => {
  assert.equal(diagnoseProviderError("HTTP 502 upstream unavailable"), null);
});
