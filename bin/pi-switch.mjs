#!/usr/bin/env node
/**
 * pi-switch — provider / model / MCP / skill / agent switcher for the Pi coding agent.
 *
 * Bare invocation opens the TUI. Every action also has a subcommand so it can be
 * scripted or run over a pipe.
 */

import { spawnSync } from "node:child_process";
import { listAgents, unreachableAgentFiles } from "../src/agents.js";
import { runDoctor } from "../src/doctor.js";
import { ccSwitchAvailable, planImportNames, readCcSwitchProviders } from "../src/import-ccswitch.js";
import { keychainSpec, parseKeychainSpec, serviceNameFor, setKey } from "../src/keychain.js";
import { listServers, setDisabled } from "../src/mcp.js";
import { createModelDefaults } from "../src/model-capabilities.js";
import { paths, tildify } from "../src/paths.js";
import { buildProfileArgs, profileEnvironment, listProfiles, resolveProfile } from "../src/profiles.js";
import { resolveProfileLaunchSpec } from "../src/profile-launch.js";
import {
  deleteProvider, diffModels, listProviders, patchProvider, planModelCapabilityRefresh,
  probeProvider, refreshModelCapabilities,
  setDefault, setThinking, THINKING_LEVELS, upsertModel, upsertProvider,
} from "../src/providers.js";
import { addSkillPath, listCcPlugins, listSkillPaths, listSkills, pruneSkillPaths, removeSkillPath } from "../src/skills.js";
import { loadSettings } from "../src/store.js";
import { color, glyph, out, pad, paint, truncate } from "../src/term.js";
import { printFindings, runUi } from "../src/ui.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith("-")));
const args = argv.filter(a => !a.startsWith("-"));
const json = flags.has("--json");
const VERSION = "0.4.0";

const HELP = `${paint("pi-switch", color.bold)} — cc-switch for the Pi coding agent

${paint("usage", color.bold)}
  pi-switch                          open the interactive switcher
  pi-switch profiles                list startup profiles
  pi-switch resolve-profile <name>  print a machine-readable launch contract
  pi-switch run [profile]           launch pi in code / novel / obsidian profile
  pi-switch ls                       list providers and the active default
  pi-switch use <provider> [model]   set settings.defaultProvider / defaultModel
  pi-switch thinking [level]         show or set settings.defaultThinkingLevel
  pi-switch test [provider]          probe endpoints and compare model lists
  pi-switch key <provider>           rotate an api key (reads from stdin)
  pi-switch add                      add a provider non-interactively (see flags)
  pi-switch rm <provider>            delete a provider
  pi-switch sync <provider>          add models the endpoint lists but models.json lacks
  pi-switch import [--all]           import providers from cc-switch (read-only)
  pi-switch mcp [ls]                 list MCP servers across all config layers
  pi-switch mcp enable|disable <n>   toggle a server in a pi-owned layer
  pi-switch skills [ls|prune]        inspect settings.skills / drop dead paths
  pi-switch skills add|rm <path>     manage a settings.skills entry
  pi-switch agents [ls]              list subagents and validate their frontmatter
  pi-switch doctor [--probe]         check the whole config for silent breakage
  pi-switch paths                    print every file pi-switch reads or writes

${paint("flags", color.bold)}
  --json          machine-readable output where it applies
  --cwd <path>    requested Code workspace for resolve-profile
  --no-color      plain text
  --probe         let doctor hit the network
  --all           import/act on everything without prompting
  --keychain      store the key in the macOS login keychain (default on darwin)
  --plaintext     write the key into models.json instead
  --dry-run       print a profile launch without starting pi
  --name --url --api --model --key    fields for \`add\`

${paint("notes", color.bold)}
  Changes to models.json / settings.json take effect the next time pi starts.
  Every write is backed up to ${tildify(paths.backups)} first.
  cc-switch's database is only ever read.
`;

