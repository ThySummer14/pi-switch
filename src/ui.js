/**
 * ui.js — the full-screen switcher. Five tabs over the same config: providers,
 * models, MCP, skills, agents.
 */

import { runDoctor } from "./doctor.js";
import { ccSwitchAvailable, planImportNames, readCcSwitchProviders } from "./import-ccswitch.js";
import { keychainSpec, parseKeychainSpec, serviceNameFor, setKey } from "./keychain.js";
import { listServers, setDisabled } from "./mcp.js";
import { paths, tildify } from "./paths.js";
import {
  API_TYPES, deleteModel, deleteProvider, diffModels, listProviders,
  patchProvider, probeProvider, setDefault, setThinking, THINKING_LEVELS, upsertModel, upsertProvider,
} from "./providers.js";
import { listAgents } from "./agents.js";
import { addSkillPath, listSkillPaths, pruneSkillPaths, removeSkillPath } from "./skills.js";
import { loadSettings, maskKey, resolveApiKey } from "./store.js";
import {
  color, confirm, glyph, keys, out, paint, pad, prompt, screen, size, truncate, width,
} from "./term.js";

const TABS = ["providers", "models", "mcp", "skills", "agents"];

export async function runUi() {
  if (!process.stdout.isTTY) {
    throw new Error("pi-switch's interactive UI needs a TTY — use the subcommands instead (pi-switch --help)");
  }

  const state = {
    tab: 0,
    cursor: 0,
    rows: [],
    /** provider name → probe result */
    health: new Map(),
    message: "",
    messageLevel: "info",
    /** provider whose models are shown on the models tab */
    focusProvider: null,
    quit: false,
    busy: false,
  };

  screen.enter();
  let stop = () => {};
  try {
    refresh(state);
    render(state);
    await new Promise(resolve => {
      stop = keys(key => {
        if (state.busy) return;
        state.busy = true;
        Promise.resolve(handleKey(state, key))
          .catch(err => {
            state.message = err.message;
            state.messageLevel = "error";
          })
          .finally(() => {
            state.busy = false;
            if (state.quit) resolve();
            else render(state);
          });
      });
    });
  } finally {
    stop();
    screen.leave();
  }
}

// ---- data ----

function refresh(state) {
  const settings = loadSettings();
  state.settings = settings;
  state.providers = listProviders();
  if (!state.focusProvider || !state.providers.some(p => p.name === state.focusProvider)) {
    state.focusProvider = state.providers.find(p => p.isDefault)?.name ?? state.providers[0]?.name ?? null;
  }
  switch (TABS[state.tab]) {
    case "providers":
      state.rows = state.providers;
      break;
    case "models": {
      const provider = state.providers.find(p => p.name === state.focusProvider);
      state.rows = (provider?.modelObjects ?? []).map(m => ({ ...m, provider: provider.name }));
      break;
    }
    case "mcp":
      state.rows = listServers();
      break;
    case "skills":
      state.rows = listSkillPaths();
      break;
    case "agents":
      state.rows = listAgents();
      break;
  }
  if (state.cursor >= state.rows.length) state.cursor = Math.max(0, state.rows.length - 1);
}

function current(state) {
  return state.rows[state.cursor];
}

// ---- keys ----

/**
 * Normalise a keypress into a single token.
 *
 * readline reports punctuation with `name` undefined (only `sequence` is set),
 * and reports a capital as name:"p" + shift:true — so both need to come from the
 * raw character, not from `name` alone.
 */
function keyToken(key) {
  if (key.name && key.name.length > 1) return key.name; // up, down, tab, escape, return…
  const ch = key.str ?? key.sequence ?? key.name ?? "";
  return ch.length === 1 ? ch : (key.name ?? "");
}

async function handleKey(state, key) {
  const token = keyToken(key);
  const lower = token.toLowerCase();

  if (key.ctrl && (lower === "c" || lower === "d")) {
    state.quit = true;
    return;
  }
  if (token === "q" || token === "escape") {
    state.quit = true;
    return;
  }

  // navigation
  if (token === "up" || token === "k") return move(state, -1);
  if (token === "down" || token === "j") return move(state, 1);
  if (token === "pageup") return move(state, -pageSize(state));
  if (token === "pagedown") return move(state, pageSize(state));
  if (token === "home") return jump(state, 0);
  if (token === "end") return jump(state, state.rows.length - 1);
  if (token === "tab") return switchTab(state, key.shift ? -1 : 1);
  if (token === "left" || token === "h") return switchTab(state, -1);
  if (token === "right" || token === "l") return switchTab(state, 1);
  if (/^[1-5]$/.test(token)) {
    state.tab = Number(token) - 1;
    state.cursor = 0;
    return refresh(state);
  }
  if (token === "r") {
    refresh(state);
    return info(state, "reloaded from disk");
  }
  if (token === "?") return showHelp(state);
  if (token === "d") return showDoctor(state);
  const name = token;

  switch (TABS[state.tab]) {
    case "providers":
      return providerKeys(state, name);
    case "models":
      return modelKeys(state, name);
    case "mcp":
      return mcpKeys(state, name);
    case "skills":
      return skillKeys(state, name);
    case "agents":
      return agentKeys(state, name);
  }
}

