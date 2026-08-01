import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-doctor-"));
process.env.PI_CODING_AGENT_DIR = dir;

writeFileSync(join(dir, "settings.json"), "{}\n");
writeFileSync(join(dir, "profiles.json"), JSON.stringify({
  defaultProfile: "code",
  profiles: { code: { mode: "code", cwd: dir } },
}));
writeFileSync(join(dir, "models.json"), JSON.stringify({
  providers: { broken: { models: [{ id: "" }] } },
}));
mkdirSync(join(dir, "agents"));
writeFileSync(join(dir, "agents", "model-user.md"), "---\nmodel: missing/model\n---\nReview code.\n");

const { runDoctor } = await import("../src/doctor.js");

test("doctor reports an invalid models.json without entering model-dependent checks", async () => {
  const findings = await runDoctor({ cwd: dir });
  const invalid = findings.find(item => item.area === "files" && item.message.startsWith("models.json invalid:"));
  assert.equal(invalid?.level, "error");
  assert.match(invalid?.message ?? "", /providers\.broken\.models\.0\.id/);
});

test("doctor maps maintenance status without exposing check output", async () => {
  const scripts = [0, 1, 2].map((exitCode) => {
    const script = join(dir, `maintenance-${exitCode}.mjs`);
    writeFileSync(script, `console.error("private-${exitCode}"); process.exit(${exitCode});\n`);
    return script;
  });
  writeFileSync(join(dir, "maintenance-checks.json"), JSON.stringify({
    schemaVersion: 1,
    checks: scripts.map((script, index) => ({ id: `patch-${index}`, label: `Patch ${index}`, script })),
  }));

  const findings = await runDoctor({ cwd: dir });
  const maintenance = findings.filter(item => item.area === "maintenance");
  assert.deepEqual(maintenance.map(item => item.level), ["ok", "error", "error"]);
  assert.match(maintenance[1].fix ?? "", /node .*maintenance-1\.mjs/);
  assert.match(maintenance[2].message, /automatic repair is disabled/);
  assert.equal(JSON.stringify(maintenance).includes("private-"), false);
});

test("doctor rejects a missing desktop launch directory", async () => {
  const missing = join(dir, "missing-desktop-root");
  writeFileSync(join(dir, "profiles.json"), JSON.stringify({
    defaultProfile: "code",
    profiles: { code: { mode: "code", desktopCwd: missing } },
  }));
  const findings = await runDoctor({ cwd: dir });
  const profileFinding = findings.find(item => item.area === "profiles" && item.message.includes("desktopCwd"));
  assert.equal(profileFinding?.level, "error");
  assert.equal(profileFinding?.message, "code: desktopCwd does not exist");
});
