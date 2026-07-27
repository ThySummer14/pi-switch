/**
 * agents.js — list and validate pi subagents (@tintinweb/pi-subagents).
 *
 * The loader's rules are strict and fail silently, so every check here targets a
 * way an agent file can look correct and still never load:
 *   - loadFromDir does readdirSync().filter(endsWith(".md")) — no recursion, so a
 *     file in a subdirectory (e.g. agents/cc-plugins/) is never seen.
 *   - frontmatter keys are snake_case; camelCase keys are ignored silently.
 *   - list fields are comma-separated STRINGS; a YAML array is stringified and
 *     produces garbage tool names.
 *   - `model:` must name a model that actually exists in models.json — Claude
 *     Code's bare "sonnet"/"opus" do not resolve.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { paths } from "./paths.js";
import { loadModels, loadSettings } from "./store.js";

/** Built-in tool names, as reported by pi 0.82 (createCodingTools + createReadOnlyTools). */
export const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/** Frontmatter keys the loader reads. Anything else is dead weight. */
const KNOWN_KEYS = new Set([
  "display_name", "description", "tools", "disallowed_tools",
  "extensions", "inherit_extensions", "exclude_extensions",
  "skills", "inherit_skills", "model", "thinking", "max_turns",
  "persist_session", "output_transcript", "session_dir",
  "prompt_mode", "inherit_context", "run_in_background",
  "isolated", "memory", "isolation", "enabled",
]);

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const CSV_FIELDS = ["tools", "disallowed_tools", "exclude_extensions", "extensions", "skills"];

/** Directories the loader scans, lowest precedence first. */
export function agentDirs(cwd = process.cwd()) {
  return [
    { id: "global", dir: paths.agents },
    { id: "workspace", dir: join(cwd, ".agents", "agents") },
    { id: "project", dir: join(cwd, ".pi", "agents") },
  ];
}

/** All agents, later dirs overriding earlier ones by filename. */
export function listAgents(cwd = process.cwd()) {
  const byName = new Map();
  for (const { id, dir } of agentDirs(cwd)) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const file = join(dir, e.name);
      byName.set(basename(e.name, ".md"), { ...parseAgent(file), source: id });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Read one agent file and validate it. */
export function parseAgent(file) {
  const name = basename(file, ".md");
  let raw;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (err) {
    return { name, file, problems: [{ level: "error", message: `unreadable: ${err.message}` }], frontmatter: {} };
  }
  const { frontmatter, body, hadBlock } = parseFrontmatter(raw);
  const problems = validate({ frontmatter, body, hadBlock });
  return {
    name,
    file,
    frontmatter,
    displayName: frontmatter.display_name || name,
    description: frontmatter.description || "",
    enabled: frontmatter.enabled !== false && frontmatter.enabled !== "false",
    model: frontmatter.model,
    thinking: frontmatter.thinking,
    tools: frontmatter.tools,
    problems,
  };
}

/**
 * Minimal YAML frontmatter reader — flat `key: value` only, which is all the
 * loader itself supports for these files. A leading `- ` line marks a YAML list,
 * which is reported rather than parsed.
 */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text, hadBlock: false };
  const frontmatter = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s*-\s+/.test(line)) {
      if (lastKey) frontmatter[`${lastKey}__yamlList`] = true;
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1];
    let value = kv[2].trim().replace(/^["']|["']$/g, "");
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value !== "" && /^-?\d+$/.test(value)) value = Number(value);
    frontmatter[lastKey] = value;
  }
  return { frontmatter, body: m[2], hadBlock: true };
}

