/**
 * import-ccswitch.js — read providers out of ~/.cc-switch/cc-switch.db and
 * translate them into pi's models.json shape.
 *
 * The DB is opened READ-ONLY. pi-switch never writes to cc-switch's storage:
 * cc-switch owns its own schema migrations and a stray write could break it.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { paths } from "./paths.js";
import { createModelDefaults, inferCcSwitchCatalogCapabilities } from "./model-capabilities.js";

/** app_type values that carry something pi can use. */
const SUPPORTED_APP_TYPES = new Set(["claude", "claude-desktop", "openclaw", "codex"]);

export function ccSwitchAvailable() {
  return existsSync(paths.ccSwitchDb);
}

/**
 * Open cc-switch.db read-only. Caller must close().
 *
 * node:sqlite is loaded here rather than at module scope: it is still flagged
 * experimental, so importing it eagerly prints a warning on every pi-switch run
 * even when no import is happening.
 */
function openDb() {
  if (!ccSwitchAvailable()) throw new Error(`cc-switch database not found at ${paths.ccSwitchDb}`);
  const require = createRequire(import.meta.url);
  const emitWarning = process.emitWarning;
  process.emitWarning = () => {}; // node:sqlite is flagged experimental and warns on load
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } finally {
    process.emitWarning = emitWarning;
  }
  return new DatabaseSync(paths.ccSwitchDb, { readOnly: true });
}

/**
 * Read every provider row and convert what we can.
 * Returns [{ id, appType, name, isCurrent, converted, reason }].
 * `converted` is a pi provider config, or null when the row can't be mapped.
 */
export function readCcSwitchProviders() {
  const db = openDb();
  try {
    const rows = db
      .prepare("SELECT id, app_type, name, settings_config, meta, is_current FROM providers ORDER BY app_type, sort_index")
      .all();
    return rows.map(row => {
      const base = {
        id: row.id,
        appType: row.app_type,
        name: row.name,
        isCurrent: Boolean(row.is_current),
      };
      if (!SUPPORTED_APP_TYPES.has(row.app_type)) {
        return { ...base, converted: null, reason: `app_type "${row.app_type}" has no pi equivalent` };
      }
      let config;
      try {
        config = JSON.parse(row.settings_config);
      } catch {
        return { ...base, converted: null, reason: "settings_config is not valid JSON" };
      }
      try {
        const converted = convert(row.app_type, config, row.name);
        return { ...base, ...converted };
      } catch (err) {
        return { ...base, converted: null, reason: err.message };
      }
    });
  } finally {
    db.close();
  }
}

/** Dispatch on app_type. Exported for tests; throws with the reason on failure. */
export function convert(appType, config, displayName) {
  switch (appType) {
    case "claude":
    case "claude-desktop":
      return convertClaude(config, displayName);
    case "openclaw":
      return convertOpenClaw(config, displayName);
    case "codex":
      return convertCodex(config, displayName);
    default:
      throw new Error(`unhandled app_type ${appType}`);
  }
}

/**
 * Claude Code providers are env-var based. ANTHROPIC_BASE_URL + AUTH_TOKEN map
 * straight onto pi's anthropic-messages api.
 *
 * Claude Code appends a [1M] context suffix to model ids (e.g. claude-opus-5[1M]);
 * that is a Claude-Code-only convention, so it is stripped. The *_MODEL_NAME
 * variants already hold the clean id and are preferred when present.
 */
