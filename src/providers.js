/**
 * providers.js — provider/model CRUD over models.json + settings.json,
 * plus a reachability probe that talks to the real endpoint.
 */

import { API_TYPES } from "./api-types.js";
import { createModelDefaults, inferModelCapabilities, inferModelTransport, markManualCapabilities } from "./model-capabilities.js";
import { isInlineKey, loadModels, loadSettings, resolveApiKey, updateModels, updateSettings } from "./store.js";
import { validateProvider } from "./validate.js";

export { API_TYPES };

/** One row per provider, joined with the current default and key resolution state. */
export function listProviders() {
  const models = loadModels();
  const settings = loadSettings();
  return Object.entries(models.providers).map(([name, p]) => {
    const key = resolveApiKey(p.apiKey);
    return {
      name,
      api: p.api,
      baseUrl: p.baseUrl,
      apiKeySpec: p.apiKey,
      keyOk: Boolean(key.value),
      keySource: key.source,
      keyError: key.error,
      keyInline: isInlineKey(p.apiKey),
      models: (p.models || []).map(m => m.id),
      modelObjects: p.models || [],
      isDefault: settings.defaultProvider === name,
      defaultModel: settings.defaultProvider === name ? settings.defaultModel : undefined,
      raw: p,
    };
  });
}

export function getProvider(name) {
  return loadModels().providers[name] ?? null;
}

/** Set settings.defaultProvider / defaultModel. Validates the pair exists. */
export function setDefault(providerName, modelId) {
  const models = loadModels();
  const provider = models.providers[providerName];
  if (!provider) throw new Error(`provider "${providerName}" is not in models.json`);
  const ids = (provider.models || []).map(m => m.id);
  if (ids.length === 0) throw new Error(`provider "${providerName}" has no models`);
  const chosen = modelId ?? ids[0];
  if (!ids.includes(chosen)) {
    throw new Error(`model "${chosen}" is not defined under provider "${providerName}" (have: ${ids.join(", ")})`);
  }
  updateSettings(settings => {
    settings.defaultProvider = providerName;
    settings.defaultModel = chosen;
  });
  return { provider: providerName, model: chosen };
}

/** Insert or replace a whole provider entry. */
export function upsertProvider(name, config) {
  if (!config.baseUrl) throw new Error("baseUrl is required");
  if (config.api === undefined) throw new Error("api is required");
  validateProvider(name, config);
  updateModels(models => {
    models.providers[name] = config;
  });
  return config;
}

/**
 * Copy a provider without resolving its credential. The apiKey field is a
 * reference (environment variable, keychain command, or inline value) and is
 * deliberately carried over as-is; resolving it here would put a secret in
 * the bridge response and would make a copy operation unexpectedly access the
 * keychain.
 */
export function duplicateProvider(sourceName, targetName) {
  const name = typeof targetName === "string" ? targetName.trim() : "";
  if (!name) throw new Error("target provider name is required");
  if (name === sourceName) throw new Error("the copied Provider needs a different name");

  let result;
  updateModels(models => {
    const source = models.providers[sourceName];
    if (!source) throw new Error(`provider "${sourceName}" not found`);
    if (models.providers[name]) throw new Error(`provider "${name}" already exists`);

    const copy = structuredClone(source);
    validateProvider(name, copy);
    models.providers[name] = copy;
    const keySpec = copy.apiKey;
    const keyStorage = typeof keySpec !== "string" || !keySpec
      ? "missing"
      : keySpec.startsWith("!")
        ? "command"
        : keySpec.startsWith("$")
          ? "environment"
          : "inline";
    result = {
      source: sourceName,
      name,
      api: copy.api,
      modelCount: copy.models?.length || 0,
      keyStorage,
    };
  });
  return result;
}

/** Patch selected fields of an existing provider. */
export function patchProvider(name, patch) {
  let next;
  updateModels(models => {
    const existing = models.providers[name];
    if (!existing) throw new Error(`provider "${name}" not found`);
    next = { ...existing, ...patch };
    validateProvider(name, next);
    models.providers[name] = next;
  });
  return next;
}

/**
 * Delete a provider. Refuses while it is the default, so pi can never be left
 * pointing at a provider that no longer exists (it fails to start).
 */
