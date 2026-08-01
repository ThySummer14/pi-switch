import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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

test("doctor reports local and skipped network stages through the optional callback", async () => {
  const stages = [];
  await runDoctor({ cwd: dir, probe: true, onStage: stage => stages.push(stage) });
  assert.deepEqual(stages.map(stage => stage.id), ["local", "network"]);
  assert.equal(stages[0].ok, false);
  assert.match(stages[1].detail, /models\.json 无效/);
});

test("doctor reports a successful Provider network stage", async () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "relay", defaultModel: "m1" }));
  writeFileSync(join(dir, "profiles.json"), JSON.stringify({
    defaultProfile: "code",
    profiles: { code: { mode: "code", cwd: dir } },
  }));
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "m1" }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {
      relay: {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        api: "openai-completions",
        apiKey: "doctor-stage-key",
        models: [{ id: "m1" }],
      },
    } }));
    const stages = [];
    const findings = await runDoctor({ cwd: dir, probe: true, onStage: stage => stages.push(stage) });
    assert.ok(Array.isArray(findings));
    assert.deepEqual(stages.map(stage => stage.id), ["local", "network"]);
    assert.equal(stages[1].ok, true);
    assert.match(stages[1].detail, /1 个 Provider 已检查/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("doctor capability warnings keep their capability area", async () => {
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "known", defaultModel: "grok-4.5" }));
  writeFileSync(join(dir, "profiles.json"), JSON.stringify({
    defaultProfile: "code",
    profiles: { code: { mode: "code", cwd: dir } },
  }));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: {
    known: {
      baseUrl: "https://known.example",
      api: "openai-completions",
      apiKey: "doctor-capability-key",
      models: [{ id: "grok-4.5", input: ["text"], reasoning: false }],
    },
  } }));

  const findings = await runDoctor({ cwd: dir });
  const reasoningWarning = findings.find(item => item.message.includes("reasoning is disabled but the model family is known to support it"));
  assert.equal(reasoningWarning?.level, "warn");
  assert.equal(reasoningWarning?.area, "capability");
  assert.equal(findings.some(item => item.area === "warn"), false);
});