function convertClaude(config, displayName) {
  const env = config.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL;
  if (!baseUrl) throw new Error("no ANTHROPIC_BASE_URL in env");
  const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY in env");

  const models = [];
  const push = id => {
    if (!id) return;
    const raw = String(id);
    const clean = raw.replace(/\[[^\]]*\]$/, "");
    if (models.some(model => model.id === clean)) return;
    models.push({ id: clean, ...( /\[(?:1m|1million)\]$/i.test(raw) ? { contextWindow: 1_000_000 } : {}) });
  };
  // Prefer the explicit *_MODEL_NAME fields, then the routed model vars.
  push(env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME);
  push(env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME);
  push(env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME);
  push(env.ANTHROPIC_MODEL);
  push(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
  push(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  push(env.ANTHROPIC_DEFAULT_HAIKU_MODEL);

  if (models.length === 0) throw new Error("no model ids found in env");

  return {
    converted: {
      baseUrl: normaliseAnthropicBase(baseUrl),
      api: "anthropic-messages",
      apiKey,
      authHeader: true,
      models: models.map(model => defaultModel(model.id, displayName, "anthropic-messages", model)),
    },
    reason: null,
  };
}

/**
 * pi's anthropic-messages client appends /v1/messages itself, so a baseUrl that
 * already ends in /v1 would produce /v1/v1/messages.
 */
function normaliseAnthropicBase(url) {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** OpenClaw rows are already in pi's own provider shape — baseUrl/api/models. */
function convertOpenClaw(config, displayName) {
  if (!config.baseUrl) throw new Error("no baseUrl");
  if (!config.apiKey) throw new Error("no apiKey");
  const models = (config.models || []).map(m =>
    m.id ? normalizeOpenClawModel(m, displayName, config.api || "openai-completions") : null,
  ).filter(Boolean);
  if (models.length === 0) throw new Error("no models defined");
  return {
    converted: {
      baseUrl: config.baseUrl.replace(/\/+$/, ""),
      api: config.api || "openai-completions",
      apiKey: config.apiKey,
      models,
    },
    reason: null,
  };
}

/**
 * OpenClaw rows can be either hand-authored Pi models or copied catalog rows.
 * Keep an explicit manual/server capability lock, but do not let an unlocked
 * legacy `input: ["text"]` / `reasoning: false` pair bypass the shared inference.
 */
function normalizeOpenClawModel(source, displayName, api) {
  const base = defaultModel(source.id, displayName, api, source);
  const {
    id: _id,
    name: _name,
    input: _input,
    reasoning: _reasoning,
    capabilities: _capabilities,
    contextWindow: _contextWindow,
    context_window: _context_window,
    maxContextWindow: _maxContextWindow,
    max_context_window: _max_context_window,
    contextLength: _contextLength,
    context_length: _context_length,
    contextLimit: _contextLimit,
    context_limit: _context_limit,
    maxTokens: _maxTokens,
    max_tokens: _max_tokens,
    ...metadata
  } = source;
  const inputLocked = source.capabilities && typeof source.capabilities === "object" &&
    isLockedCapability(source.capabilities.input);
  const reasoningLocked = source.capabilities && typeof source.capabilities === "object" &&
    isLockedCapability(source.capabilities.reasoning);
  const contextLocked = source.capabilities && typeof source.capabilities === "object" &&
    isLockedCapability(source.capabilities.contextWindow);
  const lockedCapabilities = { ...base.capabilities };
  if (inputLocked) lockedCapabilities.input = source.capabilities.input;
  if (reasoningLocked) lockedCapabilities.reasoning = source.capabilities.reasoning;
  if (contextLocked) lockedCapabilities.contextWindow = source.capabilities.contextWindow;
  return {
    ...base,
    ...metadata,
    ...(inputLocked && source.input !== undefined ? { input: source.input } : {}),
    ...(reasoningLocked && source.reasoning !== undefined ? { reasoning: source.reasoning } : {}),
    ...((inputLocked || reasoningLocked || contextLocked) ? { capabilities: lockedCapabilities } : {}),
    name: source.name ? `${source.name} (${displayName})` : base.name,
  };
}

function isLockedCapability(entry) {
  return entry?.source === "manual" || entry?.confidence === "confirmed";
}

/**
 * Codex rows keep their settings in a TOML blob. Parse only the four fields we
 * need rather than pulling in a TOML dependency.
 */
function convertCodex(config, displayName) {
  const apiKey = config.auth?.OPENAI_API_KEY;
  if (!apiKey) throw new Error("no OPENAI_API_KEY in auth");
  const toml = config.config || "";
  const baseUrl = tomlValue(toml, "base_url");
  if (!baseUrl) throw new Error("no base_url in config TOML");
  const model = tomlValue(toml, "model");
  if (!model) throw new Error("no model in config TOML");
  const wireApi = tomlValue(toml, "wire_api") || "responses";
  return {
    converted: {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      api: wireApi === "chat" ? "openai-completions" : "openai-responses",
      apiKey,
      models: [defaultModel(model, displayName, wireApi === "chat" ? "openai-completions" : "openai-responses", {
        model: model,
        // Some cc-switch versions persist the mapping under settings_config;
        // preserve it when present instead of reducing it to a text-only row.
        ...(config.modelCatalog?.models?.find(entry => entry?.model === model || entry?.slug === model) || {}),
      })],
    },
    reason: null,
  };
}

/** Grab `key = "value"` out of a flat TOML string. First match wins. */
function tomlValue(toml, key) {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : null;
}

/** A credential-preserving model entry with capability evidence attached. */
function defaultModel(id, displayName, api, source = {}) {
  const model = createModelDefaults(id, displayName, {
    api,
    capabilitySource: source,
    contextSourceType: "cc-switch-catalog",
  });
  const capabilities = inferCcSwitchCatalogCapabilities(id, { api, catalog: source });
  const contextWindow = capabilities.contextWindow;
  const maxTokens = Number(source.maxTokens ?? source.max_tokens);
  return {
    ...model,
    input: capabilities.input,
    reasoning: capabilities.reasoning,
    capabilities: capabilities.capabilities,
    ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
    ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
    name: source.displayName || source.display_name
      ? `${source.displayName || source.display_name} (${displayName})`
      : `${id} (${displayName})`,
  };
}

/** Turn a cc-switch row name into a legal pi provider key. */
export function suggestProviderName(row) {
  const slug = row.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `ccsw-${row.id.slice(0, 8)}`;
}

/**
 * Assign a unique target name to each row.
 *
 * Two kinds of collision happen in practice: cc-switch stores the same provider
 * under several app_types (one DeepSeek row for claude, another for
 * claude-desktop), and a slug can equal a provider pi already has — where the
 * existing entry is very likely the hand-tuned one (real contextWindow, correct
 * reasoning flag, key in the keychain). Import never overwrites: both cases get
 * an -<app_type> or -2 suffix, and `renamedFrom` records why.
 */
export function planImportNames(rows, existingNames = []) {
  const taken = new Set(existingNames);
  return rows.map(row => {
    const base = suggestProviderName(row);
    let name = base;
    if (taken.has(name)) name = `${base}-${row.appType}`;
    let n = 2;
    while (taken.has(name)) name = `${base}-${n++}`;
    taken.add(name);
    return { row, name, renamedFrom: name === base ? null : base };
  });
}
