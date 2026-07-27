/**
 * Frontmatter validation — every case here is a real way a pi agent file loads
 * without error but does not behave as written.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Point the whole module at a throwaway agent dir before importing anything that
// reads config, so model validation runs against a fixture and not the real setup.
const dir = mkdtempSync(join(tmpdir(), "pi-switch-agents-"));
process.env.PI_CODING_AGENT_DIR = dir;
writeFileSync(
  join(dir, "models.json"),
  JSON.stringify({ providers: { relay: { baseUrl: "https://example.test", api: "anthropic-messages", models: [{ id: "claude-opus-5" }] } } }),
);

const { parseAgent, unreachableAgentFiles } = await import("../src/agents.js");

function agentFile(name, content) {
  const file = join(dir, `${name}.md`);
  writeFileSync(file, content, "utf-8");
  return parseAgent(file);
}

const errors = a => a.problems.filter(p => p.level === "error").map(p => p.message);
const warns = a => a.problems.filter(p => p.level === "warn").map(p => p.message);

test("a well-formed agent has no problems", () => {
  const a = agentFile("good", `---
display_name: Reviewer
description: Reviews code.
tools: read, grep, bash
thinking: high
prompt_mode: replace
---

You review code.
`);
  assert.deepEqual(a.problems, []);
  assert.equal(a.displayName, "Reviewer");
  assert.equal(a.enabled, true);
});

test("a YAML array for tools is rejected — the loader stringifies it", () => {
  const a = agentFile("yaml-list", `---
description: x
tools:
  - read
  - grep
---

body
`);
  assert.match(errors(a).join("\n"), /tools: is a YAML list/);
});

test("an inline array for tools is rejected too", () => {
  const a = agentFile("inline-list", `---
description: x
tools: [read, grep]
---

body
`);
  assert.match(errors(a).join("\n"), /looks like an inline array/);
});

test("camelCase keys are flagged with their snake_case form", () => {
  const a = agentFile("camel", `---
description: x
displayName: Nope
promptMode: append
---

body
`);
  const joined = errors(a).join("\n");
  assert.match(joined, /"displayName" is camelCase.*"display_name"/);
  assert.match(joined, /"promptMode" is camelCase.*"prompt_mode"/);
});

test("a tool name that is not built-in is an error, ext: selectors are fine", () => {
  const bad = agentFile("bad-tool", `---
description: x
tools: read, websearch
---

body
`);
  assert.match(errors(bad).join("\n"), /"websearch" is not a built-in tool/);

  const good = agentFile("ext-tool", `---
description: x
tools: read, ext:pi-web-access
---

body
`);
  assert.deepEqual(errors(good), []);
});

test("Claude Code model aliases are rejected", () => {
  const a = agentFile("alias", `---
description: x
model: sonnet
---

body
`);
  assert.match(errors(a).join("\n"), /Claude Code alias, not a pi model/);
});

test("a model that exists in models.json passes, provider-qualified or bare", () => {
  const bare = agentFile("model-bare", `---
description: x
model: claude-opus-5
---

body
`);
  assert.deepEqual(bare.problems, []);

  const qualified = agentFile("model-qualified", `---
description: x
model: relay/claude-opus-5
---

body
`);
  assert.deepEqual(qualified.problems, []);

  const wrongProvider = agentFile("model-wrong-provider", `---
description: x
model: nope/claude-opus-5
---

body
`);
  assert.match(errors(wrongProvider).join("\n"), /provider "nope" is not in models.json/);
});

test("a bogus thinking level is an error", () => {
  const a = agentFile("think", `---
description: x
thinking: turbo
---

body
`);
  assert.match(errors(a).join("\n"), /thinking: "turbo" is not a level/);
});

test("missing frontmatter and an empty body are errors", () => {
  const none = agentFile("no-fm", "just a body\n");
  assert.match(errors(none).join("\n"), /no YAML frontmatter/);

  const empty = agentFile("empty", `---
description: x
---
`);
  assert.match(errors(empty).join("\n"), /empty body/);
});

test("unknown keys warn rather than error, and a missing description warns", () => {
  const a = agentFile("unknown", `---
tools: read
colour: blue
---

body
`);
  const joined = warns(a).join("\n");
  assert.match(joined, /no description/);
  assert.match(joined, /"colour" is not a key the loader reads/);
  assert.deepEqual(errors(a), []);
});

test("enabled: false is reported as disabled", () => {
  const a = agentFile("off", `---
description: x
enabled: false
---

body
`);
  assert.equal(a.enabled, false);
});

test("project cc-plugins agents are recognized as generated and owned", () => {
  const cwd = join(dir, "project");
  const generated = join(cwd, ".pi", "agents", "cc-plugins");
  mkdirSync(generated, { recursive: true });
  writeFileSync(join(generated, ".cc-plugins-refcount"), "1");
  for (const name of ["reviewer", "security", "tester"]) {
    writeFileSync(join(generated, `${name}.md`), "generated\n");
  }

  const finding = unreachableAgentFiles(cwd).find(row => row.dir === generated);
  assert.equal(finding?.count, 3);
  assert.equal(finding?.ccPluginsOwned, true);
});
