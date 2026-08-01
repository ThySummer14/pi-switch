import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-profiles-"));
const novel = join(dir, "novel");
mkdirSync(novel);
process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(join(dir, "profiles.json"), JSON.stringify({
  defaultProfile: "code",
  profiles: {
    code: { label: "Code", mode: "code", desktopCwd: dir },
    novel: {
      label: "Novel",
      mode: "novel",
      cwd: novel,
      retryStallTimeoutMs: 300000,
    },
    missing: { mode: "obsidian", cwd: join(dir, "missing") },
  },
}));

const { buildProfileArgs, profileEnvironment, listProfiles, resolveProfile } = await import("../src/profiles.js");

test("the default code profile keeps the caller cwd", () => {
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  const profile = resolveProfile(undefined, { currentCwd: cwd });
  assert.equal(profile.name, "code");
  assert.equal(profile.cwd, cwd);
  assert.equal(profile.cwdSource, "caller");
  assert.equal(profile.desktopCwd, dir);
  assert.equal(profile.mode, "code");
  assert.deepEqual(profileEnvironment(profile), {});
});

test("desktop resolution uses desktopCwd without making CLI code cwd fixed", () => {
  const profile = resolveProfile("code", { currentCwd: "/Applications/Pi Switch.app/Contents/Resources", useDesktopCwd: true });
  assert.equal(profile.cwd, dir);
  assert.equal(profile.cwdSource, "desktop");
  assert.equal(profile.fixedCwd, false);
});

test("a fixed profile resolves its cwd and pins mode-start", () => {
  const profile = resolveProfile("novel", { currentCwd: dir });
  assert.equal(profile.cwd, novel);
  assert.deepEqual(buildProfileArgs(profile, ["--help"]), [
    "--mode-start", "novel", "--retry-stall-timeout-ms", "300000", "--help",
  ]);
  assert.deepEqual(profileEnvironment(profile), { PI_RETRY_STALL_TIMEOUT_MS: "300000" });
});

test("profile listing marks fixed, default, and missing entries", () => {
  const rows = listProfiles({ currentCwd: dir });
  assert.equal(rows.find(row => row.name === "code")?.isDefault, true);
  assert.equal(rows.find(row => row.name === "novel")?.fixedCwd, true);
  assert.equal(rows.find(row => row.name === "missing")?.exists, false);
});

test("unknown and missing profile targets fail clearly", () => {
  assert.throws(() => resolveProfile("nope", { currentCwd: dir }), /unknown profile/);
  assert.throws(() => resolveProfile("missing", { currentCwd: dir }), /cwd is not a directory/);
});

test("profile retry timeout must be a non-negative integer", () => {
  const invalidFile = join(dir, "invalid-profiles.json");
  writeFileSync(invalidFile, JSON.stringify({
    defaultProfile: "invalidArgs",
    profiles: { invalidArgs: { mode: "code", retryStallTimeoutMs: -1 } },
  }));
  assert.throws(
    () => resolveProfile("invalidArgs", { file: invalidFile, currentCwd: dir }),
    /retryStallTimeoutMs must be a non-negative integer/,
  );
});

test("desktopCwd rejects ambiguous or relative profile roots", () => {
  const invalidFile = join(dir, "invalid-desktop-profiles.json");
  writeFileSync(invalidFile, JSON.stringify({
    profiles: { ambiguous: { mode: "code", cwd: dir, desktopCwd: dir } },
  }));
  assert.throws(() => listProfiles({ file: invalidFile }), /cannot define both/);
  writeFileSync(invalidFile, JSON.stringify({
    profiles: { relative: { mode: "code", desktopCwd: "relative/repo" } },
  }));
  assert.throws(() => listProfiles({ file: invalidFile }), /must be absolute/);
});
