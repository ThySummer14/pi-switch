/**
 * The settings.json / models.json lock. pi holds this same lock (proper-lockfile,
 * `<file>.lock` as a directory) while it writes settings at runtime, so these
 * cases are about not clobbering a live pi.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-lock-"));
process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {} }));
writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "a", theme: "dusk" }));

const store = await import("../src/store.js");

const settingsFile = join(dir, "settings.json");
const lockDir = `${settingsFile}.lock`;

test("updateSettings reads inside the lock, so a concurrent pi write is not reverted", () => {
  // Simulate pi rewriting settings.json after we would have loaded it: the read
  // must happen under the lock, otherwise `theme` reverts to the stale value.
  writeFileSync(settingsFile, JSON.stringify({ defaultProvider: "a", theme: "changed-by-pi" }));

  store.updateSettings(settings => {
    settings.defaultModel = "m1";
  });

  const after = store.loadSettings();
  assert.equal(after.defaultModel, "m1", "our field was written");
  assert.equal(after.theme, "changed-by-pi", "pi's concurrent change survived");
});

test("the lock is released after a successful write and after a throw", () => {
  store.updateSettings(s => {
    s.marker = 1;
  });
  assert.equal(existsSync(lockDir), false, "released on success");

  assert.throws(() => store.updateSettings(() => {
    throw new Error("boom");
  }), /boom/);
  assert.equal(existsSync(lockDir), false, "released on failure");
});

test("a lock held by a live process blocks the write and says which file", () => {
  mkdirSync(lockDir);
  try {
    assert.throws(
      () => store.updateSettings(s => {
        s.shouldNotLand = true;
      }),
      /settings\.json is locked by another process/,
    );
    assert.equal(store.loadSettings().shouldNotLand, undefined, "nothing was written");
  } finally {
    rmSync(lockDir, { recursive: true });
  }
});

test("a stale lock left by a crashed process is broken, not waited on forever", () => {
  mkdirSync(lockDir);
  // proper-lockfile treats a lock older than 10s as abandoned.
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockDir, old, old);

  store.updateSettings(s => {
    s.afterStale = true;
  });
  assert.equal(store.loadSettings().afterStale, true);
  assert.equal(existsSync(lockDir), false);
});

test("updateModels validates before writing, leaving the old file intact", () => {
  store.updateModels(models => {
    models.providers.good = { baseUrl: "https://x", api: "openai-completions", apiKey: "k", models: [{ id: "m" }] };
  });

  assert.throws(
    () => store.updateModels(models => {
      models.providers.bad = { baseUrl: "https://x", api: "openai-completions", apiKey: "", models: [{ id: "m" }] };
    }),
    /must not be empty/,
  );

  const models = store.loadModels();
  assert.deepEqual(Object.keys(models.providers), ["good"], "the rejected provider was not written");
  assert.equal(existsSync(`${join(dir, "models.json")}.lock`), false, "lock released after the rejection");
});
