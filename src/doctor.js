/**
 * doctor.js — one pass over the whole config looking for the ways a pi setup
 * breaks quietly. Each finding names the file and what to do about it.
 */

import { existsSync } from "node:fs";
import { agentDirStatus, listAgents, unreachableAgentFiles } from "./agents.js";
import { listServers } from "./mcp.js";
import { paths, tildify } from "./paths.js";
import { listProfiles } from "./profiles.js";
import { listProviders, probeProvider, diffModels } from "./providers.js";
import { listCcPlugins, listSkillPaths } from "./skills.js";
import { loadModels, loadSettings } from "./store.js";
import { validateModelsConfig } from "./validate.js";

/** { level: "error"|"warn"|"ok", area, message, fix? } */
function finding(level, area, message, fix) {
  return { level, area, message, fix };
}

/**
 * Run every check. `probe` also hits the network for each provider, which is
 * slower but is the only way to catch a wrong model id or a dead key.
 */
export async function runDoctor({ probe = false, cwd = process.cwd() } = {}) {
  const findings = [];
  const fileFindings = checkFiles();
  findings.push(...fileFindings);
  const modelsInvalid = fileFindings.some(
    item => item.level === "error" && item.area === "files" && item.message.startsWith("models.json invalid:"),
  );
  if (!modelsInvalid) findings.push(...checkDefaults());
  findings.push(...checkProfiles());
  if (!modelsInvalid) findings.push(...checkProviderKeys());
  if (!modelsInvalid) findings.push(...checkAgents(cwd));
  findings.push(...checkSkills());
  findings.push(...checkMcp(cwd));
  if (probe && !modelsInvalid) findings.push(...(await checkReachability()));
  return findings;
}

function checkProfiles() {
  let profiles;
  try {
    profiles = listProfiles();
  } catch (err) {
    return [finding("error", "profiles", err.message, tildify(paths.profiles))];
  }
  const out = [];
  const defaultProfile = profiles.find(profile => profile.isDefault);
  if (!defaultProfile) {
    out.push(finding("error", "profiles", "defaultProfile does not name a configured profile", tildify(paths.profiles)));
  }
  for (const profile of profiles) {
    if (!profile.exists) {
      out.push(finding("error", "profiles", `${profile.name}: cwd does not exist`, profile.cwd));
    }
  }
  if (out.length === 0) {
    out.push(finding("ok", "profiles", `${profiles.length} startup profile(s) valid; default=${defaultProfile.name}`));
  }
  return out;
}

function checkFiles() {
  const out = [];
  if (!existsSync(paths.settings)) {
    out.push(finding("error", "files", `settings.json missing at ${tildify(paths.settings)}`, "run pi once to create it"));
  }
  if (!existsSync(paths.models)) {
    out.push(finding("warn", "files", `models.json missing at ${tildify(paths.models)}`, "pi will fall back to built-in providers only"));
  } else {
    try {
      validateModelsConfig(loadModels());
    } catch (err) {
      out.push(finding("error", "files", `models.json invalid: ${err.message}`, tildify(paths.models)));
    }
  }
  return out;
}

function checkDefaults() {
  const settings = loadSettings();
  const providers = listProviders();
  const out = [];
  const name = settings.defaultProvider;
  if (!name) {
    out.push(finding("warn", "default", "settings.defaultProvider is unset", "pi-switch use <provider>"));
    return out;
  }
  const provider = providers.find(p => p.name === name);
  if (!provider) {
    out.push(finding(
      "error",
      "default",
      `defaultProvider "${name}" is not defined in models.json`,
      "pi refuses to start — pick an existing provider with pi-switch use",
    ));
    return out;
  }
  if (settings.defaultModel && !provider.models.includes(settings.defaultModel)) {
    out.push(finding(
      "error",
      "default",
      `defaultModel "${settings.defaultModel}" is not defined under provider "${name}"`,
      `available: ${provider.models.join(", ")}`,
    ));
  }
  return out;
}

function checkProviderKeys() {
  const out = [];
  for (const p of listProviders()) {
    if (!p.keyOk) {
      out.push(finding("error", "key", `${p.name}: ${p.keyError}`, keyFix(p)));
      continue;
    }
    if (p.keyInline) {
      out.push(finding(
        "warn",
        "key",
        `${p.name}: api key is stored in plaintext in models.json`,
        `pi-switch key ${p.name} --keychain moves it into the login keychain`,
      ));
    }
    if ((p.models || []).length === 0) {
      out.push(finding("warn", "provider", `${p.name}: no models defined`, "pi cannot select this provider"));
    }
  }
  return out;
}

