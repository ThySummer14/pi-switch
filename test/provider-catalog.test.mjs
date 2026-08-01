import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PROVIDER_PRESETS } from "../src/provider-presets.js";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-provider-catalog-"));
process.env.PI_CODING_AGENT_DIR = dir;

const catalog = await import("../src/provider-catalog.js");
const { paths } = await import("../src/paths.js");
const published = JSON.parse(readFileSync(new URL("../catalog/provider-presets.json", import.meta.url), "utf8"));

test("published catalog is valid and matches the credential-free bundled templates", () => {
  const normalized = catalog.validateProviderCatalog(published);
  assert.deepEqual(normalized.presets, PROVIDER_PRESETS.filter(preset => preset.id !== "custom"));
  assert.equal(JSON.stringify(normalized).includes("apiKey"), false);
});

test("catalog validation rejects credentials, unknown fields, insecure endpoints, and duplicate ids", () => {
  const base = published.presets[0];
  assert.throws(
    () => catalog.validateProviderCatalog({ ...published, presets: [{ ...base, apiKey: "must-not-enter-a-catalog" }] }),
    /不允许字段 apiKey/,
  );
  assert.throws(
    () => catalog.validateProviderCatalog({ ...published, presets: [{ ...base, baseUrl: "http://api.example.test" }] }),
    /必须使用 HTTPS/,
  );
  assert.throws(
    () => catalog.validateProviderCatalog({ ...published, presets: [base, { ...base }] }),
    /重复的模板标识/,
  );
  assert.throws(
    () => catalog.validateProviderCatalog({ ...published, version: 2 }),
    /不支持的模板目录版本/,
  );
});

test("sync uses the fixed source, writes only the separate cache, and verifies its fingerprint", async () => {
  const modelsPath = join(dir, "models.json");
  const secret = "catalog-test-secret-must-stay-in-models";
  const modelsBody = JSON.stringify({ providers: {
    relay: { baseUrl: "https://relay.example", api: "openai-completions", apiKey: secret, models: [{ id: "m1" }] },
  } });
  writeFileSync(modelsPath, modelsBody);
  const remote = structuredClone(published);
  remote.updatedAt = "2026-08-01T01:02:03.000Z";
  remote.presets[0].model = "gpt-5.1";
  let request;

  const result = await catalog.syncProviderCatalog({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(remote), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    now: () => new Date("2026-08-01T02:03:04.000Z"),
  });

  assert.equal(request.url, catalog.PROVIDER_CATALOG_URL);
  assert.equal(request.options.redirect, "error");
  assert.deepEqual(request.options.headers, { accept: "application/json" });
  assert.equal(result.source, "remote-cache");
  assert.equal(result.presetCount, remote.presets.length);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(result.changes.added, remote.presets.map(preset => preset.id));
  assert.equal(catalog.getProviderCatalog().presets.find(preset => preset.id === "openai").model, "gpt-5.1");
  assert.equal(readFileSync(modelsPath, "utf8"), modelsBody);
  assert.equal(statSync(paths.providerCatalog).mode & 0o777, 0o600);

  const cache = JSON.parse(readFileSync(paths.providerCatalog, "utf8"));
  cache.catalog.presets[0].model = "tampered-model";
  writeFileSync(paths.providerCatalog, JSON.stringify(cache));
  const fallback = catalog.getProviderCatalog();
  assert.equal(fallback.status.source, "bundled");
  assert.match(fallback.status.error, /缓存无效/);
  assert.equal(fallback.presets.find(preset => preset.id === "openai").model, "gpt-5");

  const reset = catalog.resetProviderCatalog();
  assert.equal(reset.source, "bundled");
  assert.equal(reset.error, null);
  assert.equal(readFileSync(modelsPath, "utf8"), modelsBody);
});

test("an invalid remote response never replaces the current cache", async () => {
  const validText = JSON.stringify(published);
  await catalog.syncProviderCatalog({
    fetchImpl: async () => new Response(validText, { status: 200 }),
    now: () => new Date("2026-08-01T03:00:00.000Z"),
  });
  const before = readFileSync(paths.providerCatalog, "utf8");
  await assert.rejects(
    catalog.syncProviderCatalog({
      fetchImpl: async () => new Response(JSON.stringify({ ...published, presets: [{ ...published.presets[0], token: "bad" }] }), { status: 200 }),
    }),
    /不允许字段 token/,
  );
  await assert.rejects(
    catalog.syncProviderCatalog({
      fetchImpl: async () => new Response("x".repeat((128 * 1024) + 1), { status: 200 }),
    }),
    /远程模板目录过大/,
  );
  assert.equal(readFileSync(paths.providerCatalog, "utf8"), before);
});
