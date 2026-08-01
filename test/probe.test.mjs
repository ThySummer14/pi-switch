/**
 * probeProvider against a local HTTP server: candidate fallback, error shaping,
 * and the guarantee that an api key never reaches a message we print.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-probe-"));
process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {} }));
writeFileSync(join(dir, "settings.json"), "{}");

const { probeProvider } = await import("../src/providers.js");

/** Requests the server saw, so candidate order can be asserted. */
const seen = [];
let handler = () => [404, "not found"];

const server = createServer((req, res) => {
  seen.push(req.url);
  const [status, body, headers = { "content-type": "application/json" }] = handler(req);
  res.writeHead(status, headers);
  res.end(body);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

function provider(overrides = {}) {
  return { baseUrl: base, api: "openai-completions", apiKey: "sk-secret-value-123456", ...overrides };
}

test("a 404 on the first candidate falls through to the next", async () => {
  seen.length = 0;
  handler = req => req.url === "/models"
    ? [200, JSON.stringify({ data: [{ id: "m1" }] })]
    : [404, "nope"];

  const result = await probeProvider(provider());
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.models, ["m1"]);
  assert.deepEqual(seen, ["/v1/models", "/models"], "tried /v1/models first, then /models");
  assert.equal(result.url, `${base}/models`);
});

test("a 401 stops the walk — it is an answer, not a missing path", async () => {
  seen.length = 0;
  handler = () => [401, JSON.stringify({ error: { message: "invalid key" } })];

  const result = await probeProvider(provider());
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.match(result.error, /invalid key/);
  assert.match(result.error, /rotate it/, "401 says what to do about it");
  assert.deepEqual(seen, ["/v1/models"], "no further candidates after a real answer");
});

test("every candidate 404ing reports how many were tried", async () => {
  handler = () => [404, "nope"];
  const result = await probeProvider(provider());
  assert.equal(result.ok, false);
  assert.match(result.error, /no model list found \(tried 2 paths/);
});

test("an api key echoed back by the gateway is redacted", async () => {
  const key = "sk-secret-value-123456";
  handler = () => [403, JSON.stringify({ error: { message: `token ${key} is banned` } })];

  const result = await probeProvider(provider({ apiKey: key }));
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(key), `key leaked into: ${result.error}`);
  assert.match(result.error, /\[REDACTED\]/);
});

test("a timeout is reported as a timeout, not a generic failure", async () => {
  handler = () => [200, JSON.stringify({ data: [] })];
  const slow = createServer(() => { /* never respond */ });
  await new Promise(resolve => slow.listen(0, "127.0.0.1", resolve));
  try {
    const result = await probeProvider(
      provider({ baseUrl: `http://127.0.0.1:${slow.address().port}` }),
      { timeoutMs: 150 },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /timeout after 150ms/);
  } finally {
    slow.close();
  }
});

test("an unresolvable key fails before any request is made", async () => {
  seen.length = 0;
  const result = await probeProvider(provider({ apiKey: "$PI_SWITCH_MISSING_KEY" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /PI_SWITCH_MISSING_KEY is not set/);
  assert.deepEqual(seen, []);
});

test("anthropic-messages providers get the x-api-key header and one fixed path", async () => {
  seen.length = 0;
  let headers = null;
  handler = req => {
    headers = req.headers;
    return [200, JSON.stringify({ data: [{ id: "claude-opus-5" }] })];
  };

  const result = await probeProvider(provider({ api: "anthropic-messages" }));
  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["/v1/models"]);
  assert.equal(headers["x-api-key"], "sk-secret-value-123456");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, undefined, "no bearer token on the Anthropic path");
});

test("model ids are read from data[], models[], and Google's models/ prefix", async () => {
  handler = () => [200, JSON.stringify({ models: [{ name: "models/gemini-3-pro" }, "bare-string"] })];
  const result = await probeProvider(provider());
  assert.deepEqual(result.models, ["gemini-3-pro", "bare-string"]);
});

test("model-list capability hints are returned separately from the id list", async () => {
  handler = () => [200, JSON.stringify({ data: [
    { id: "grok-4.5", input_modalities: ["text", "image"], supports_reasoning: true },
    { id: "plain-model" },
  ] })];
  const result = await probeProvider(provider());
  assert.deepEqual(result.models, ["grok-4.5", "plain-model"]);
  assert.deepEqual(result.modelDetails, [{
    id: "grok-4.5",
    input_modalities: ["text", "image"],
    supports_reasoning: true,
  }]);
});

test("model-list context limits are preserved for automatic window inference", async () => {
  handler = () => [200, JSON.stringify({ data: [
    { id: "provider-large", context_length: 512000 },
    { id: "provider-nested", limits: { context_window: "1M" } },
  ] })];
  const result = await probeProvider(provider());
  assert.deepEqual(result.modelDetails, [
    { id: "provider-large", context_length: 512000 },
    { id: "provider-nested", limits: { context_window: "1M" } },
  ]);
});

test("a 200 that is not JSON yields an empty list rather than throwing", async () => {
  handler = () => [200, "<html>hello</html>", { "content-type": "text/html" }];
  const result = await probeProvider(provider());
  assert.equal(result.ok, true);
  assert.deepEqual(result.models, []);
});

test("a huge error body is truncated instead of filling the terminal", async () => {
  handler = () => [500, "x".repeat(5000), { "content-type": "text/plain" }];
  const result = await probeProvider(provider());
  assert.equal(result.ok, false);
  assert.ok(result.error.length < 400, `error was ${result.error.length} chars`);
});
