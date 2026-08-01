import assert from "node:assert/strict";
import { test } from "node:test";
import { diagnoseProviderError } from "../src/provider-errors.js";

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
