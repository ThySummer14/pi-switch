/**
 * Machine-readable launch contract shared by Pi Switch and desktop hosts.
 * This module is read-only: it resolves existing configuration and never writes
 * profiles, trust, settings, or project resources.
 */

import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { paths } from "./paths.js";
import { profileEnvironment, resolveProfile } from "./profiles.js";

const TRUST_REQUIRING_PROJECT_RESOURCES = [
  "settings.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
];
const RESOURCE_ROOTS = ["AGENTS.md", ".pi/settings.json", ".pi/subagents.json", ".pi/agents", ".pi/extensions"];
const MAX_MANIFEST_FILES = 512;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export function sha256(value) {
  const hash = createHash("sha256");
  if (typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array) {
    hash.update(value);
  } else {
    hash.update(JSON.stringify(value));
  }
  return hash.digest("hex");
}

export function loadModesConfig(file = join(paths.agentDir, "modes.json")) {
  if (!existsSync(file)) throw new Error(`modes config missing: ${file}`);
  let config;
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  if (!config.modes || typeof config.modes !== "object" || Array.isArray(config.modes)) {
    throw new Error(`${file} must contain a modes object`);
  }
  for (const [name, mode] of Object.entries(config.modes)) {
    if (!mode || typeof mode !== "object" || Array.isArray(mode)) {
      throw new Error(`mode "${name}" must be an object`);
    }
  }
  return config;
}

function canonicalDirectory(path, label) {
  try {
    const canonical = realpathSync.native(resolve(path));
    if (!statSync(canonical).isDirectory()) throw new Error("not-directory");
    return canonical;
  } catch {
    throw new Error(`${label} is not a directory: ${resolve(path)}`);
  }
}

function canonicalFile(path, label) {
  try {
    const canonical = realpathSync.native(resolve(path));
    const stat = statSync(canonical);
    accessSync(canonical, constants.X_OK);
    if (!stat.isFile()) throw new Error("not-file");
    return canonical;
  } catch {
    throw new Error(`${label} is not an executable file: ${resolve(path)}`);
  }
}

function isWithin(child, parent) {
  const suffix = relative(parent, child);
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`));
}

export function resolvePiExecutable({ executable = process.env.PI_SWITCH_PI_BIN, cwd } = {}) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const candidate = executable
    ? resolve(executable)
    : execFileSync(lookup, ["pi"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  if (!candidate) throw new Error(`PI_EXECUTABLE_NOT_FOUND: ${lookup} pi returned no path`);
  const canonical = canonicalFile(candidate, "Pi executable");
  if (cwd && isWithin(canonical, cwd)) {
    throw new Error(`PI_EXECUTABLE_PROJECT_LOCAL: ${canonical}`);
  }
  return canonical;
}

export function readPiVersion(piExecutable) {
  try {
    const version = execFileSync(piExecutable, ["--version"], { encoding: "utf8" }).trim();
    if (!version) throw new Error("empty version");
    return version;
  } catch (error) {
    throw new Error(`PI_VERSION_UNAVAILABLE: ${error.message}`);
  }
}

function hasTrustRequiringProjectResources(cwd, home = process.env.HOME) {
  const homeDir = canonicalDirectory(home || process.cwd(), "HOME");
  const userAgentsSkillsDir = join(homeDir, ".agents", "skills");
  let currentDir = cwd;
  const configDir = join(currentDir, ".pi");
  if (TRUST_REQUIRING_PROJECT_RESOURCES.some((entry) => existsSync(join(configDir, entry)))) return true;
  while (true) {
    const agentsSkillsDir = join(currentDir, ".agents", "skills");
    if (agentsSkillsDir !== userAgentsSkillsDir && existsSync(agentsSkillsDir)) return true;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return false;
    currentDir = parentDir;
  }
}

function readTrustStore(agentDir) {
  const trustPath = join(agentDir, "trust.json");
  if (!existsSync(trustPath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(trustPath, "utf8"));
  } catch (error) {
    throw new Error(`TRUST_STORE_INVALID: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TRUST_STORE_INVALID: expected an object");
  }
  for (const [path, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(`TRUST_STORE_INVALID: invalid value for ${path}`);
    }
  }
  return parsed;
}

