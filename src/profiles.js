/**
 * Startup profile resolution for `pi-switch run`.
 *
 * A profile chooses a working directory and pins mode-switcher at process start.
 * Project-local .pi/settings.json files own package filtering for that directory.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
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

export function listProfiles({ file = paths.profiles, currentCwd = process.cwd() } = {}) {
  const config = loadProfileConfig(file);
  return Object.entries(config.profiles).map(([name, spec]) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error(`profile "${name}" must be an object`);
    }
    const cwd = spec.cwd ? resolve(untildify(spec.cwd)) : resolve(currentCwd);
    return {
      name,
      label: spec.label ?? name,
      mode: spec.mode ?? name,
      cwd,
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
  return ["--mode-start", profile.mode, ...extraArgs];
}
