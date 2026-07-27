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
    code: { label: "Code", mode: "code" },
    novel: { label: "Novel", mode: "novel", cwd: novel },
    missing: { mode: "obsidian", cwd: join(dir, "missing") },
  },
}));

const { buildProfileArgs, listProfiles, resolveProfile } = await import("../src/profiles.js");

test("the default code profile keeps the caller cwd", () => {
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  const profile = resolveProfile(undefined, { currentCwd: cwd });
  assert.equal(profile.name, "code");
  assert.equal(profile.cwd, cwd);
  assert.equal(profile.mode, "code");
});

test("a fixed profile resolves its cwd and pins mode-start", () => {
  const profile = resolveProfile("novel", { currentCwd: dir });
  assert.equal(profile.cwd, novel);
  assert.deepEqual(buildProfileArgs(profile, ["--help"]), ["--mode-start", "novel", "--help"]);
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