/** Collect every reason this agent might not behave as written. */
function validate({ frontmatter, body, hadBlock }) {
  const problems = [];
  const err = message => problems.push({ level: "error", message });
  const warn = message => problems.push({ level: "warn", message });

  if (!hadBlock) {
    err("no YAML frontmatter block — the loader will read no config at all");
    return problems;
  }
  if (!frontmatter.description) warn("no description — the parent model has nothing to route on");
  if (!body.trim()) err("empty body — the agent gets no system prompt");

  for (const key of Object.keys(frontmatter)) {
    if (key.endsWith("__yamlList")) {
      const field = key.replace("__yamlList", "");
      err(`${field}: is a YAML list — this field must be a comma-separated string ("read, grep, bash")`);
      continue;
    }
    if (KNOWN_KEYS.has(key)) continue;
    const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (KNOWN_KEYS.has(snake)) err(`"${key}" is camelCase — the loader only reads snake_case ("${snake}")`);
    else warn(`"${key}" is not a key the loader reads — it is ignored`);
  }

  for (const field of CSV_FIELDS) {
    const value = frontmatter[field];
    if (typeof value !== "string" || value === "" || value === "none") continue;
    if (value.startsWith("[")) {
      err(`${field}: looks like an inline array — use a comma-separated string`);
      continue;
    }
    const items = value.split(",").map(s => s.trim()).filter(Boolean);
    if (field === "tools") {
      for (const item of items) {
        if (item === "*" || item.toLowerCase() === "all" || item.startsWith("ext:")) continue;
        if (!BUILTIN_TOOLS.includes(item)) {
          err(`tools: "${item}" is not a built-in tool (have: ${BUILTIN_TOOLS.join(", ")}; use "ext:name" for extension tools)`);
        }
      }
    }
  }

  if (frontmatter.thinking != null && !THINKING_LEVELS.includes(String(frontmatter.thinking))) {
    err(`thinking: "${frontmatter.thinking}" is not a level (${THINKING_LEVELS.join(", ")})`);
  }
  if (frontmatter.prompt_mode != null && !["append", "replace"].includes(String(frontmatter.prompt_mode))) {
    warn(`prompt_mode: "${frontmatter.prompt_mode}" is neither append nor replace — the loader falls back to replace`);
  }
  if (frontmatter.memory != null && !["user", "project", "local"].includes(String(frontmatter.memory))) {
    warn(`memory: "${frontmatter.memory}" is not user/project/local — it is ignored`);
  }
  if (frontmatter.model) problems.push(...validateModel(String(frontmatter.model)));

  return problems;
}

/**
 * A `model:` value must resolve against models.json. Claude Code's bare aliases
 * ("sonnet", "opus", "haiku") are the common carry-over mistake.
 */
function validateModel(spec) {
  const models = loadModels();
  const [maybeProvider, maybeId] = spec.includes("/") ? spec.split("/", 2) : [null, spec];
  const bare = maybeId.split(":")[0];

  if (maybeProvider) {
    const provider = models.providers[maybeProvider];
    if (!provider) return [{ level: "error", message: `model: provider "${maybeProvider}" is not in models.json` }];
    if (!(provider.models || []).some(m => m.id === bare)) {
      return [{ level: "error", message: `model: "${bare}" is not defined under provider "${maybeProvider}"` }];
    }
    return [];
  }

  const owners = Object.entries(models.providers).filter(([, p]) => (p.models || []).some(m => m.id === bare));
  if (owners.length > 0) return [];
  if (["sonnet", "opus", "haiku", "fable"].includes(bare.toLowerCase())) {
    return [{
      level: "error",
      message: `model: "${spec}" is a Claude Code alias, not a pi model — use a real id or delete the field`,
    }];
  }
  return [{ level: "warn", message: `model: "${spec}" matches no id in models.json (pi will fuzzy-match or fail at spawn)` }];
}

/**
 * Files that look like agents but sit where the loader cannot see them:
 * anything nested one level below an agents dir.
 */
export function unreachableAgentFiles(cwd = process.cwd()) {
  const out = [];
  for (const { id, dir } of agentDirs(cwd)) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const sub = join(dir, e.name);
      let names = [];
      try {
        names = readdirSync(sub).filter(f => f.endsWith(".md"));
      } catch {
        continue;
      }
      if (names.length > 0) {
        const ccPluginsOwned = sub === paths.ccPluginsAgents
          || (e.name === "cc-plugins" && existsSync(join(sub, ".cc-plugins-refcount")));
        out.push({
          source: id,
          dir: sub,
          count: names.length,
          ccPluginsOwned,
        });
      }
    }
  }
  return out;
}

/** Extension packages installed via settings.packages, for the overview panel. */
export function listPackages() {
  const settings = loadSettings();
  return (settings.packages || []).map(entry =>
    typeof entry === "string" ? { source: entry, filtered: null } : { source: entry.source, filtered: entry.extensions || null },
  );
}

/** Locally installed extension dirs (~/.pi/agent/extensions). */
export function listLocalExtensions() {
  const dir = join(paths.agentDir, "extensions");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ name: d.name, dir: join(dir, d.name) }));
  } catch {
    return [];
  }
}

/** Used by the doctor command to flag an agents dir that is a file, etc. */
export function agentDirStatus(cwd = process.cwd()) {
  return agentDirs(cwd).map(({ id, dir }) => {
    if (!existsSync(dir)) return { id, dir, state: "absent" };
    return { id, dir, state: statSync(dir).isDirectory() ? "ok" : "not-a-directory" };
  });
}