export function deleteProvider(name) {
  const settings = loadSettings();
  if (settings.defaultProvider === name) {
    throw new Error(`"${name}" is the default provider — switch to another one first`);
  }
  updateModels(models => {
    if (!models.providers[name]) throw new Error(`provider "${name}" not found`);
    delete models.providers[name];
  });
}

/** Add or replace a model definition under a provider. */
export function upsertModel(providerName, model) {
  if (!model.id) throw new Error("model id is required");
  let merged;
  updateModels(models => {
    const provider = models.providers[providerName];
    if (!provider) throw new Error(`provider "${providerName}" not found`);
    provider.models = provider.models || [];
    const at = provider.models.findIndex(m => m.id === model.id);
    const existing = at >= 0 ? provider.models[at] : null;
    const defaults = existing || createModelDefaults(model.id, providerName, {
      api: provider.api,
      capabilitySource: model.capabilitySource ?? model,
    });
    merged = { ...defaults, ...model };
    if (!model.capabilities && (Object.prototype.hasOwnProperty.call(model, "input") ||
      Object.prototype.hasOwnProperty.call(model, "reasoning") ||
      Object.prototype.hasOwnProperty.call(model, "contextWindow"))) {
      merged.capabilities = markManualCapabilities(existing || defaults, model);
    }
    delete merged.capabilitySource;
    if (at >= 0) provider.models[at] = merged;
    else provider.models.push(merged);
  });
  return merged;
}

/**
 * Apply an explicit set of fields to several existing models in one locked
 * write. Capability fields become manual locks, while every omitted field and
 * every unrelated capability declaration is preserved.
 */
export function batchUpdateModels(providerName, modelIds, patch = {}) {
  const ids = [...new Set((Array.isArray(modelIds) ? modelIds : [])
    .map(id => typeof id === "string" ? id.trim() : "")
    .filter(Boolean))];
  if (ids.length === 0) throw new Error("at least one model is required");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("model patch must be an object");
  }

  const allowed = new Set(["contextWindow", "maxTokens", "input", "reasoning"]);
  const fields = Object.keys(patch);
  const unknown = fields.filter(field => !allowed.has(field));
  if (unknown.length > 0) throw new Error(`batch model edit cannot change: ${unknown.join(", ")}`);
  if (fields.length === 0) throw new Error("select at least one field to change");

  const contextWindow = patch.contextWindow;
  if (Object.prototype.hasOwnProperty.call(patch, "contextWindow") &&
    (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
    throw new Error("contextWindow must be a positive integer");
  }
  const maxTokens = patch.maxTokens;
  if (Object.prototype.hasOwnProperty.call(patch, "maxTokens") &&
    (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error("maxTokens must be a positive integer");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "reasoning") && typeof patch.reasoning !== "boolean") {
    throw new Error("reasoning must be true or false");
  }
  if (Object.prototype.hasOwnProperty.call(patch, "input")) {
    if (!Array.isArray(patch.input) || patch.input.length === 0 ||
      new Set(patch.input).size !== patch.input.length ||
      patch.input.some(value => value !== "text" && value !== "image") ||
      !patch.input.includes("text")) {
      throw new Error('input must be a non-empty list containing "text" and optionally "image"');
    }
  }

  let result;
  updateModels(models => {
    const provider = models.providers[providerName];
    if (!provider) throw new Error(`provider "${providerName}" not found`);
    const modelById = new Map((provider.models || []).map(model => [model.id, model]));
    const missing = ids.filter(id => !modelById.has(id));
    if (missing.length > 0) throw new Error(`model(s) not found under provider "${providerName}": ${missing.join(", ")}`);

    for (const id of ids) {
      const current = modelById.get(id);
      const next = { ...current, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "input") ||
        Object.prototype.hasOwnProperty.call(patch, "reasoning") ||
        Object.prototype.hasOwnProperty.call(patch, "contextWindow")) {
        next.capabilities = markManualCapabilities(current, patch);
      }
      const index = provider.models.indexOf(current);
      provider.models[index] = next;
    }
    result = { provider: providerName, updated: ids, fields: [...fields] };
  });
  return result;
}

/**
 * Preview capability changes that can be proven by the provider's model list.
 * A model-list row that only contains an id contributes no evidence, so it is
 * deliberately ignored. This keeps a sparse `/models` response from silently
 * rewriting a user's existing capability choices.
 */
