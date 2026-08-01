import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { paths } from "./paths.js";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_LABEL_LENGTH = 80;

export function loadMaintenanceChecks(file = paths.maintenanceChecks) {
  if (!existsSync(file)) return [];

  let document;
  try {
    document = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`maintenance checks are not valid JSON: ${error.message}`);
  }

  if (!isPlainObject(document) || document.schemaVersion !== 1 || !Array.isArray(document.checks)) {
    throw new Error("maintenance checks must contain schemaVersion 1 and a checks array");
  }
  rejectUnknownKeys(document, ["schemaVersion", "checks"], "maintenance checks");

  const seen = new Set();
  return document.checks.map((entry, index) => {
    const location = `maintenance checks entry ${index}`;
    if (!isPlainObject(entry)) throw new Error(`${location} must be an object`);
    rejectUnknownKeys(entry, ["id", "label", "script"], location);
    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
      throw new Error(`${location}.id must match ${ID_PATTERN}`);
    }
    if (seen.has(entry.id)) throw new Error(`${location}.id duplicates "${entry.id}"`);
    seen.add(entry.id);
    if (
      typeof entry.label !== "string"
      || entry.label.length === 0
      || entry.label.length > MAX_LABEL_LENGTH
      || /[\r\n\0]/.test(entry.label)
    ) {
      throw new Error(`${location}.label must be a single line of 1-${MAX_LABEL_LENGTH} characters`);
    }
    if (typeof entry.script !== "string" || !path.isAbsolute(entry.script) || path.extname(entry.script) !== ".mjs") {
      throw new Error(`${location}.script must be an absolute .mjs path`);
    }
    return { id: entry.id, label: entry.label, script: path.normalize(entry.script) };
  });
}

export function runMaintenanceChecks({
  file = paths.maintenanceChecks,
  nodePath = process.execPath,
  timeoutMs = 15_000,
  spawn = spawnSync,
} = {}) {
  return loadMaintenanceChecks(file).map((check) => {
    let stats;
    try {
      stats = lstatSync(check.script);
    } catch {
      return { ...check, status: "invalid", reason: "script does not exist" };
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { ...check, status: "invalid", reason: "script is not a regular file" };
    }

    const result = spawn(nodePath, [check.script, "--check"], {
      cwd: path.dirname(check.script),
      env: process.env,
      stdio: "ignore",
      timeout: timeoutMs,
    });
    if (result.status === 0) return { ...check, status: "ok", exitCode: 0 };
    if (result.status === 1) return { ...check, status: "missing", exitCode: 1 };
    if (result.status === 2) return { ...check, status: "incompatible", exitCode: 2 };
    return {
      ...check,
      status: "failed",
      exitCode: result.status,
      reason: result.error?.code === "ETIMEDOUT" ? "check timed out" : "check failed unexpectedly",
    };
  });
}

export function repairCommand(script) {
  return `node ${shellQuote(script)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(object, allowed, location) {
  const unknown = Object.keys(object).filter(key => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${location} contains unknown field(s): ${unknown.join(", ")}`);
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}
