/**
 * store.js — read/write the Pi config files safely.
 *
 * Every mutation goes through writeJson: backup first, write to a temp file in
 * the same directory, then rename. A crash mid-write can't leave pi with a
 * truncated models.json (which makes pi refuse to start).
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync, closeSync, copyFileSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { paths } from "./paths.js";
import { validateModelsConfig } from "./validate.js";

/** Read a JSON file, returning `fallback` when it doesn't exist. */
export function readJson(file, fallback = null) {
  if (!existsSync(file)) return fallback;
  const raw = readFileSync(file, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

/**
 * Timestamp suffix for backup filenames: 20260726_224500_123
 *
 * Milliseconds are part of the name because several writes can land inside one
 * second — `import --all` rewrites models.json once per provider. With
 * second resolution those all collapse onto one filename and copyFileSync
 * overwrites, so the pre-import state would be lost.
 */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}`;
}

/** How many backups to keep per file. Older ones are pruned after each write. */
const BACKUP_RETAIN = 10;

/**
 * pi guards settings.json with proper-lockfile, which takes a lock by mkdir'ing
 * `<file>.lock` and refreshes its mtime while held; a lock older than `stale`
 * (10s by default) is treated as abandoned. Reproducing that protocol here means
 * a running pi and pi-switch cannot clobber each other's writes — pi rewrites
 * settings.json at runtime (Ctrl+P model switch, lastChangelogVersion), so a
 * read-modify-write without the lock can silently drop whichever landed first.
 */
const LOCK_STALE_MS = 10_000;
const LOCK_ATTEMPTS = 15;
const LOCK_DELAY_MS = 25;

function lockPath(file) {
  return `${file}.lock`;
}

/** Take the lock, waiting out a live holder and breaking a stale one. */
function acquireLock(file) {
  const dir = lockPath(file);
  // The lock lives beside the target, which may not exist yet — <cwd>/.pi/mcp.json
  // is created on the first `mcp disable` in a project.
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt++) {
    try {
      mkdirSync(dir);
      return () => {
        try {
          rmSync(dir, { recursive: true });
        } catch {
          /* already gone */
        }
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      // A holder that died without cleaning up leaves the dir behind forever.
      try {
        if (Date.now() - statSync(dir).mtimeMs > LOCK_STALE_MS) {
          rmSync(dir, { recursive: true });
          continue;
        }
      } catch {
        continue; // vanished between EEXIST and stat — try again
      }
      if (attempt === LOCK_ATTEMPTS) {
        throw new Error(
          `${basename(file)} is locked by another process (${dir}). Close the other pi-switch, or remove that directory if nothing holds it.`,
        );
      }
      sleep(LOCK_DELAY_MS);
    }
  }
  throw new Error(`could not lock ${file}`);
}

/** Block the thread briefly. The lock protocol is synchronous by necessity. */
function sleep(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* spin: ms is tiny and this path is contended only when pi is mid-write */
  }
}

/**
 * Copy `file` into the backup dir. Returns the backup path, or null if there was
 * nothing to back up.
 *
 * Backups inherit the source file's mode: models.json can hold a plaintext api
 * key, and a 0600 original must not become a 0644 copy.
 */
export function backup(file) {
  if (!existsSync(file)) return null;
  mkdirSync(paths.backups, { recursive: true, mode: 0o700 });
  const dest = join(paths.backups, `${basename(file)}.${stamp()}`);
  copyFileSync(file, dest);
  try {
    chmodSync(dest, statSync(file).mode & 0o777);
  } catch {
    /* a mode we cannot copy is not worth failing the write over */
  }
  pruneBackups(basename(file));
  return dest;
}

/** Keep only the newest BACKUP_RETAIN backups of one file. */
function pruneBackups(name) {
  let entries;
  try {
    entries = readdirSync(paths.backups)
      .filter(f => f.startsWith(`${name}.`))
      .sort(); // the timestamp suffix sorts chronologically
  } catch {
    return;
  }
  for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUP_RETAIN))) {
    try {
      rmSync(join(paths.backups, stale));
    } catch {
      /* leaving a stale backup behind is harmless */
    }
  }
}

/**
 * Atomically write JSON with a 2-space indent, backing up any previous version.
 *
 * The temp file carries a pid+timestamp suffix so two concurrent pi-switch runs
 * cannot write the same scratch path and hand each other a half-written file.
 * fsync before rename: rename is atomic with respect to the directory entry, but
 * without the flush a crash can leave the new inode present and empty.
 */
export function writeJson(file, data) {
  const backupPath = backup(file);
  mkdirSync(dirname(file), { recursive: true });

  // Preserve the existing mode; fall back to 0600 for a new file, since these
  // files can hold credentials.
  let mode = 0o600;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    /* new file — keep the restrictive default */
  }

  const tmp = `${file}.pi-switch-tmp.${process.pid}.${Date.now()}`;
  const fd = openSync(tmp, "wx", mode);
  try {
    writeSync(fd, `${JSON.stringify(data, null, 2)}\n`, null, "utf-8");
    fsyncSync(fd);
    // openSync honours `mode` only for a file it created; an inherited umask can
    // still clear bits, so assert the mode explicitly.
    if ((fstatSync(fd).mode & 0o777) !== mode) chmodSync(tmp, mode);
  } catch (err) {
    closeSync(fd);
    try {
      rmSync(tmp);
    } catch {
      /* nothing further to do */
    }
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, file);
  return backupPath;
}

// ---- models.json ----

/** Load the provider catalog. Always returns a { providers: {...} } shape. */
export function loadModels() {
  const data = readJson(paths.models, { providers: {} });
  if (!data.providers || typeof data.providers !== "object") data.providers = {};
  return data;
}

/**
 * Write models.json, but only after checking pi will accept it.
 *
 * pi loads zero providers when the file fails schema validation, so writing an
 * invalid document is the one bug in this tool that breaks pi outright. The
 * validation runs on the full document, not just the field being changed.
 */
export function saveModels(data) {
  validateModelsConfig(data);
  const release = acquireLock(paths.models);
  try {
    return writeJson(paths.models, data);
  } finally {
    release();
  }
}

/**
 * Read-modify-write models.json under a lock, so two pi-switch runs (or a
 * `sync --all` racing a `key` rotation) cannot lose one another's edit.
 */
export function updateModels(fn) {
  const release = acquireLock(paths.models);
  try {
    const current = readJson(paths.models, { providers: {} });
    if (!current.providers || typeof current.providers !== "object") current.providers = {};
    const next = fn(current) ?? current;
    validateModelsConfig(next);
    writeJson(paths.models, next);
    return next;
  } finally {
    release();
  }
}

/**
 * Read-modify-write any other pi-owned JSON file under the same lock protocol.
 * Used for the MCP override layers, which pi-mcp-adapter also writes.
 */
export function updateJson(file, fn, fallback = {}) {
  const release = acquireLock(file);
  try {
    const current = readJson(file, fallback);
    const next = fn(current) ?? current;
    writeJson(file, next);
    return next;
  } finally {
    release();
  }
}

// ---- settings.json ----

export function loadSettings() {
  return readJson(paths.settings, {});
}

/**
 * Read-modify-write settings.json under pi's own lock.
 *
 * `fn` receives the current settings and mutates them (or returns a replacement).
 * Reading inside the lock is the point: a running pi writes this file too, and
 * loading before the lock would let pi-switch write back a stale snapshot,
 * silently reverting whatever pi had just changed.
 */
export function updateSettings(fn) {
  const release = acquireLock(paths.settings);
  try {
    const current = readJson(paths.settings, {});
    const next = fn(current) ?? current;
    writeJson(paths.settings, next);
    return next;
  } finally {
    release();
  }
}

/**
 * Replace settings.json wholesale. Prefer updateSettings for anything derived
 * from the current contents.
 */
export function saveSettings(data) {
  const release = acquireLock(paths.settings);
  try {
    return writeJson(paths.settings, data);
  } finally {
    release();
  }
}

/**
 * Resolve an apiKey field the way pi does.
 *   "$FOO"          → process.env.FOO
 *   "!cmd arg…"     → stdout of the command (this is how the keychain lookup works)
 *   anything else   → literal
 * Returns { value, source, error }. `value` is null when it could not be resolved.
 */
export function resolveApiKey(spec) {
  if (typeof spec !== "string" || spec === "") {
    return { value: null, source: "missing", error: "no apiKey configured" };
  }
  if (spec.startsWith("$")) {
    const name = spec.slice(1);
    const value = process.env[name];
    return value
      ? { value, source: `env:${name}` }
      : { value: null, source: `env:${name}`, error: `$${name} is not set in this shell` };
  }
  if (spec.startsWith("!")) {
    const argv = spec.slice(1).trim().split(/\s+/);
    try {
      const out = execFileSync(argv[0], argv.slice(1), { encoding: "utf-8", timeout: 10_000 }).trim();
      return out
        ? { value: out, source: `cmd:${argv[0]}` }
        : { value: null, source: `cmd:${argv[0]}`, error: "command produced no output" };
    } catch (err) {
      return { value: null, source: `cmd:${argv[0]}`, error: err.message.split("\n")[0] };
    }
  }
  return { value: spec, source: "literal" };
}

/** True when the key is stored inline in models.json rather than in env/keychain. */
export function isInlineKey(spec) {
  return typeof spec === "string" && spec !== "" && !spec.startsWith("$") && !spec.startsWith("!");
}

/** Mask a secret for display: sk-abcd…wxyz */
export function maskKey(value) {
  if (!value) return "—";
  if (value.length <= 12) return `${value.slice(0, 3)}…`;
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}
