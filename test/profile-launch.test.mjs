import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-switch-launch-"));
const agentDir = join(root, "agent");
const code = join(root, "code");
const novel = join(root, "novel");
const outside = join(root, "outside");
for (const path of [agentDir, code, novel, outside]) mkdirSync(path, { recursive: true });
const profilesFile = join(agentDir, "profiles.json");
const modesFile = join(agentDir, "modes.json");
writeFileSync(profilesFile, JSON.stringify({
  defaultProfile: "code",
  profiles: {
    code: { label: "Code", mode: "code", desktopCwd: code },
    novel: { label: "Novel", mode: "novel", cwd: novel, retryStallTimeoutMs: 300000 },
  },
}));
writeFileSync(modesFile, JSON.stringify({
  defaultMode: "code",
  modes: { code: { label: "Code" }, novel: { label: "Novel" } },
}));
const home = join(root, "home");
mkdirSync(home, { recursive: true });

const { resolveProfileLaunchSpec, resolveProjectTrust } = await import("../src/profile-launch.js");

test("resolves a requested Code cwd into the RPC launch contract", () => {
  const spec = resolveProfileLaunchSpec("code", {
    agentDir,
    profilesFile,
    modesFile,
    requestedCwd: outside,
    piExecutable: process.execPath,
    piVersion: "0.83.0-test",
    home,
  });
  assert.equal(spec.profile, "code");
  assert.equal(spec.canonicalCwd, realpathSync.native(outside));
  assert.deepEqual(spec.argv, ["--mode", "rpc", "--mode-start", "code", "--approve"]);
  assert.equal(spec.env.PI_RETRY_STALL_TIMEOUT_MS, undefined);
  assert.equal(spec.trust, "approve");
  assert.match(spec.resourceManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(spec.expectedPiVersion, "0.83.0-test");
  assert.match(spec.launchSpecHash, /^[a-f0-9]{64}$/);
});

test("fixed profiles reject a desktop cwd outside their configured root", () => {
  assert.throws(() => resolveProfileLaunchSpec("novel", {
    agentDir,
    profilesFile,
    modesFile,
    requestedCwd: outside,
    piExecutable: process.execPath,
    piVersion: "0.83.0-test",
    home,
  }), /cwd is fixed/);
});

test("trust fails closed when project resources have no stored decision", () => {
  mkdirSync(join(outside, ".pi"), { recursive: true });
  writeFileSync(join(outside, ".pi", "settings.json"), "{}");
  assert.deepEqual(resolveProjectTrust(agentDir, outside, home), {
    trust: "deny",
    trustSource: "missing-decision",
  });
  writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [outside]: true }));
  assert.deepEqual(resolveProjectTrust(agentDir, outside, home), {
    trust: "approve",
    trustSource: "stored-approve",
  });
});