async function main() {
  // `run` forwards Pi flags verbatim, so handle it before global flag parsing.
  if (argv[0] === "run") return cmdRun(argv.slice(1));
  if (flags.has("-h") || flags.has("--help")) return out(HELP);
  if (flags.has("-v") || flags.has("--version")) return out(`${VERSION}\n`);

  const [command, ...rest] = args;
  switch (command) {
    case undefined:
      return runUi();
    case "ls":
    case "list":
      return cmdList();
    case "profiles":
      return cmdProfiles();
    case "resolve-profile":
      return cmdResolveProfile(rest);
    case "use":
      return cmdUse(rest);
    case "thinking":
      return cmdThinking(rest);
    case "test":
      return cmdTest(rest);
    case "key":
      return cmdKey(rest);
    case "add":
      return cmdAdd();
    case "rm":
    case "remove":
      return cmdRemove(rest);
    case "sync":
      return cmdSync(rest);
    case "import":
      return cmdImport();
    case "mcp":
      return cmdMcp(rest);
    case "skills":
      return cmdSkills(rest);
    case "agents":
      return cmdAgents(rest);
    case "doctor":
      return cmdDoctor();
    case "paths":
      return cmdPaths();
    default:
      throw new Error(`unknown command "${command}" — pi-switch --help`);
  }
}

// ---- commands ----

function cmdProfiles() {
  const profiles = listProfiles();
  if (json) return out(`${JSON.stringify(profiles, null, 2)}\n`);
  out(paint(`${pad("", 2)}${pad("profile", 14)}${pad("mode", 12)}cwd\n`, color.grey, color.bold));
  for (const profile of profiles) {
    const mark = profile.isDefault ? paint(glyph.on, color.green) : paint(glyph.off, color.grey);
    const cwd = profile.fixedCwd ? tildify(profile.cwd) : "<current cwd>";
    const rendered = profile.exists ? cwd : paint(`${cwd} (missing)`, color.red);
    out(`${mark} ${pad(profile.name, 14)}${pad(profile.mode, 12)}${rendered}  ${paint(profile.label, color.grey)}\n`);
  }
}

function cmdResolveProfile([profileName]) {
  if (!profileName) throw new Error("usage: pi-switch resolve-profile <name> --json [--cwd <path>]");
  const spec = resolveProfileLaunchSpec(profileName, {
    requestedCwd: flagValue("cwd"),
    useDesktopCwd: true,
  });
  if (json) return out(`${JSON.stringify(spec, null, 2)}\n`);
  out(`${paint(spec.profile, color.bold)}  ${spec.mode}  ${spec.canonicalCwd}\n`);
  out(`  ${paint("Pi", color.grey)} ${spec.piExecutable} (${spec.expectedPiVersion})\n`);
  out(`  ${paint("trust", color.grey)} ${spec.trust} (${spec.trustSource})\n`);
  out(`  ${paint("argv", color.grey)} ${spec.argv.join(" ")}\n`);
  out(`  ${paint("resource", color.grey)} ${spec.resourceManifestHash}\n`);
}

