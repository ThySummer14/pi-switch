/**
 * Startup profile resolution for `pi-switch run`.
 *
 * A profile chooses a working directory and pins mode-switcher at process start.
 * Project-local .pi/settings.json files own package filtering for that directory.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { paths, untildify } from "./paths.js";

export function loadProfileConfig(file = paths.profiles) {
  if (!existsSync(file)) throw new Error(`profiles config missing: ${file}`);
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) {
    throw new Error(`${file} must contain a profiles object`);
  }
  return config;
}

export function listProfiles({ file = paths.profiles, currentCwd = process.cwd(), useDesktopCwd = false } = {}) {
  const config = loadProfileConfig(file);
  return Object.entries(config.profiles).map(([name, spec]) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error(`profile "${name}" must be an object`);
    }
    if (spec.retryStallTimeoutMs !== undefined
      && (!Number.isInteger(spec.retryStallTimeoutMs) || spec.retryStallTimeoutMs < 0)) {
      throw new Error(`profile "${name}" retryStallTimeoutMs must be a non-negative integer`);
    }
    if (spec.desktopCwd !== undefined
      && (typeof spec.desktopCwd !== "string" || !spec.desktopCwd.trim())) {
      throw new Error(`profile "${name}" desktopCwd must be a non-empty string`);
    }
    if (spec.cwd && spec.desktopCwd) {
      throw new Error(`profile "${name}" cannot define both cwd and desktopCwd`);
    }
    const desktopCwd = spec.desktopCwd ? untildify(spec.desktopCwd) : null;
    if (desktopCwd && !isAbsolute(desktopCwd)) {
      throw new Error(`profile "${name}" desktopCwd must be absolute or start with ~`);
    }
    const preferDesktopCwd = useDesktopCwd && !spec.cwd && desktopCwd;
    const cwd = spec.cwd
      ? resolve(untildify(spec.cwd))
      : preferDesktopCwd
        ? resolve(desktopCwd)
        : resolve(currentCwd);
    return {
      name,
      label: spec.label ?? name,
      mode: spec.mode ?? name,
      cwd,
      cwdSource: spec.cwd ? "profile" : preferDesktopCwd ? "desktop" : "caller",
      desktopCwd: desktopCwd ? resolve(desktopCwd) : null,
      desktopCwdExists: desktopCwd ? existsSync(desktopCwd) : null,
      retryStallTimeoutMs: spec.retryStallTimeoutMs,
      fixedCwd: Boolean(spec.cwd),
      exists: existsSync(cwd),
      isDefault: name === config.defaultProfile,
    };
  });
}

export function resolveProfile(name, options = {}) {
  const config = loadProfileConfig(options.file ?? paths.profiles);
  const selected = name || config.defaultProfile;
  if (!selected) throw new Error("no profile specified and defaultProfile is unset");
  const profile = listProfiles(options).find(row => row.name === selected);
  if (!profile) {
    throw new Error(`unknown profile "${selected}"; available: ${Object.keys(config.profiles).join(", ")}`);
  }
  if (!profile.exists || !statSync(profile.cwd).isDirectory()) {
    throw new Error(`profile "${selected}" cwd is not a directory: ${profile.cwd}`);
  }
  return profile;
}

export function buildProfileArgs(profile, extraArgs = []) {
  const retryArgs = profile.retryStallTimeoutMs === undefined
    ? []
    : ["--retry-stall-timeout-ms", String(profile.retryStallTimeoutMs)];
  return ["--mode-start", profile.mode, ...retryArgs, ...extraArgs];
}

export function profileEnvironment(profile) {
  return profile.retryStallTimeoutMs === undefined
    ? {}
    : { PI_RETRY_STALL_TIMEOUT_MS: String(profile.retryStallTimeoutMs) };
}
