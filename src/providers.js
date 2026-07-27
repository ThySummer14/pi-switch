/**
 * providers.js — provider/model CRUD over models.json + settings.json,
 * plus a reachability probe that talks to the real endpoint.
 */

import { API_TYPES } from "./api-types.js";
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
    merged = {
      contextWindow: 200_000,
      maxTokens: 32_768,
      input: ["text"],
      reasoning: false,
      ...(at >= 0 ? provider.models[at] : {}),
      ...model,
    };
    if (at >= 0) provider.models[at] = merged;
    else provider.models.push(merged);
  });
  return merged;
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
      if (res.ok) return { ok: true, status: res.status, ms, url, attempts: index + 1, models: extractModelIds(text) };

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

/** Pull model ids out of an OpenAI- or Anthropic- or Google-shaped list response. */
function extractModelIds(text) {
  try {
    const body = JSON.parse(text);
    const rows = body.data ?? body.models ?? [];
    return rows
      .map(m => (typeof m === "string" ? m : m.id ?? m.name))
      .filter(Boolean)
      .map(id => String(id).replace(/^models\//, ""));
  } catch {
    return [];
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
