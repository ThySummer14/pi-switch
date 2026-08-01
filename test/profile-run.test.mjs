import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-run-"));
const fakePi = join(dir, "fake-pi");
const capture = join(dir, "capture.json");

writeFileSync(fakePi, `#!/bin/sh
node -e 'require("fs").writeFileSync(process.env.PI_SWITCH_TEST_CAPTURE, JSON.stringify({ args: process.argv.slice(1), timeout: process.env.PI_RETRY_STALL_TIMEOUT_MS }))' -- "$@"
`);
chmodSync(fakePi, 0o700);
writeFileSync(join(dir, "profiles.json"), JSON.stringify({
  defaultProfile: "novel",
  profiles: {
    novel: { mode: "novel", cwd: dir, retryStallTimeoutMs: 300000 },
  },
}));

test("run passes the retry timeout to the parent arguments and inherited environment", () => {
  const result = spawnSync(process.execPath, ["bin/pi-switch.mjs", "run", "novel"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
      PI_SWITCH_PI_BIN: fakePi,
      PI_SWITCH_TEST_CAPTURE: capture,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), {
    args: ["--mode-start", "novel", "--retry-stall-timeout-ms", "300000"],
    timeout: "300000",
  });
});

test("dry-run displays both retry propagation paths", () => {
  const result = spawnSync(process.execPath, ["bin/pi-switch.mjs", "run", "novel", "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PI_CODING_AGENT_DIR: dir, PI_SWITCH_PI_BIN: fakePi, NO_COLOR: "1" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PI_RETRY_STALL_TIMEOUT_MS=300000/);
  assert.match(result.stdout, /--retry-stall-timeout-ms 300000/);
});