function cmdRun(raw) {
  const dryRun = raw.includes("--dry-run");
  const separator = raw.indexOf("--");
  const controls = separator >= 0 ? raw.slice(0, separator) : raw;
  const profileIndex = controls.findIndex(arg => arg !== "--dry-run" && !arg.startsWith("-"));
  const profileName = profileIndex >= 0 ? controls[profileIndex] : undefined;
  const extraArgs = separator >= 0
    ? raw.slice(separator + 1)
    : controls.filter((arg, index) => index !== profileIndex && arg !== "--dry-run");
  const profile = resolveProfile(profileName);
  const piArgs = buildProfileArgs(profile, extraArgs);
  const profileEnv = profileEnvironment(profile);
  const command = process.env.PI_SWITCH_PI_BIN || "pi";

  if (dryRun) {
    const quote = value => /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
    out(`${paint(profile.name, color.bold)}  cwd=${tildify(profile.cwd)}\n`);
    const envPrefix = Object.entries(profileEnv).map(([key, value]) => `${key}=${quote(value)}`);
    out(`${[...envPrefix, command, ...piArgs].map((part, index) => index < envPrefix.length ? part : quote(part)).join(" ")}\n`);
    return;
  }

  out(paint(`profile=${profile.name} mode=${profile.mode} cwd=${tildify(profile.cwd)}\n`, color.grey));
  const result = spawnSync(command, piArgs, {
    cwd: profile.cwd,
    env: { ...process.env, ...profileEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`pi terminated by signal ${result.signal}`);
  process.exitCode = result.status ?? 1;
}

function cmdList() {
  const providers = listProviders();
  if (json) return out(`${JSON.stringify(providers.map(stripRaw), null, 2)}\n`);
  const settings = loadSettings();
  out(`${paint("active", color.grey)} ${settings.defaultProvider ?? "—"}/${settings.defaultModel ?? "—"}`);
  out(paint(`  thinking=${settings.defaultThinkingLevel ?? "default"}\n\n`, color.grey));
  out(paint(`${pad("", 2)}${pad("provider", 14)}${pad("api", 22)}${pad("key", 24)}models\n`, color.grey, color.bold));
  for (const p of providers) {
    const mark = p.isDefault ? paint(glyph.on, color.green) : paint(glyph.off, color.grey);
    const key = p.keyOk
      ? paint(p.keyInline ? "inline (plaintext)" : p.keySource, p.keyInline ? color.yellow : color.grey)
      : paint(truncate(p.keyError ?? "unresolved", 22), color.red);
    out(`${mark} ${pad(p.name, 14)}${pad(paint(p.api ?? "?", color.grey), 22)}${pad(key, 24)}${p.models.join(", ")}\n`);
  }
}

function stripRaw(p) {
  const { raw, modelObjects, ...rest } = p;
  return rest;
}

function cmdUse([providerName, modelId]) {
  if (!providerName) throw new Error("usage: pi-switch use <provider> [model]");
  const result = setDefault(providerName, modelId);
  out(`${paint(glyph.ok, color.green)} default is now ${paint(`${result.provider}/${result.model}`, color.bold)}\n`);
  out(paint("  restart pi to pick it up\n", color.grey));
}

async function cmdTest([providerName]) {
  const providers = listProviders().filter(p => !providerName || p.name === providerName);
  if (providers.length === 0) throw new Error(`provider "${providerName}" not found`);
  const results = await Promise.all(providers.map(async p => ({ p, r: await probeProvider(p.raw) })));

  if (json) {
    return out(`${JSON.stringify(results.map(({ p, r }) => ({ provider: p.name, ...r, diff: r.ok ? diffModels(p.models, r.models) : null })), null, 2)}\n`);
  }
  let failed = 0;
  for (const { p, r } of results) {
    if (!r.ok) {
      failed++;
      out(`${paint(glyph.bad, color.red)} ${pad(p.name, 14)} ${paint(r.error, color.red)}\n`);
      out(paint(`  ${p.baseUrl}\n`, color.grey));
      continue;
    }
    const diff = diffModels(p.models, r.models);
    out(`${paint(glyph.ok, color.green)} ${pad(p.name, 14)} ${r.ms}ms · ${r.models.length} models listed\n`);
    if (diff.missing.length > 0) {
      failed++;
      out(`  ${paint(glyph.bad, color.red)} configured but not offered: ${paint(diff.missing.join(", "), color.red)}\n`);
      out(paint("     requests for these fail with model_not_found\n", color.grey));
    }
    for (const a of diff.aliased) {
      out(`  ${paint(glyph.warn, color.yellow)} ${a.id} is not listed verbatim; the endpoint offers ${a.candidates.join(", ")}\n`);
      out(paint("     usually an undated alias the relay still accepts — test a real request if unsure\n", color.grey));
    }
    if (diff.extra.length > 0) {
      out(paint(`  ${diff.extra.length} model(s) available but not configured — pi-switch sync ${p.name}\n`, color.grey));
    }
  }
  if (failed > 0) process.exitCode = 1;
}

async function cmdKey([providerName]) {
  if (!providerName) throw new Error("usage: pi-switch key <provider>   (the key is read from stdin)");
  const provider = listProviders().find(p => p.name === providerName);
  if (!provider) throw new Error(`provider "${providerName}" not found`);

  const secret = (await readStdin()).trim();
  if (!secret) throw new Error("no key on stdin — try: printf %s \"$KEY\" | pi-switch key " + providerName);

  const useKeychain = flags.has("--plaintext") ? false : process.platform === "darwin";
  if (!useKeychain) {
    patchProvider(providerName, { apiKey: secret });
    out(`${paint(glyph.ok, color.green)} key written into models.json (plaintext)\n`);
    return;
  }
  const existing = parseKeychainSpec(provider.apiKeySpec);
  const service = existing?.service ?? serviceNameFor(providerName);
  setKey(service, secret);
  if (!existing) patchProvider(providerName, { apiKey: keychainSpec(service) });
  out(`${paint(glyph.ok, color.green)} key stored in keychain service ${paint(service, color.bold)}\n`);
  out(paint(existing ? "  models.json unchanged\n" : `  models.json now reads it via: ${keychainSpec(service)}\n`, color.grey));
}

function flagValue(name, fallback) {
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) return argv[idx + 1];
  const inline = argv.find(a => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

async function cmdAdd() {
  const name = flagValue("name");
  const url = flagValue("url");
  const api = flagValue("api", "openai-completions");
  const model = flagValue("model");
  // A key on the command line lands in shell history; stdin is the better path.
  const key = flagValue("key") ?? (await readStdin()).trim();
  if (!name || !url || !model) {
    throw new Error("usage: pi-switch add --name <n> --url <baseUrl> --model <id> [--api <api>] [--key <k>|--keychain]   (the key may also come from stdin)");
  }
  // pi's schema is minLength 1 on apiKey: writing "" makes pi load ZERO
  // providers, not just skip this one. Refuse rather than break the whole file.
  if (!key) {
    throw new Error("an api key is required — pass --key <k> or pipe it in; pi rejects the whole models.json when apiKey is empty");
  }

  let apiKey = key;
  const useKeychain = !flags.has("--plaintext") && process.platform === "darwin" && flags.has("--keychain");
  if (useKeychain) {
    const service = serviceNameFor(name);
    setKey(service, key);
    apiKey = keychainSpec(service);
  }
  upsertProvider(name, {
    baseUrl: url.replace(/\/+$/, ""),
    api,
    apiKey,
    ...(api === "anthropic-messages" ? { authHeader: true } : {}),
    models: [newModel(model, name, api)],
  });
  out(`${paint(glyph.ok, color.green)} added provider ${paint(name, color.bold)} — pi-switch test ${name}\n`);
  if (!useKeychain && process.platform === "darwin") {
    out(paint(`  the key is in plaintext in models.json — printf %s "$KEY" | pi-switch key ${name} moves it to the keychain\n`, color.grey));
  }
}

/** A new model entry with zero pricing and capability provenance. */
function newModel(id, providerName, api) {
  return createModelDefaults(id, providerName, { api });
}

function cmdThinking([level]) {
  if (!level) {
    const current = loadSettings().defaultThinkingLevel ?? "(unset)";
    out(`${paint("defaultThinkingLevel", color.grey)} ${current}\n`);
    out(paint(`  levels: ${THINKING_LEVELS.join(", ")}\n`, color.grey));
    return;
  }
  setThinking(level);
  out(`${paint(glyph.ok, color.green)} defaultThinkingLevel is now ${paint(level, color.bold)}\n`);
  out(paint("  restart pi to pick it up\n", color.grey));
}

function cmdRemove([providerName]) {
  if (!providerName) throw new Error("usage: pi-switch rm <provider>");
  deleteProvider(providerName);
  out(`${paint(glyph.ok, color.green)} deleted ${providerName} (backup in ${tildify(paths.backups)})\n`);
}

async function cmdSync([providerName]) {
  if (!providerName) throw new Error("usage: pi-switch sync <provider>");
  const provider = listProviders().find(p => p.name === providerName);
  if (!provider) throw new Error(`provider "${providerName}" not found`);
  const result = await probeProvider(provider.raw);
  if (!result.ok) throw new Error(`${providerName}: ${result.error}`);
  const diff = diffModels(provider.models, result.models);
  const capabilityUpdates = planModelCapabilityRefresh(providerName, result.modelDetails);
  if (diff.extra.length === 0 && capabilityUpdates.length === 0) {
    out(`${paint(glyph.ok, color.green)} nothing to add or refresh — ${result.models.length} models listed\n`);
    return;
  }
  if (!flags.has("--all")) {
    if (diff.extra.length > 0) {
      out(`${diff.extra.length} model(s) available but not configured:\n`);
      for (const id of diff.extra) out(`  ${id}\n`);
    }
    if (capabilityUpdates.length > 0) {
      out(`${capabilityUpdates.length} existing model(s) have explicit server capability updates:\n`);
      for (const update of capabilityUpdates) out(`  ${update.id}: ${update.fields.join(", ")}\n`);
    }
    out(paint(`\nrun with --all to apply these updates and add models (context window uses the server/model registry; unknown models keep a marked 200k fallback, maxTokens 32k)\n`, color.grey));
    return;
  }
  const capabilityRefresh = refreshModelCapabilities(providerName, result.modelDetails);
  const details = new Map((result.modelDetails || []).map(item => [item.id, item]));
  for (const id of diff.extra) {
    const detail = details.get(id);
    upsertModel(providerName, {
      id,
      name: `${id} (${providerName})`,
      capabilitySource: detail,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  }
  out(`${paint(glyph.ok, color.green)} added ${diff.extra.length} model(s), refreshed ${capabilityRefresh.changed.length} existing model(s) in ${providerName}\n`);
  out(paint("  capability values include their evidence level; review rows marked unknown before sending images or enabling reasoning\n", color.grey));
}

function cmdImport() {
  if (!ccSwitchAvailable()) throw new Error(`no cc-switch database at ${tildify(paths.ccSwitchDb)}`);
  const rows = readCcSwitchProviders();
  const usable = rows.filter(r => r.converted);
  const existing = listProviders().map(p => p.name);
  const plan = planImportNames(usable, existing);

  if (json) {
    return out(`${JSON.stringify({
      importable: plan.map(({ row, name, renamedFrom }) => ({ ...row, targetName: name, renamedFrom })),
      skipped: rows.filter(r => !r.converted),
    }, null, 2)}\n`);
  }

  if (!flags.has("--all")) {
    out(`${paint("importable from cc-switch", color.bold)} ${paint("(read-only)", color.grey)}\n`);
    for (const { row, name, renamedFrom } of plan) {
      const note = renamedFrom ? paint(`  ("${renamedFrom}" is taken — nothing is overwritten)`, color.grey) : "";
      out(`  ${pad(row.name, 22)}${paint(pad(row.appType, 16), color.grey)}→ ${paint(name, color.bold)}${note}\n`);
    }
    const skipped = rows.filter(r => !r.converted);
    if (skipped.length > 0) {
      out(`\n${paint("skipped", color.grey)}\n`);
      for (const r of skipped) out(paint(`  ${pad(r.name, 22)}${r.reason}\n`, color.grey));
    }
    out(paint("\nrun with --all to import them\n", color.grey));
    return;
  }
  for (const { row, name } of plan) upsertProvider(name, row.converted);
  out(`${paint(glyph.ok, color.green)} imported ${plan.length}: ${plan.map(p => p.name).join(", ")}\n`);
  out(paint("  keys came across in plaintext — pi-switch key <provider> moves one into the keychain\n", color.grey));
}

function cmdMcp([sub, name]) {
  if (!sub || sub === "ls" || sub === "list") {
    const servers = listServers();
    if (json) return out(`${JSON.stringify(servers, null, 2)}\n`);
    if (servers.length === 0) return out(paint("no MCP servers in any config layer\n", color.grey));
    out(paint(`${pad("", 2)}${pad("server", 20)}${pad("lifecycle", 11)}${pad("layer", 16)}command\n`, color.grey, color.bold));
    for (const s of servers) {
      const mark = s.disabled ? paint(glyph.off, color.red) : paint(glyph.on, color.green);
      out(`${mark} ${pad(s.name, 20)}${pad(paint(s.lifecycle, color.grey), 11)}${pad(paint(s.effectiveLayer, color.grey), 16)}${paint(s.command, color.grey)}\n`);
    }
    return;
  }
  if (sub === "enable" || sub === "disable") {
    if (!name) throw new Error(`usage: pi-switch mcp ${sub} <server>`);
    const scope = flags.has("--project") ? "project" : "global";
    const result = setDisabled(name, sub === "disable", { scope });
    out(`${paint(glyph.ok, color.green)} ${name} ${sub}d via ${tildify(result.file)}\n`);
    out(paint("  run /reload in pi so the tool surface refreshes\n", color.grey));
    return;
  }
  throw new Error(`unknown mcp subcommand "${sub}"`);
}

function cmdSkills([sub, value]) {
  if (!sub || sub === "ls" || sub === "list") {
    const rows = listSkillPaths();
    if (json) return out(`${JSON.stringify({ paths: rows, skills: listSkills() }, null, 2)}\n`);
    const total = rows.reduce((n, r) => n + r.count, 0);
    out(`${paint(`${rows.length} path(s), ${total} skill(s) reachable`, color.bold)}\n\n`);
    for (const r of rows) {
      const excluded = r.kind === "exclude";
      const mark = excluded
        ? paint(glyph.off, color.grey)
        : r.exists
          ? (r.count > 0 ? paint(glyph.ok, color.green) : paint(glyph.warn, color.yellow))
          : paint(glyph.bad, color.red);
      const count = excluded ? "-" : String(r.count);
      const kind = r.selector === "include" ? "include" : r.kind;
      out(`${mark} ${pad(count, 5)}${pad(paint(kind, color.grey), 9)}${r.exists ? r.entry : paint(r.entry, color.red)}\n`);
    }
    const plugins = listCcPlugins();
    if (plugins.length > 0) {
      out(`\n${paint("ccPlugins", color.bold)}\n`);
      for (const p of plugins) {
        const mark = p.exists === false ? paint(glyph.bad, color.red) : paint(glyph.ok, color.green);
        out(`${mark} ${p.spec}\n`);
      }
    }
    return;
  }
  if (sub === "add") {
    if (!value) throw new Error("usage: pi-switch skills add <path>");
    addSkillPath(value);
    out(`${paint(glyph.ok, color.green)} added ${value} to settings.skills\n`);
    return;
  }
  if (sub === "rm" || sub === "remove") {
    if (!value) throw new Error("usage: pi-switch skills rm <path>");
    removeSkillPath(value);
    out(`${paint(glyph.ok, color.green)} removed ${value}\n`);
    return;
  }
  if (sub === "prune") {
    const dead = pruneSkillPaths();
    out(dead.length === 0
      ? `${paint(glyph.ok, color.green)} no dead paths\n`
      : `${paint(glyph.ok, color.green)} pruned ${dead.length}: ${dead.join(", ")}\n`);
    return;
  }
  throw new Error(`unknown skills subcommand "${sub}"`);
}

function cmdAgents([sub]) {
  if (sub && sub !== "ls" && sub !== "list") throw new Error(`unknown agents subcommand "${sub}"`);
  const agents = listAgents();
  if (json) return out(`${JSON.stringify({ agents, unreachable: unreachableAgentFiles() }, null, 2)}\n`);

  if (agents.length === 0) {
    out(paint(`no agents found. Files must sit directly in ${tildify(paths.agents)} — the loader does not recurse.\n`, color.grey));
  }
  out(paint(`${pad("", 2)}${pad("agent", 20)}${pad("source", 10)}${pad("model", 18)}${pad("think", 8)}description\n`, color.grey, color.bold));
  for (const a of agents) {
    const errors = a.problems.filter(p => p.level === "error");
    const warns = a.problems.filter(p => p.level === "warn");
    const mark = errors.length > 0 ? paint(glyph.bad, color.red) : warns.length > 0 ? paint(glyph.warn, color.yellow) : paint(glyph.ok, color.green);
    out(`${mark} ${pad(a.name, 20)}${pad(paint(a.source, color.grey), 10)}${pad(paint(a.model ?? "inherit", color.grey), 18)}${pad(paint(a.thinking ?? "—", color.grey), 8)}${paint(truncate(a.description, 40), color.grey)}\n`);
    for (const p of [...errors, ...warns]) {
      out(`    ${p.level === "error" ? paint(glyph.bad, color.red) : paint(glyph.warn, color.yellow)} ${p.message}\n`);
    }
  }
  for (const nested of unreachableAgentFiles()) {
    out(`\n${paint(glyph.warn, color.yellow)} ${nested.count} .md file(s) in ${tildify(nested.dir)} are never loaded (no recursion)\n`);
    if (nested.ccPluginsOwned) {
      out(paint("  cc-plugins owns this dir and deletes it on refcount zero — do not hand-write files here\n", color.grey));
    }
  }
  if (agents.some(a => a.problems.some(p => p.level === "error"))) process.exitCode = 1;
}

async function cmdDoctor() {
  const findings = await runDoctor({ probe: flags.has("--probe") });
  if (json) return out(`${JSON.stringify(findings, null, 2)}\n`);
  printFindings(findings);
  if (!flags.has("--probe")) out(paint("run with --probe to also test every endpoint\n", color.grey));
  if (findings.some(f => f.level === "error")) process.exitCode = 1;
}

function cmdPaths() {
  const rows = [
    ["models.json", paths.models, "provider + model catalog (written)"],
    ["settings.json", paths.settings, "defaultProvider/Model, skills[], packages[] (written)"],
    ["profiles.json", paths.profiles, "startup profile registry (read only)"],
    ["maintenance-checks.json", paths.maintenanceChecks, "local package patch registry (read only)"],
    ["pi-switch-provider-catalog.json", paths.providerCatalog, "validated remote Provider template cache (written)"],
    ["mcp.json (pi global)", paths.piMcp, "pi-owned MCP override layer (written)"],
    ["mcp.json (shared)", paths.sharedMcp, "shared MCP config (read only)"],
    ["agents/", paths.agents, "global subagents — no recursion (read only)"],
    ["cc-switch.db", paths.ccSwitchDb, "provider import source (read only)"],
    ["backups/", paths.backups, "timestamped copies of every file pi-switch rewrites"],
  ];
  if (json) return out(`${JSON.stringify(Object.fromEntries(rows.map(([k, v]) => [k, v])), null, 2)}\n`);
  for (const [label, file, note] of rows) {
    out(`${pad(paint(label, color.bold), 32)}${pad(tildify(file), 42)}${paint(note, color.grey)}\n`);
  }
}

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", chunk => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

// `pi-switch ls | head -3` closes the pipe mid-write. That is the caller's
// choice, not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", err => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

main().catch(err => {
  if (err.code === "EPIPE") process.exit(0);
  process.stderr.write(`${paint(glyph.bad, color.red)} ${err.message}\n`);
  process.exit(1);
});