function move(state, delta) {
  if (state.rows.length === 0) return;
  if (Math.abs(delta) === 1) {
    state.cursor = (state.cursor + delta + state.rows.length) % state.rows.length;
  } else {
    // Paging clamps instead of wrapping — wrapping a whole page is disorienting.
    state.cursor = Math.min(state.rows.length - 1, Math.max(0, state.cursor + delta));
  }
}

function jump(state, index) {
  if (state.rows.length === 0) return;
  state.cursor = Math.min(state.rows.length - 1, Math.max(0, index));
}

/** How many list rows fit on screen, used for paging and for the viewport. */
function pageSize(state) {
  const { rows } = size();
  // header + rule + column header + rule + hint + message
  return Math.max(1, rows - 7 - (state.message ? 1 : 0));
}

function switchTab(state, delta) {
  state.tab = (state.tab + delta + TABS.length) % TABS.length;
  state.cursor = 0;
  refresh(state);
}

function info(state, message) {
  state.message = message;
  state.messageLevel = "info";
}

function ok(state, message) {
  state.message = message;
  state.messageLevel = "ok";
}

// ---- providers tab ----

async function providerKeys(state, name) {
  const row = current(state);
  switch (name) {
    case "return": {
      if (!row) return;
      const chosen = row.models.length > 1 ? await pickModel(state, row) : row.models[0];
      if (!chosen) return;
      const result = setDefault(row.name, chosen);
      refresh(state);
      return ok(state, `default is now ${result.provider}/${result.model} — restart pi to pick it up`);
    }
    case "m": {
      if (!row) return;
      state.focusProvider = row.name;
      state.tab = TABS.indexOf("models");
      state.cursor = 0;
      return refresh(state);
    }
    case "t":
      return probeAll(state);
    case "T":
      return chooseThinking(state);
    case "a":
      return addProvider(state);
    case "e":
      return editProvider(state, row);
    case "K":
    case "y":
      return rotateKey(state, row);
    case "x":
      return removeProvider(state, row);
    case "i":
      return importFromCcSwitch(state);
    case "s":
      return syncModels(state, row);
  }
}

async function chooseThinking(state) {
  const currentLevel = state.settings.defaultThinkingLevel;
  const answer = await inCooked(state, async () => {
    out(`\n${paint("default thinking level", color.bold)} ${paint(`(current: ${currentLevel ?? "default"})`, color.grey)}\n`);
    out(`${paint(THINKING_LEVELS.map((level, i) => `${i + 1}. ${level}`).join("  "), color.grey)}\n`);
    return prompt("level", { defaultValue: currentLevel ?? "medium" });
  });
  if (answer === null) return info(state, "cancelled");
  const value = answer.trim();
  const level = /^\d+$/.test(value) ? THINKING_LEVELS[Number(value) - 1] : value;
  if (!level) return info(state, "cancelled");
  setThinking(level);
  refresh(state);
  return ok(state, `default thinking is now ${level} — restart pi to pick it up`);
}

async function pickModel(state, provider) {
  const lines = provider.models.map((id, i) => `  ${i + 1}. ${id}`).join("\n");
  const answer = await inCooked(state, async () => {
    out(`\n${paint(`models for ${provider.name}:`, color.bold)}\n${lines}\n`);
    return prompt("number (or model id)", { defaultValue: "1" });
  });
  if (answer === null) return null;
  const trimmed = answer.trim();
  if (/^\d+$/.test(trimmed)) return provider.models[Number(trimmed) - 1] ?? null;
  return provider.models.includes(trimmed) ? trimmed : null;
}

