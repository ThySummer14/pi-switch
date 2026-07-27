import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-desktop-"));
const secret = "sk-bridge-secret-must-not-leak";
const fakePi = join(dir, "fake-pi");
const fakePiArgs = join(dir, "fake-pi-args.txt");

writeFileSync(fakePi, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PI_SWITCH_TEST_ARGS\"\nexit 0\n");
chmodSync(fakePi, 0o700);

writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "m1" }));
writeFileSync(join(dir, "profiles.json"), JSON.stringify({ defaultProfile: "code", profiles: { code: { mode: "code", cwd: dir } } }));
writeFileSync(join(dir, "models.json"), JSON.stringify({
  providers: {
    relay: {
      baseUrl: "https://relay.example",
      api: "openai-completions",
      apiKey: secret,
      models: [{ id: "m1" }],
    },
  },
}));

test("desktop dashboard exposes key state but never the key value", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "dashboard", payload: {} }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(secret), false);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.data.providers[0].keyInline, true);
  assert.equal(response.data.providers[0].keyOk, true);
  assert.equal("apiKeySpec" in response.data.providers[0], false);
});

test("desktop reveals a provider key only through the explicit read action", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir },
    input: JSON.stringify({ action: "readProviderKey", payload: { name: "relay" } }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, data: { key: secret } });
});

test("desktop connection test runs the selected model through pi", () => {
  const result = spawnSync(process.execPath, ["desktop/bridge.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
      PI_SWITCH_PI_BIN: fakePi,
      PI_SWITCH_TEST_ARGS: fakePiArgs,
    },
    input: JSON.stringify({ action: "testProvider", payload: { name: "relay" } }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  assert.equal(response.data.ok, true);
  assert.equal(response.data.model, "m1");
  const args = readFileSync(fakePiArgs, "utf8").split("\n");
  assert.deepEqual(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 2), ["--provider", "relay"]);
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "m1"]);
  assert.equal(args.includes("--no-session"), true);
  assert.equal(args.includes(secret), false);
});