function keyFix(p) {
  if (p.keySource?.startsWith("env:")) return `export ${p.keySource.slice(4)}=… in your shell rc`;
  if (p.keySource?.startsWith("cmd:")) return "the key command failed — check the keychain entry exists";
  return `pi-switch key ${p.name}`;
}

function checkAgents(cwd) {
  const out = [];
  for (const dir of agentDirStatus(cwd)) {
    if (dir.state === "not-a-directory") {
      out.push(finding("error", "agents", `${tildify(dir.dir)} exists but is not a directory`));
    }
  }
  for (const nested of unreachableAgentFiles(cwd)) {
    out.push(finding(
      nested.ccPluginsOwned ? "ok" : "error",
      "agents",
      nested.ccPluginsOwned
        ? `${nested.count} converted agent(s) in ${tildify(nested.dir)} (cc-plugins owned — the subagents loader does not read subdirectories, so these are inert)`
        : `${nested.count} agent file(s) in ${tildify(nested.dir)} will never load — the loader does not recurse into subdirectories`,
      nested.ccPluginsOwned
        ? "expected: cc-plugins bridges skills, not agents. Hand-write pi agents in the agents/ root."
        : `move them up into ${tildify(paths.agents)}`,
    ));
    if (nested.ccPluginsOwned) {
      out.push(finding(
        "warn",
        "agents",
        `never hand-write files into ${tildify(nested.dir)} — cc-plugins rm -rf's that directory when its refcount hits zero`,
      ));
    }
  }
  for (const agent of listAgents(cwd)) {
    for (const problem of agent.problems) {
      out.push(finding(problem.level, "agents", `${agent.name}.md — ${problem.message}`, tildify(agent.file)));
    }
  }
  return out;
}

function checkSkills() {
  const out = [];
  for (const row of listSkillPaths()) {
    if (!row.exists) {
      out.push(finding("error", "skills", `settings.skills path does not exist: ${row.entry}`, "pi-switch skills prune"));
      continue;
    }
    if (row.count === 0) {
      out.push(finding("warn", "skills", `${row.entry} contains no SKILL.md`, "the entry loads nothing"));
    }
  }
  for (const plugin of listCcPlugins()) {
    if (plugin.exists === false) {
      out.push(finding("error", "skills", `ccPlugins path does not exist: ${plugin.local}`, "remove it from settings.ccPlugins"));
    }
  }
  return out;
}

function checkMcp(cwd) {
  const out = [];
  const servers = listServers(cwd);
  if (servers.length === 0) {
    out.push(finding("warn", "mcp", "no MCP servers configured in any layer"));
  }
  for (const s of servers) {
    for (const [name, value] of Object.entries(s.env || {})) {
      if (typeof value === "string" && /^\$\{?(\w+)\}?$/.test(value)) {
        const varName = value.replace(/[${}]/g, "");
        if (!process.env[varName]) {
          out.push(finding("warn", "mcp", `${s.name}: env ${name} references $${varName}, which is unset in this shell`));
        }
      }
    }
  }
  return out;
}

async function checkReachability() {
  const out = [];
  const providers = listProviders();
  const results = await Promise.all(
    providers.map(async p => ({ p, result: await probeProvider(p.raw) })),
  );
  for (const { p, result } of results) {
    if (!result.ok) {
      out.push(finding("error", "reach", `${p.name}: ${result.error}`, p.baseUrl));
      continue;
    }
    const diff = diffModels(p.models, result.models);
    if (!diff.unknown && diff.missing.length > 0) {
      out.push(finding(
        "error",
        "reach",
        `${p.name}: model(s) ${diff.missing.join(", ")} are configured but the endpoint does not list them`,
        "requests will fail with model_not_found",
      ));
    }
    for (const a of diff.aliased ?? []) {
      out.push(finding(
        "warn",
        "reach",
        `${p.name}: "${a.id}" is not listed verbatim — the endpoint offers ${a.candidates.join(", ")}`,
        "usually an undated alias the relay accepts; pin the dated id to be sure",
      ));
    }
    out.push(finding("ok", "reach", `${p.name}: reachable in ${result.ms}ms, ${result.models.length} models listed`));
  }
  return out;
}
