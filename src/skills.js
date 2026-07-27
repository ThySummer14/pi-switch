/**
 * skills.js — manage settings.skills[] and settings.ccPlugins[].
 *
 * pi loads skills from explicit paths in settings.skills, so a stale path is a
 * silent no-op: nothing errors, the skill just isn't there. Every entry is
 * stat'ed and counted here so that failure mode is visible.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { untildify } from "./paths.js";
import { loadSettings, updateSettings } from "./store.js";

/**
 * One row per settings.skills entry.
 * A path is either a single skill dir (contains SKILL.md) or a parent dir of
 * skill dirs — pi accepts both, so both are counted.
 */
export function listSkillPaths() {
  const settings = loadSettings();
  return (settings.skills || []).map(entry => {
    const resolved = untildify(entry);
    if (!existsSync(resolved)) {
      return { entry, resolved, exists: false, kind: "missing", count: 0, names: [] };
    }
    const st = statSync(resolved);
    if (st.isFile()) {
      return { entry, resolved, exists: true, kind: "file", count: 1, names: [basename(resolved)] };
    }
    if (existsSync(join(resolved, "SKILL.md"))) {
      return { entry, resolved, exists: true, kind: "skill", count: 1, names: [basename(resolved)] };
    }
    const names = childSkills(resolved);
    return { entry, resolved, exists: true, kind: "dir", count: names.length, names };
  });
}

/** Subdirectories of `dir` that contain a SKILL.md. */
function childSkills(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map(d => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every skill reachable from settings, deduped by name, with its source path. */
export function listSkills() {
  const out = new Map();
  for (const row of listSkillPaths()) {
    if (!row.exists) continue;
    for (const name of row.names) {
      const dir = row.kind === "dir" ? join(row.resolved, name) : row.resolved;
      if (!out.has(name)) out.set(name, { name, dir, from: row.entry, description: readDescription(dir) });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Pull `description:` out of a SKILL.md frontmatter block. */
function readDescription(dir) {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return "";
  try {
    const head = readFileSync(file, "utf-8").slice(0, 4000);
    const m = head.match(/^description:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, "").slice(0, 120) : "";
  } catch {
    return "";
  }
}

/** Append a path to settings.skills. Rejects duplicates and nonexistent paths. */
export function addSkillPath(entry) {
  const resolved = untildify(entry);
  if (!existsSync(resolved)) throw new Error(`path does not exist: ${resolved}`);
  updateSettings(settings => {
    settings.skills = settings.skills || [];
    if (settings.skills.includes(entry)) throw new Error(`already in settings.skills: ${entry}`);
    settings.skills.push(entry);
  });
  return entry;
}

export function removeSkillPath(entry) {
  updateSettings(settings => {
    const before = (settings.skills || []).length;
    settings.skills = (settings.skills || []).filter(s => s !== entry);
    if (settings.skills.length === before) throw new Error(`not found in settings.skills: ${entry}`);
  });
}

/** Drop every settings.skills entry whose path no longer exists. */
export function pruneSkillPaths() {
  const dead = listSkillPaths().filter(r => !r.exists).map(r => r.entry);
  if (dead.length === 0) return [];
  updateSettings(settings => {
    settings.skills = (settings.skills || []).filter(s => !dead.includes(s));
  });
  return dead;
}

/** ccPlugins entries — the Claude Code plugin bridge. */
export function listCcPlugins() {
  const settings = loadSettings();
  return (settings.ccPlugins || []).map(entry => {
    const spec = typeof entry === "string" ? entry : entry.source;
    const local = typeof spec === "string" && spec.startsWith("local:") ? spec.slice("local:".length) : null;
    return {
      entry,
      spec,
      local,
      exists: local ? existsSync(local) : null,
    };
  });
}
