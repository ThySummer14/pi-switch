import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-switch-skills-"));
process.env.PI_CODING_AGENT_DIR = dir;
const excluded = "!/Users/example/.claude/skills/duplicate/SKILL.md";
const missingInclude = "+/Users/example/.claude/skills/missing/SKILL.md";
writeFileSync(join(dir, "settings.json"), JSON.stringify({ skills: [excluded, missingInclude] }));

const { listSkillPaths, listSkills, pruneSkillPaths } = await import("../src/skills.js");

test("skill override patterns are not treated as missing paths", () => {
  assert.deepEqual(listSkillPaths(), [{
    entry: excluded,
    resolved: excluded,
    exists: true,
    kind: "exclude",
    count: 0,
    names: [],
  }, {
    entry: missingInclude,
    resolved: "/Users/example/.claude/skills/missing/SKILL.md",
    exists: false,
    kind: "missing",
    count: 0,
    names: [],
    selector: "include",
  }]);
  assert.deepEqual(listSkills(), []);
  assert.deepEqual(pruneSkillPaths(), [missingInclude]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).skills, [excluded]);
});

test("skill override patterns render as neutral exclusions", () => {
  const cli = join(import.meta.dirname, "..", "bin", "pi-switch.mjs");
  const result = spawnSync(process.execPath, [cli, "skills", "ls", "--no-color"], {
    encoding: "utf8",
    env: { ...process.env, PI_CODING_AGENT_DIR: dir, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /○\s+-\s+exclude\s+!/);
  assert.doesNotMatch(result.stdout, /!\s+0\s+exclude/);
});