export function planModelCapabilityRefresh(providerName, modelDetails = []) {
  const provider = getProvider(providerName);
  if (!provider) throw new Error(`provider "${providerName}" not found`);
  const details = new Map(
    (Array.isArray(modelDetails) ? modelDetails : [])
      .filter(detail => detail && typeof detail.id === "string" && detail.id.trim())
      .map(detail => [detail.id.trim(), detail]),
  );
  return buildCapabilityRefreshPlan(provider, details);
}

/**
 * Apply only explicit server capability declarations to existing models.
 * Manual edits and prior confirmed declarations are locks and are never
 * replaced by a later sync. The returned ids are safe for UI summaries.
 */
export function refreshModelCapabilities(providerName, modelDetails = []) {
  const preview = planModelCapabilityRefresh(providerName, modelDetails);
  if (preview.length === 0) return { provider: providerName, changed: [] };
  let changed = [];
  updateModels(models => {
    const provider = models.providers[providerName];
    if (!provider) throw new Error(`provider "${providerName}" not found`);
    const details = new Map(
      (Array.isArray(modelDetails) ? modelDetails : [])
        .filter(detail => detail && typeof detail.id === "string" && detail.id.trim())
        .map(detail => [detail.id.trim(), detail]),
    );
    const plan = buildCapabilityRefreshPlan(provider, details);
    changed = plan.map(change => change.id);
    for (const change of plan) {
      const model = provider.models.find(item => item.id === change.id);
      if (!model) continue;
      Object.assign(model, change.patch);
    }
  });
  return { provider: providerName, changed };
}

function buildCapabilityRefreshPlan(provider, details) {
  const plan = [];
  for (const model of provider.models || []) {
    const detail = details.get(model.id);
    if (!detail) continue;
    const inferred = inferModelCapabilities(model.id, { api: provider.api, declared: detail });
    const currentCapabilities = model.capabilities && typeof model.capabilities === "object"
      ? structuredClone(model.capabilities)
      : {};
    const patch = {};
    const fields = [];

    if (inferred.capabilities.input.confidence === "confirmed" &&
      !isLockedCapability(currentCapabilities.input)) {
      if (!sameInput(model.input, inferred.input)) {
        patch.input = inferred.input;
        fields.push("input");
      }
      if (!sameCapability(currentCapabilities.input, inferred.capabilities.input)) {
        currentCapabilities.input = inferred.capabilities.input;
        fields.push("input evidence");
      }
    }

    if (inferred.capabilities.reasoning.confidence === "confirmed" &&
      !isLockedCapability(currentCapabilities.reasoning)) {
      if (Boolean(model.reasoning) !== inferred.reasoning) {
        patch.reasoning = inferred.reasoning;
        fields.push("reasoning");
      }
      if (!sameCapability(currentCapabilities.reasoning, inferred.capabilities.reasoning)) {
        currentCapabilities.reasoning = inferred.capabilities.reasoning;
        fields.push("reasoning evidence");
      }
    }

    if (inferred.capabilities.contextWindow.confidence === "confirmed" &&
      !isLockedCapability(currentCapabilities.contextWindow)) {
      if (model.contextWindow !== inferred.contextWindow) {
        patch.contextWindow = inferred.contextWindow;
        fields.push("context window");
      }
      if (!sameCapability(currentCapabilities.contextWindow, inferred.capabilities.contextWindow)) {
        currentCapabilities.contextWindow = inferred.capabilities.contextWindow;
        fields.push("context window evidence");
      }
    }

    if (fields.length > 0) {
      patch.capabilities = currentCapabilities;
      plan.push({ id: model.id, fields, patch });
    }
  }
  return plan;
}

function sameCapability(left, right) {
  return left?.confidence === right?.confidence && left?.source === right?.source;
}

/**
 * Repair only rows whose capability registry has a concrete inference. Rows
 * marked manual/confirmed, and rows that remain unknown, are left untouched.
 */