async function probeAll(state) {
  info(state, "probing providers…");
  render(state);
  const results = await Promise.all(
    state.providers.map(async p => [p.name, await probeProvider(p.raw)]),
  );
  for (const [providerName, result] of results) {
    const provider = state.providers.find(p => p.name === providerName);
    result.diff = result.ok ? diffModels(provider.models, result.models) : null;
    state.health.set(providerName, result);
  }
  const bad = results.filter(([, r]) => !r.ok).length;
  const stale = results.filter(([, r]) => r.diff && !r.diff.unknown && r.diff.missing.length > 0).length;
  return bad || stale
    ? (state.messageLevel = "error", state.message = `${bad} unreachable, ${stale} with missing model ids — press d for details`)
    : ok(state, "all providers reachable and every configured model exists");
}

async function addProvider(state) {
  const answers = await inCooked(state, async () => {
    out(`\n${paint("new provider", color.bold)} ${paint("(esc to cancel)", color.grey)}\n`);
    const providerName = await prompt("name (key in models.json)");
    if (!providerName) return null;
    const baseUrl = await prompt("baseUrl");
    if (!baseUrl) return null;
    out(`${paint(API_TYPES.map((a, i) => `${i + 1}. ${a}`).join("  "), color.grey)}\n`);
    const apiAnswer = await prompt("api", { defaultValue: "1" });
    if (apiAnswer === null) return null;
    const api = /^\d+$/.test(apiAnswer.trim()) ? API_TYPES[Number(apiAnswer.trim()) - 1] : apiAnswer.trim();
    const modelId = await prompt("first model id");
    if (!modelId) return null;
    const secret = await prompt("api key", { mask: true });
    if (secret === null) return null;
    const useKeychain = process.platform === "darwin" && (await confirm("store the key in the login keychain?", { defaultYes: true }));
    return { providerName, baseUrl, api, modelId, secret, useKeychain };
  });
  if (!answers) return info(state, "cancelled");

  let apiKey = answers.secret;
  if (answers.useKeychain) {
    const service = serviceNameFor(answers.providerName);
    setKey(service, answers.secret);
    apiKey = keychainSpec(service);
  }
  upsertProvider(answers.providerName, {
    baseUrl: answers.baseUrl.replace(/\/+$/, ""),
    api: answers.api,
    apiKey,
    ...(answers.api === "anthropic-messages" ? { authHeader: true } : {}),
    models: [{
      id: answers.modelId,
      name: `${answers.modelId} (${answers.providerName})`,
      contextWindow: 200_000,
      maxTokens: 32_768,
      input: ["text"],
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  });
  refresh(state);
  return ok(state, `added provider "${answers.providerName}" — press t to test it`);
}

async function editProvider(state, row) {
  if (!row) return;
  const answers = await inCooked(state, async () => {
    out(`\n${paint(`edit ${row.name}`, color.bold)} ${paint("(enter keeps the current value)", color.grey)}\n`);
    const baseUrl = await prompt("baseUrl", { defaultValue: row.baseUrl });
    if (baseUrl === null) return null;
    const api = await prompt("api", { defaultValue: row.api });
    if (api === null) return null;
    return { baseUrl: baseUrl.replace(/\/+$/, ""), api };
  });
  if (!answers) return info(state, "cancelled");
  patchProvider(row.name, answers);
  refresh(state);
  return ok(state, `updated ${row.name}`);
}

async function rotateKey(state, row) {
  if (!row) return;
  const existing = parseKeychainSpec(row.apiKeySpec);
  const answers = await inCooked(state, async () => {
    out(`\n${paint(`api key for ${row.name}`, color.bold)}\n`);
    out(`${paint(`current: ${row.apiKeySpec} → ${row.keyOk ? maskKey(resolveApiKey(row.apiKeySpec).value) : paint(row.keyError, color.red)}`, color.grey)}\n`);
    const secret = await prompt("new key", { mask: true });
    if (!secret) return null;
    if (process.platform !== "darwin") return { secret, useKeychain: false };
    const useKeychain = await confirm("store in the login keychain (keeps it out of models.json)?", { defaultYes: true });
    return { secret, useKeychain };
  });
  if (!answers) return info(state, "cancelled");

  if (answers.useKeychain) {
    const service = existing?.service ?? serviceNameFor(row.name);
    setKey(service, answers.secret);
    if (!existing) patchProvider(row.name, { apiKey: keychainSpec(service) });
    refresh(state);
    return ok(state, `key stored in keychain service "${service}"${existing ? " (models.json unchanged)" : " and models.json now reads from it"}`);
  }
  patchProvider(row.name, { apiKey: answers.secret });
  refresh(state);
  return ok(state, `key written into models.json for ${row.name} (plaintext)`);
}

async function removeProvider(state, row) {
  if (!row) return;
  const yes = await inCooked(state, () =>
    confirm(`delete provider "${row.name}" and its ${row.models.length} model(s)?`),
  );
  if (!yes) return info(state, "cancelled");
  deleteProvider(row.name);
  refresh(state);
  return ok(state, `deleted ${row.name} (backup in ${tildify(paths.backups)})`);
}

/** Add every model the endpoint reports but models.json is missing. */
async function syncModels(state, row) {
  if (!row) return;
  info(state, `asking ${row.name} for its model list…`);
  render(state);
  const result = await probeProvider(row.raw);
  state.health.set(row.name, result);
  if (!result.ok) {
    state.messageLevel = "error";
    state.message = `${row.name}: ${result.error}`;
    return;
  }
  const diff = diffModels(row.models, result.models);
  const fallback = result.attempts > 1 ? ` via ${new URL(result.url).pathname}` : "";
  if (diff.extra.length === 0) return ok(state, `${row.name}: nothing new — ${result.models.length} models listed${fallback}`);

  const chosen = await inCooked(state, async () => {
    out(`\n${paint(`${row.name} lists ${diff.extra.length} model(s) not in models.json:`, color.bold)}\n`);
    for (const [i, id] of diff.extra.entries()) out(`  ${i + 1}. ${id}\n`);
    const answer = await prompt("add which? (numbers, comma-separated, or 'all')");
    if (answer === null) return null;
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "all") return diff.extra;
    return trimmed
      .split(",")
      .map(s => diff.extra[Number(s.trim()) - 1])
      .filter(Boolean);
  });
  if (!chosen || chosen.length === 0) return info(state, "nothing added");
  for (const id of chosen) {
    upsertModel(row.name, {
      id,
      name: `${id} (${row.name})`,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  }
  refresh(state);
  return ok(state, `added ${chosen.length} model(s) to ${row.name}${fallback} — set contextWindow/reasoning by hand if the defaults are wrong`);
}

async function importFromCcSwitch(state) {
  if (!ccSwitchAvailable()) return info(state, `no cc-switch database at ${tildify(paths.ccSwitchDb)}`);
  const rows = readCcSwitchProviders();
  const usable = rows.filter(r => r.converted);
  if (usable.length === 0) return info(state, "cc-switch has no provider pi can use");

  const plan = planImportNames(usable, state.providers.map(p => p.name));
  const chosen = await inCooked(state, async () => {
    out(`\n${paint("import from cc-switch", color.bold)} ${paint("(read-only — cc-switch.db is never written)", color.grey)}\n`);
    for (const [i, { row, name, renamedFrom }] of plan.entries()) {
      const note = renamedFrom ? paint(` ("${renamedFrom}" is taken)`, color.grey) : "";
      out(`  ${i + 1}. ${pad(row.name, 20)} ${paint(pad(row.appType, 15), color.grey)} → ${name}${note}\n`);
    }
    const skipped = rows.filter(r => !r.converted);
    if (skipped.length > 0) {
      out(`${paint(`  skipped: ${skipped.map(r => `${r.name} (${r.reason})`).join("; ")}`, color.grey)}\n`);
    }
    const answer = await prompt("import which? (numbers, comma-separated, or 'all')");
    if (answer === null) return null;
    const trimmed = answer.trim().toLowerCase();
    return trimmed === "all" ? plan : trimmed.split(",").map(s => plan[Number(s.trim()) - 1]).filter(Boolean);
  });
  if (!chosen || chosen.length === 0) return info(state, "nothing imported");

  for (const { row, name } of chosen) upsertProvider(name, row.converted);
  refresh(state);
  return ok(state, `imported ${chosen.map(c => c.name).join(", ")} — keys came across in plaintext; press y to move them into the keychain`);
}

// ---- models tab ----

async function modelKeys(state, name) {
  const row = current(state);
  switch (name) {
    case "return": {
      if (!row) return;
      const result = setDefault(row.provider, row.id);
      refresh(state);
      return ok(state, `default is now ${result.provider}/${result.model} — restart pi to pick it up`);
    }
    case "p": {
      const idx = state.providers.findIndex(p => p.name === state.focusProvider);
      state.focusProvider = state.providers[(idx + 1) % state.providers.length]?.name ?? state.focusProvider;
      state.cursor = 0;
      return refresh(state);
    }
    case "a":
      return addModel(state);
    case "e":
      return editModel(state, row);
    case "x": {
      if (!row) return;
      const yes = await inCooked(state, () => confirm(`delete model ${row.provider}/${row.id}?`));
      if (!yes) return info(state, "cancelled");
      deleteModel(row.provider, row.id);
      refresh(state);
      return ok(state, `deleted ${row.id}`);
    }
  }
}

async function addModel(state) {
  const providerName = state.focusProvider;
  if (!providerName) return;
  const answers = await inCooked(state, async () => {
    out(`\n${paint(`new model under ${providerName}`, color.bold)}\n`);
    const id = await prompt("model id");
    if (!id) return null;
    const contextWindow = await prompt("contextWindow", { defaultValue: "200000" });
    if (contextWindow === null) return null;
    const maxTokens = await prompt("maxTokens", { defaultValue: "32768" });
    if (maxTokens === null) return null;
    const reasoning = await confirm("does the endpoint forward thinking/reasoning?", { defaultYes: false });
    return { id, contextWindow: Number(contextWindow), maxTokens: Number(maxTokens), reasoning };
  });
  if (!answers) return info(state, "cancelled");
  upsertModel(providerName, {
    ...answers,
    name: `${answers.id} (${providerName})`,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  refresh(state);
  return ok(state, `added ${providerName}/${answers.id}`);
}

async function editModel(state, row) {
  if (!row) return;
  const answers = await inCooked(state, async () => {
    out(`\n${paint(`edit ${row.provider}/${row.id}`, color.bold)}\n`);
    const contextWindow = await prompt("contextWindow", { defaultValue: String(row.contextWindow ?? 200000) });
    if (contextWindow === null) return null;
    const maxTokens = await prompt("maxTokens", { defaultValue: String(row.maxTokens ?? 32768) });
    if (maxTokens === null) return null;
    const reasoning = await confirm("reasoning supported?", { defaultYes: row.reasoning === true });
    return { contextWindow: Number(contextWindow), maxTokens: Number(maxTokens), reasoning };
  });
  if (!answers) return info(state, "cancelled");
  upsertModel(row.provider, { id: row.id, ...answers });
  refresh(state);
  return ok(state, `updated ${row.id}`);
}

// ---- mcp tab ----

async function mcpKeys(state, name) {
  const row = current(state);
  if (!row) return;
  if (name === "return" || name === "space") {
    const target = !row.disabled;
    const scope = row.definedIn.some(l => l.includes("project")) ? "project" : "global";
    const result = setDisabled(row.name, target, { scope });
    refresh(state);
    return ok(state, `${row.name} ${target ? "disabled" : "enabled"} via ${tildify(result.file)} — run /reload in pi`);
  }
}

// ---- skills tab ----

async function skillKeys(state, name) {
  const row = current(state);
  switch (name) {
    case "a": {
      const entry = await inCooked(state, async () => {
        out(`\n${paint("add a skills path", color.bold)} ${paint("(a skill dir, or a dir of skill dirs; ~ is allowed)", color.grey)}\n`);
        return prompt("path");
      });
      if (!entry) return info(state, "cancelled");
      addSkillPath(entry.trim());
      refresh(state);
      return ok(state, `added ${entry.trim()} to settings.skills`);
    }
    case "x": {
      if (!row) return;
      const yes = await inCooked(state, () => confirm(`remove "${row.entry}" from settings.skills?`));
      if (!yes) return info(state, "cancelled");
      removeSkillPath(row.entry);
      refresh(state);
      return ok(state, "removed");
    }
    case "P": {
      const dead = pruneSkillPaths();
      refresh(state);
      return dead.length === 0 ? info(state, "no dead paths") : ok(state, `pruned ${dead.length} dead path(s)`);
    }
  }
}

// ---- agents tab ----

async function agentKeys(state, name) {
  const row = current(state);
  if (!row) return;
  if (name === "return") {
    return inCooked(state, async () => {
      out(`\n${paint(row.name, color.bold)} ${paint(tildify(row.file), color.grey)}\n`);
      out(`${paint("display_name", color.grey)} ${row.displayName}\n`);
      out(`${paint("tools       ", color.grey)} ${row.tools ?? "(all built-ins)"}\n`);
      out(`${paint("model       ", color.grey)} ${row.model ?? "(inherit)"}\n`);
      out(`${paint("thinking    ", color.grey)} ${row.thinking ?? "(inherit)"}\n`);
      out(`${paint("description ", color.grey)} ${row.description}\n`);
      if (row.problems.length === 0) out(`\n${paint("no problems", color.green)}\n`);
      for (const p of row.problems) {
        out(`\n${p.level === "error" ? paint(glyph.bad, color.red) : paint(glyph.warn, color.yellow)} ${p.message}\n`);
      }
      const { pause } = await import("./term.js");
      await pause();
    });
  }
}

// ---- doctor / help overlays ----

async function showDoctor(state) {
  info(state, "running checks…");
  render(state);
  const findings = await runDoctor({ probe: true });
  await inCooked(state, async () => {
    screen.clear();
    out(`${paint("pi-switch doctor", color.bold)}\n\n`);
    printFindings(findings);
    const { pause } = await import("./term.js");
    await pause();
  });
  refresh(state);
  const errors = findings.filter(f => f.level === "error").length;
  return errors > 0
    ? ((state.messageLevel = "error"), (state.message = `${errors} error(s) — press d to review`))
    : ok(state, "no errors");
}

export function printFindings(findings) {
  const order = { error: 0, warn: 1, ok: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  for (const f of sorted) {
    const badge =
      f.level === "error" ? paint(` ${glyph.bad} `, color.red, color.bold)
        : f.level === "warn" ? paint(` ${glyph.warn} `, color.yellow, color.bold)
          : paint(` ${glyph.ok} `, color.green);
    out(`${badge} ${paint(pad(f.area, 9), color.grey)} ${f.message}\n`);
    if (f.fix) out(`${" ".repeat(14)}${paint(f.fix, color.grey)}\n`);
  }
  const errors = findings.filter(f => f.level === "error").length;
  const warns = findings.filter(f => f.level === "warn").length;
  out(`\n${errors} error(s), ${warns} warning(s)\n`);
}

async function showHelp(state) {
  await inCooked(state, async () => {
    screen.clear();
    out(`${paint("pi-switch", color.bold)} — keys\n\n`);
    const sections = [
      ["everywhere", [
        ["↑↓ / j k", "move"],
        ["tab / ← →", "switch tab"],
        ["1-5", "jump to tab"],
        ["r", "reload from disk"],
        ["d", "doctor (checks + network probe)"],
        ["?", "this help"],
        ["q", "quit"],
      ]],
      ["providers", [
        ["enter", "make default (asks which model)"],
        ["m", "show this provider's models"],
        ["t", "probe every provider"],
        ["T", "set the default thinking level"],
        ["s", "sync model list from the endpoint"],
        ["a / e / x", "add / edit / delete provider"],
        ["y", "rotate the api key (keychain by default)"],
        ["i", "import providers from cc-switch"],
      ]],
      ["models", [
        ["enter", "make default"],
        ["p", "next provider"],
        ["a / e / x", "add / edit / delete model"],
      ]],
      ["mcp", [["enter / space", "enable or disable (writes a pi-owned layer only)"]]],
      ["skills", [["a / x", "add / remove a settings.skills path"], ["P", "prune dead paths"]]],
      ["agents", [["enter", "show frontmatter and validation problems"]]],
    ];
    for (const [title, rows] of sections) {
      out(`${paint(title, color.cyan, color.bold)}\n`);
      for (const [k, desc] of rows) out(`  ${paint(pad(k, 14), color.bold)} ${desc}\n`);
      out("\n");
    }
    out(`${paint(`config: ${tildify(paths.models)}, ${tildify(paths.settings)}`, color.grey)}\n`);
    out(`${paint(`backups: ${tildify(paths.backups)}`, color.grey)}\n`);
    const { pause } = await import("./term.js");
    await pause();
  });
}

/** Drop out of the alt screen so a prompt can scroll normally, then go back. */
async function inCooked(state, fn) {
  screen.leave();
  try {
    return await fn();
  } finally {
    screen.enter();
    render(state);
  }
}

// ---- render ----

function render(state) {
  const { rows, cols } = size();
  screen.clear();
  const lines = [];

  const tabBar = TABS.map((t, i) =>
    i === state.tab ? paint(` ${t} `, color.invert, color.bold) : paint(` ${t} `, color.grey),
  ).join("");
  const active = state.settings?.defaultProvider
    ? `${state.settings.defaultProvider}/${state.settings.defaultModel ?? "?"}`
    : "no default set";
  lines.push(`${paint("pi-switch", color.bold, color.cyan)}  ${tabBar}  ${paint(active, color.grey)}`);
  lines.push(paint("─".repeat(cols), color.grey));

  const { header, listRows } = renderTab(state, cols);
  const room = Math.max(1, rows - lines.length - 3 - (state.message ? 1 : 0));
  const listRoom = Math.max(1, room - header.length);

  // Scroll the list so the cursor stays visible: a 38-entry skills list on a
  // 24-row terminal would otherwise put the selection off-screen with no way to
  // tell what is selected.
  const start = Math.min(
    Math.max(0, state.cursor - Math.floor(listRoom / 2)),
    Math.max(0, listRows.length - listRoom),
  );
  const visible = listRows.slice(start, start + listRoom);

  lines.push(...header);
  lines.push(...visible);
  if (listRows.length > listRoom) {
    const shown = `${start + 1}-${start + visible.length} of ${listRows.length}`;
    lines[1] = paint("─".repeat(Math.max(0, cols - width(shown) - 3)) + ` ${shown} ` + "─".repeat(2), color.grey);
  }
  for (let i = visible.length + header.length; i < room; i++) lines.push("");

  lines.push(paint("─".repeat(cols), color.grey));
  lines.push(truncate(hint(state), cols));
  if (state.message) {
    const style = state.messageLevel === "error" ? color.red : state.messageLevel === "ok" ? color.green : color.grey;
    lines.push(truncate(paint(state.message, style), cols));
  }
  out(lines.join("\n"));
}

/**
 * Each tab returns its fixed header lines separately from the scrollable rows,
 * so the column header stays pinned while the list scrolls.
 */
function renderTab(state, cols) {
  switch (TABS[state.tab]) {
    case "providers":
      return renderProviders(state, cols);
    case "models":
      return renderModels(state, cols);
    case "mcp":
      return renderMcp(state, cols);
    case "skills":
      return renderSkills(state, cols);
    case "agents":
      return renderAgents(state, cols);
    default:
      return { header: [], listRows: [] };
  }
}

function cursorMark(state, i) {
  return i === state.cursor ? paint(`${glyph.arrow} `, color.cyan, color.bold) : "  ";
}

function renderProviders(state, cols) {
  if (state.rows.length === 0) {
    return { header: [paint("  no providers in models.json — press a to add one, or i to import from cc-switch", color.grey)], listRows: [] };
  }
  const header = [
    `  ${paint(pad("", 2) + pad("provider", 14) + pad("model (default)", 24) + pad("api", 22) + pad("key", 22) + "health", color.grey, color.bold)}`,
  ];
  const lines = [];
  for (const [i, p] of state.rows.entries()) {
    const mark = p.isDefault ? paint(glyph.on, color.green) : paint(glyph.off, color.grey);
    const model = p.isDefault ? p.defaultModel ?? "—" : `${p.models.length} model${p.models.length === 1 ? "" : "s"}`;
    const key = p.keyOk
      ? paint(p.keyInline ? "inline (plaintext)" : p.keySource, p.keyInline ? color.yellow : color.grey)
      : paint(truncate(p.keyError ?? "unresolved", 20), color.red);
    const h = state.health.get(p.name);
    const health = !h
      ? paint("—", color.grey)
      : !h.ok
        ? paint(`${glyph.bad} ${truncate(h.error, 28)}`, color.red)
        : h.diff && !h.diff.unknown && h.diff.missing.length > 0
          ? paint(`${glyph.bad} ${h.ms}ms, ${h.diff.missing.length} missing id`, color.red)
          : h.diff && h.diff.aliased?.length > 0
            ? paint(`${glyph.warn} ${h.ms}ms, ${h.diff.aliased.length} aliased id`, color.yellow)
            : paint(`${glyph.ok} ${h.ms}ms`, color.green);
    const row =
      cursorMark(state, i) +
      `${mark} ` +
      pad(paint(p.name, p.isDefault ? color.bold : color.reset), 14) +
      pad(truncate(model, 23), 24) +
      pad(paint(truncate(p.api ?? "?", 21), color.grey), 22) +
      pad(key, 22) +
      health;
    lines.push(truncate(row, cols));
  }
  return { header, listRows: lines };
}

function renderModels(state, cols) {
  const title = paint(`  models of ${state.focusProvider ?? "—"}`, color.bold);
  if (state.rows.length === 0) {
    return { header: [title, paint("  no models — press a to add one", color.grey)], listRows: [] };
  }
  const header = [
    title,
    `  ${paint(pad("", 2) + pad("id", 30) + pad("context", 12) + pad("maxTokens", 12) + pad("reasoning", 11) + "input", color.grey, color.bold)}`,
  ];
  const lines = [];
  for (const [i, m] of state.rows.entries()) {
    const isActive = state.settings?.defaultProvider === m.provider && state.settings?.defaultModel === m.id;
    const mark = isActive ? paint(glyph.on, color.green) : paint(glyph.off, color.grey);
    const row =
      cursorMark(state, i) +
      `${mark} ` +
      pad(paint(truncate(m.id, 29), isActive ? color.bold : color.reset), 30) +
      pad(fmtNum(m.contextWindow), 12) +
      pad(fmtNum(m.maxTokens), 12) +
      pad(m.reasoning ? paint("yes", color.green) : paint("no", color.grey), 11) +
      paint((m.input || []).join(","), color.grey);
    lines.push(truncate(row, cols));
  }
  return { header, listRows: lines };
}

function fmtNum(n) {
  if (typeof n !== "number") return "—";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function renderMcp(state, cols) {
  if (state.rows.length === 0) return { header: [paint("  no MCP servers in any config layer", color.grey)], listRows: [] };
  const header = [
    `  ${paint(pad("", 2) + pad("server", 20) + pad("lifecycle", 11) + pad("layer", 16) + "command", color.grey, color.bold)}`,
  ];
  const lines = [];
  for (const [i, s] of state.rows.entries()) {
    const mark = s.disabled ? paint(glyph.off, color.red) : paint(glyph.on, color.green);
    const row =
      cursorMark(state, i) +
      `${mark} ` +
      pad(paint(s.name, s.disabled ? color.grey : color.reset), 20) +
      pad(paint(s.lifecycle, color.grey), 11) +
      pad(paint(truncate(s.effectiveLayer, 15), color.grey), 16) +
      paint(truncate(s.command, Math.max(10, cols - 55)), color.grey);
    lines.push(truncate(row, cols));
  }
  return { header, listRows: lines };
}

function renderSkills(state, cols) {
  if (state.rows.length === 0) {
    return { header: [paint("  settings.skills is empty — press a to add a path", color.grey)], listRows: [] };
  }
  const total = state.rows.reduce((n, r) => n + r.count, 0);
  const header = [
    paint(`  ${state.rows.length} path(s), ${total} skill(s) reachable`, color.bold),
    `  ${paint(pad("", 2) + pad("skills", 8) + pad("kind", 9) + "path", color.grey, color.bold)}`,
  ];
  const lines = [];
  for (const [i, r] of state.rows.entries()) {
    const mark = r.exists ? (r.count > 0 ? paint(glyph.ok, color.green) : paint(glyph.warn, color.yellow)) : paint(glyph.bad, color.red);
    const row =
      cursorMark(state, i) +
      `${mark} ` +
      pad(String(r.count), 8) +
      pad(paint(r.kind, color.grey), 9) +
      (r.exists ? r.entry : paint(r.entry, color.red));
    lines.push(truncate(row, cols));
  }
  return { header, listRows: lines };
}

function renderAgents(state, cols) {
  if (state.rows.length === 0) {
    return {
      header: [paint(`  no agents in ${tildify(paths.agents)} — files must sit directly in that dir, the loader does not recurse`, color.grey)],
      listRows: [],
    };
  }
  const header = [
    `  ${paint(pad("", 2) + pad("agent", 20) + pad("source", 10) + pad("model", 18) + pad("think", 8) + "description", color.grey, color.bold)}`,
  ];
  const lines = [];
  for (const [i, a] of state.rows.entries()) {
    const errors = a.problems.filter(p => p.level === "error").length;
    const warns = a.problems.filter(p => p.level === "warn").length;
    const mark = errors > 0 ? paint(glyph.bad, color.red) : warns > 0 ? paint(glyph.warn, color.yellow) : paint(glyph.ok, color.green);
    const row =
      cursorMark(state, i) +
      `${mark} ` +
      pad(paint(truncate(a.name, 19), a.enabled ? color.reset : color.grey), 20) +
      pad(paint(a.source, color.grey), 10) +
      pad(paint(truncate(a.model ?? "inherit", 17), color.grey), 18) +
      pad(paint(a.thinking ?? "—", color.grey), 8) +
      paint(truncate(a.description, Math.max(10, cols - 60)), color.grey);
    lines.push(truncate(row, cols));
  }
  return { header, listRows: lines };
}

function hint(state) {
  const common = paint("tab tabs · d doctor · ? help · q quit", color.grey);
  switch (TABS[state.tab]) {
    case "providers":
      return `${paint("enter", color.bold)} use · ${paint("m", color.bold)} models · ${paint("t", color.bold)} test · ${paint("T", color.bold)} thinking · ${paint("s", color.bold)} sync · ${paint("a e x", color.bold)} add edit del · ${paint("y", color.bold)} key · ${paint("i", color.bold)} import · ${common}`;
    case "models":
      return `${paint("enter", color.bold)} use · ${paint("p", color.bold)} next provider · ${paint("a e x", color.bold)} add edit del · ${common}`;
    case "mcp":
      return `${paint("enter", color.bold)} toggle · ${common}`;
    case "skills":
      return `${paint("a", color.bold)} add · ${paint("x", color.bold)} remove · ${paint("P", color.bold)} prune · ${common}`;
    case "agents":
      return `${paint("enter", color.bold)} inspect · ${common}`;
    default:
      return common;
  }
}
