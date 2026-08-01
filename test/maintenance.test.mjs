import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadMaintenanceChecks, repairCommand, runMaintenanceChecks } from "../src/maintenance.js";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-switch-maintenance-"));
  const manifest = path.join(dir, "maintenance-checks.json");
  return { dir, manifest };
}

function writeManifest(file, checks) {
  writeFileSync(file, `${JSON.stringify({ schemaVersion: 1, checks })}\n`);
}

test("maintenance checks map the three documented exit codes without exposing output", () => {
  const { dir, manifest } = fixture();
  const scripts = [0, 1, 2].map((exitCode) => {
    const script = path.join(dir, `check-${exitCode}.mjs`);
    writeFileSync(script, `console.error("secret-${exitCode}"); process.exit(${exitCode});\n`);
    return script;
  });
  writeManifest(manifest, scripts.map((script, index) => ({ id: `check-${index}`, label: `Check ${index}`, script })));

  const results = runMaintenanceChecks({ file: manifest });
  assert.deepEqual(results.map(result => result.status), ["ok", "missing", "incompatible"]);
  assert.equal(JSON.stringify(results).includes("secret-"), false);
});

test("maintenance registry rejects shell-shaped or ambiguous entries", () => {
  const { dir, manifest } = fixture();
  const relative = path.join("..", "check.mjs");
  writeManifest(manifest, [{ id: "unsafe", label: "Unsafe", script: relative }]);
  assert.throws(() => loadMaintenanceChecks(manifest), /absolute \.mjs path/);

  writeManifest(manifest, [{ id: "unsafe", label: "Unsafe", script: path.join(dir, "check.js") }]);
  assert.throws(() => loadMaintenanceChecks(manifest), /absolute \.mjs path/);

  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, checks: [], command: "sh -c anything" }));
  assert.throws(() => loadMaintenanceChecks(manifest), /unknown field/);
});

test("missing and non-regular scripts fail without execution", () => {
  const { dir, manifest } = fixture();
  writeManifest(manifest, [{ id: "missing", label: "Missing", script: path.join(dir, "missing.mjs") }]);
  assert.deepEqual(runMaintenanceChecks({ file: manifest })[0], {
    id: "missing",
    label: "Missing",
    script: path.join(dir, "missing.mjs"),
    status: "invalid",
    reason: "script does not exist",
  });

	const directory = path.join(dir, "directory.mjs");
	mkdirSync(directory);
	writeManifest(manifest, [{ id: "directory", label: "Directory", script: directory }]);
	assert.equal(runMaintenanceChecks({ file: manifest })[0].status, "invalid");
});

test("repair command quotes paths but never accepts configurable arguments", () => {
  assert.equal(repairCommand("/tmp/check.mjs"), "node /tmp/check.mjs");
  assert.equal(repairCommand("/tmp/with space/check.mjs"), "node '/tmp/with space/check.mjs'");
});