export function repairModelCapabilities(providerName, modelId) {
  const changed = [];
  updateModels(models => {
    const provider = models.providers[providerName];
    if (!provider) throw new Error(`provider "${providerName}" not found`);
    for (const model of provider.models || []) {
      if (modelId && model.id !== modelId) continue;
      const lockedInput = isLockedCapability(model.capabilities?.input);
      const lockedReasoning = isLockedCapability(model.capabilities?.reasoning);
      const lockedContext = isLockedCapability(model.capabilities?.contextWindow);
      const inferred = inferModelCapabilities(model.id, { api: provider.api });
      const next = { ...model };
      let didChange = false;
      const transport = inferModelTransport(model.id, { api: provider.api });
      if (transport.thinkingLevelMap && next.thinkingLevelMap === undefined) {
        next.thinkingLevelMap = transport.thinkingLevelMap;
        didChange = true;
      }
      if (transport.compat && next.compat === undefined) {
        next.compat = transport.compat;
        didChange = true;
      }
      if (!lockedInput && inferred.capabilities.input.confidence !== "unknown" && !sameInput(next.input, inferred.input)) {
        next.input = inferred.input;
        didChange = true;
      }
      if (!lockedReasoning && inferred.capabilities.reasoning.confidence !== "unknown" && next.reasoning !== inferred.reasoning) {
        next.reasoning = inferred.reasoning;
        didChange = true;
      }
      if (!lockedContext && inferred.capabilities.contextWindow.confidence !== "unknown" &&
        next.contextWindow !== inferred.contextWindow) {
        next.contextWindow = inferred.contextWindow;
        didChange = true;
      }
      const capabilities = next.capabilities && typeof next.capabilities === "object"
        ? structuredClone(next.capabilities)
        : {};
      if (!lockedInput && inferred.capabilities.input.confidence !== "unknown" && !isLockedCapability(capabilities.input)) {
        capabilities.input = inferred.capabilities.input;
        didChange = true;
      }
      if (!lockedReasoning && inferred.capabilities.reasoning.confidence !== "unknown" && !isLockedCapability(capabilities.reasoning)) {
        capabilities.reasoning = inferred.capabilities.reasoning;
        didChange = true;
      }
      if (!lockedContext && inferred.capabilities.contextWindow.confidence !== "unknown" &&
        !isLockedCapability(capabilities.contextWindow)) {
        capabilities.contextWindow = inferred.capabilities.contextWindow;
        didChange = true;
      }
      if (didChange) {
        next.capabilities = capabilities;
        changed.push(next.id);
        const index = provider.models.indexOf(model);
        provider.models[index] = next;
      }
    }
  });
  return { provider: providerName, changed };
}

function isLockedCapability(entry) {
  return entry?.source === "manual" || entry?.confidence === "confirmed";
}

function sameInput(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

/**
 * Set settings.defaultThinkingLevel. Pi accepts these seven levels; anything else
 * is ignored, so a typo would silently leave the old level in place.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function setThinking(level) {
  if (!THINKING_LEVELS.includes(level)) {
    throw new Error(`"${level}" is not a thinking level (${THINKING_LEVELS.join(", ")})`);
  }
  updateSettings(settings => {
    settings.defaultThinkingLevel = level;
  });
  return level;
}

/** Remove a model. Refuses if it is the active default model. */
export function deleteModel(providerName, modelId) {
  const settings = loadSettings();
  if (settings.defaultProvider === providerName && settings.defaultModel === modelId) {
    throw new Error(`${providerName}/${modelId} is the active default — switch first`);
  }
  updateModels(models => {
    const provider = models.providers[providerName];
    if (!provider) throw new Error(`provider "${providerName}" not found`);
    const before = (provider.models || []).length;
    provider.models = (provider.models || []).filter(m => m.id !== modelId);
    if (provider.models.length === before) throw new Error(`model "${modelId}" not found`);
  });
}

// ---- health probe ----

/**
 * Relay path suffixes that front an Anthropic-compatible API. A base URL ending
 * in one of these usually still serves an OpenAI-style model list at the root,
 * so it is worth retrying there. Ordered longest-first so `/api/anthropic` wins
 * over `/anthropic`.
 */
const COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/claudecode",
  "/anthropic",
  "/coding",
  "/claude",
];

/** True when a URL already ends in a version segment: /v1, /api/coding/paas/v4. */
function endsWithVersion(url) {
  const last = url.split("/").pop() ?? "";
  return /^v\d+$/.test(last);
}