function nearestTrustDecision(data, cwd) {
  let current = cwd;
  while (true) {
    if (data[current] === true || data[current] === false) return data[current];
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveProjectTrust(agentDir, cwd, home = process.env.HOME) {
  const resources = hasTrustRequiringProjectResources(cwd, home);
  const decision = nearestTrustDecision(readTrustStore(agentDir), cwd);
  if (decision === false) return { trust: "deny", trustSource: "stored-deny" };
  if (decision === true) return { trust: "approve", trustSource: "stored-approve" };
  if (!resources) return { trust: "approve", trustSource: "no-project-resources" };
  return { trust: "deny", trustSource: "missing-decision" };
}

export function computeResourceManifest(cwd) {
  const files = [];
  let truncated = false;
  const visit = (absolute) => {
    if (files.length >= MAX_MANIFEST_FILES) {
      truncated = true;
      return;
    }
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      truncated = true;
      return;
    }
    if (stat.isFile()) {
      files.push(absolute);
      return;
    }
    if (!stat.isDirectory()) return;
    let children;
    try {
      children = readdirSync(absolute).sort();
    } catch {
      truncated = true;
      return;
    }
    for (const child of children) visit(join(absolute, child));
  };
  for (const root of RESOURCE_ROOTS) visit(join(cwd, root));

  let byteCount = 0;
  const digest = createHash("sha256");
  for (const absolute of files.sort()) {
    const relativePath = relative(cwd, absolute).replaceAll("\\", "/");
    try {
      const contents = readFileSync(absolute);
      byteCount += contents.byteLength;
      if (byteCount > MAX_MANIFEST_BYTES) {
        truncated = true;
        break;
      }
      digest.update(relativePath).update("\0").update(sha256(contents)).update("\n");
    } catch {
      truncated = true;
      digest.update(relativePath).update("\0read-error\n");
    }
  }
  digest.update(`truncated=${truncated ? "1" : "0"}\n`);
  return {
    hash: digest.digest("hex"),
    fileCount: files.length,
    byteCount,
    truncated,
  };
}

export function resolveProfileLaunchSpec(name, options = {}) {
  const agentDir = resolve(options.agentDir ?? paths.agentDir);
  const profilesFile = options.profilesFile ?? join(agentDir, "profiles.json");
  const modesFile = options.modesFile ?? join(agentDir, "modes.json");
  const profile = resolveProfile(name, {
    file: profilesFile,
    currentCwd: options.currentCwd,
    useDesktopCwd: options.useDesktopCwd ?? true,
    requestedCwd: options.requestedCwd,
  });
  const modes = loadModesConfig(modesFile);
  if (!modes.modes[profile.mode]) {
    throw new Error(`PROFILE_MODE_MISSING: ${profile.name}:${profile.mode}`);
  }
  const canonicalCwd = canonicalDirectory(profile.cwd, `profile "${profile.name}" cwd`);
  const piExecutable = resolvePiExecutable({ executable: options.piExecutable, cwd: canonicalCwd });
  const expectedPiVersion = options.piVersion ?? readPiVersion(piExecutable);
  const trustResult = resolveProjectTrust(agentDir, canonicalCwd, options.home);
  const trustArg = trustResult.trust === "approve" ? "--approve" : "--no-approve";
  const argv = ["--mode", "rpc", "--mode-start", profile.mode, trustArg];
  if (profile.retryStallTimeoutMs !== undefined) {
    argv.push("--retry-stall-timeout-ms", String(profile.retryStallTimeoutMs));
  }
  const env = profileEnvironment(profile);
  const resourceManifest = computeResourceManifest(canonicalCwd);
  const spec = {
    profile: profile.name,
    label: profile.label,
    mode: profile.mode,
    piExecutable,
    canonicalCwd,
    argv,
    env,
    trust: trustResult.trust,
    trustSource: trustResult.trustSource,
    resourceManifestHash: resourceManifest.hash,
    resourceManifest,
    expectedPiVersion,
    piExecutableHash: sha256(piExecutable),
    profileConfigHash: sha256(readFileSync(profilesFile, "utf8")),
    modesConfigHash: sha256(readFileSync(modesFile, "utf8")),
  };
  return {
    ...spec,
    launchSpecHash: sha256({
      profile: spec.profile,
      mode: spec.mode,
      piExecutable: spec.piExecutable,
      canonicalCwd: spec.canonicalCwd,
      argv: spec.argv,
      env: spec.env,
      trust: spec.trust,
      resourceManifestHash: spec.resourceManifestHash,
      expectedPiVersion: spec.expectedPiVersion,
    }),
  };
}
