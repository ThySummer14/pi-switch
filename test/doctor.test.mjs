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