/**
 * Candidate model-list URLs for an OpenAI-shaped provider, best guess first.
 *
 * A single guess is wrong too often to be useful: `https://api.deepseek.com`
 * needs `/v1/models`, `https://api.z.ai/api/coding/paas/v4` needs `/models`
 * (appending `/v1` gives `/paas/v4/v1/models` → 404), and a relay on
 * `https://x.com/api/anthropic` serves its list at the root. Deduped, order kept.
 */
export function modelsUrlCandidates(baseUrl) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return [];
  const out = [];

  if (endsWithVersion(base)) {
    out.push(`${base}/models`);
    // A non-/v1 version segment still sometimes has a /v1 list underneath it.
    if (!base.endsWith("/v1")) out.push(`${base}/v1/models`);
  } else {
    out.push(`${base}/v1/models`);
    out.push(`${base}/models`);
  }

  const suffix = COMPAT_SUFFIXES.find(s => base.endsWith(s));
  if (suffix) {
    const root = base.slice(0, -suffix.length).replace(/\/+$/, "");
    if (root.includes("://")) {
      out.push(`${root}/v1/models`);
      out.push(`${root}/models`);
    }
  }
  return [...new Set(out)];
}

/** Per-api candidate URLs plus the auth headers that go with them. */
function probeRequest(provider) {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const key = resolveApiKey(provider.apiKey);
  if (!key.value) return { error: key.error || "no api key" };

  switch (provider.api) {
    case "anthropic-messages":
      return {
        urls: [`${base}/v1/models`],
        headers: { "x-api-key": key.value, "anthropic-version": "2023-06-01" },
        secret: key.value,
      };
    case "google-generative-ai":
      // The key rides in the query string, so it must never reach an error message.
      return {
        urls: [`${base}/v1beta/models?key=${encodeURIComponent(key.value)}`],
        headers: {},
        secret: key.value,
      };
    default:
      return {
        urls: modelsUrlCandidates(base),
        headers: { authorization: `Bearer ${key.value}` },
        secret: key.value,
      };
  }
}

/**
 * Hit the provider's model-list endpoint, trying each candidate URL until one
 * answers with something other than 404/405. Returns { ok, status, ms, models[],
 * url, error }. Never throws.
 */
export async function probeProvider(provider, { timeoutMs = 10_000 } = {}) {
  const req = probeRequest(provider);
  if (req.error) return { ok: false, error: req.error, ms: 0 };
  if (req.urls.length === 0) return { ok: false, error: "baseUrl is empty", ms: 0 };

  const started = Date.now();
  let lastError = null;

  for (const [index, url] of req.urls.entries()) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: req.headers, signal: ac.signal });
      const ms = Date.now() - started;
      const text = await res.text();
      if (res.ok) {
        const parsed = extractModelEntries(text);
        return {
          ok: true,
          status: res.status,
          ms,
          url,
          attempts: index + 1,
          models: parsed.ids,
          modelDetails: parsed.details,
        };
      }

      const error = redact(shortError(res.status, text), req.secret);
      // Only a missing endpoint is worth another guess; 401 or 500 is the answer.
      if (res.status !== 404 && res.status !== 405) return { ok: false, status: res.status, ms, url, error };
      lastError = { status: res.status, ms, url, error };
    } catch (err) {
      const ms = Date.now() - started;
      // A transport failure will repeat on every candidate — stop here.
      return { ok: false, ms, url, error: redact(networkError(err, timeoutMs), req.secret) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    ...lastError,
    error: req.urls.length > 1
      ? `no model list found (tried ${req.urls.length} paths; last: ${lastError.error})`
      : lastError.error,
  };
}

/**
 * Strip the api key out of anything headed for the screen. Some gateways echo
 * the credential back in their error body, and a redacted-by-accident log is not
 * a control.
 */
function redact(text, secret) {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("[REDACTED]");
}

/**
 * fetch collapses every transport failure into "fetch failed", which says
 * nothing actionable. Dig out the cause so a typo'd host reads differently from
 * a refused connection or a TLS problem.
 */
function networkError(err, timeoutMs) {
  if (err.name === "AbortError") return `timeout after ${timeoutMs}ms`;
  let cause = err.cause ?? {};
  // A dual-stack host produces an AggregateError wrapping one failure per family.
  if (cause.errors?.length) cause = cause.errors[0];
  switch (cause.code) {
    case "ENOTFOUND":
      return `host not found: ${cause.hostname ?? "?"} (check baseUrl)`;
    case "ECONNREFUSED":
      return "connection refused (nothing listening on that host/port)";
    case "ECONNRESET":
      return "connection reset by the server";
    case "ETIMEDOUT":
      return "connection timed out (network or firewall)";
    case "CERT_HAS_EXPIRED":
      return "TLS certificate has expired";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return "TLS certificate could not be verified";
    default:
      // No code at all (e.g. an unparseable baseUrl) — the cause message is the
      // only useful part; "fetch failed" on its own tells the user nothing.
      if (cause.message) return `${cause.message} (check baseUrl)`;
      return err.message;
  }
}

/**
 * Pull ids and capability hints out of an OpenAI-, Anthropic- or Google-shaped
 * model list.  Most gateways only return ids; those rows remain eligible for
 * the model-name inference path instead of being treated as text-only.
 */
function extractModelEntries(text) {
  try {
    const body = JSON.parse(text);
    const rows = body.data ?? body.models ?? [];
    const details = [];
    const ids = [];
    for (const row of rows) {
      const rawId = typeof row === "string" ? row : row?.id ?? row?.name;
      if (!rawId) continue;
      const id = String(rawId).replace(/^models\//, "");
      if (!ids.includes(id)) ids.push(id);
      if (typeof row !== "object" || row === null) continue;

      const detail = { id };
      for (const key of [
        "input",
        "input_modalities",
        "inputModalities",
        "modalities",
        "vision",
        "supports_vision",
        "supportsVision",
        "capabilities",
        "reasoning",
        "supports_reasoning",
        "supportsReasoning",
        "supports_reasoning_effort",
        "supportsReasoningEffort",
        "thinking",
        "supported_reasoning_levels",
        "supportedReasoningLevels",
        "contextWindow",
        "context_window",
        "maxContextWindow",
        "max_context_window",
        "contextLength",
        "context_length",
        "maxContextLength",
        "max_context_length",
        "contextLimit",
        "context_limit",
        "contextWindowTokens",
        "context_window_tokens",
        "maxContextTokens",
        "max_context_tokens",
        "maxInputTokens",
        "max_input_tokens",
        "inputTokenLimit",
        "input_token_limit",
        "limits",
        "limit",
        "top_provider",
        "topProvider",
        "metadata",
        "model_info",
        "modelInfo",
      ]) {
        if (row[key] !== undefined) detail[key] = row[key];
      }
      if (Object.keys(detail).length > 1) details.push(detail);
    }
    return { ids, details };
  } catch {
    return { ids: [], details: [] };
  }
}

/** Turn an error body into one readable line. */
function shortError(status, text) {
  let detail = text.slice(0, 200).replace(/\s+/g, " ").trim();
  try {
    const body = JSON.parse(text);
    detail = body.error?.message ?? body.error?.type ?? body.message ?? detail;
  } catch {
    /* keep the raw snippet */
  }
  const hint =
    status === 401 || status === 403
      ? " (key rejected — rotate it)"
      : status === 404
        ? " (endpoint path wrong? check baseUrl)"
        : "";
  return `HTTP ${status}: ${detail}${hint}`;
}

/**
 * Compare the models declared in models.json against what the endpoint reports.
 * This is the check that catches a configured-but-nonexistent model id before
 * pi fails at request time with model_not_found.
 *
 * Relays commonly publish dated ids (claude-haiku-4-5-20251001) while accepting
 * the undated alias, so a declared id that is a prefix of exactly one reported id
 * is reported as `aliased` rather than `missing` — likely fine, but worth naming.
 * Only ids with no plausible match at all land in `missing`.
 */
export function diffModels(declared, reported) {
  if (!reported || reported.length === 0) return { missing: [], aliased: [], extra: [], unknown: true };
  const set = new Set(reported);
  const missing = [];
  const aliased = [];

  for (const raw of declared) {
    const id = raw.replace(/\[.*\]$/, "");
    if (set.has(id)) continue;
    const candidates = reported.filter(r => r.startsWith(`${id}-`));
    if (candidates.length > 0) aliased.push({ id, candidates });
    else missing.push(id);
  }
  const claimed = new Set([...declared.map(id => id.replace(/\[.*\]$/, "")), ...aliased.flatMap(a => a.candidates)]);
  return { missing, aliased, extra: reported.filter(id => !claimed.has(id)), unknown: false };
}
