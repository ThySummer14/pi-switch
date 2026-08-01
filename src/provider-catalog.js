/**
 * Provider template catalog sync.
 *
 * The remote catalog is deliberately narrow: it is fetched from Pi Switch's
 * fixed public HTTPS source, accepts only credential-free form defaults, and
 * is cached separately from Pi's models.json. A sync can therefore never
 * alter a configured Provider or expose an API key.
 */

import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { API_TYPES } from "./api-types.js";
import { paths } from "./paths.js";
import { PROVIDER_PRESETS } from "./provider-presets.js";
import { backup, readJson, writeJson } from "./store.js";
import { validateProvider } from "./validate.js";

export const PROVIDER_CATALOG_FORMAT = "pi-switch-provider-catalog";
export const PROVIDER_CATALOG_VERSION = 1;
export const PROVIDER_CATALOG_CACHE_FORMAT = "pi-switch-provider-catalog-cache";
export const PROVIDER_CATALOG_CACHE_VERSION = 1;
export const PROVIDER_CATALOG_URL = "https://raw.githubusercontent.com/ThySummer14/pi-switch/main/catalog/provider-presets.json";

const MAX_CATALOG_BYTES = 128 * 1024;
const CATALOG_TIMEOUT_MS = 8_000;
const CATALOG_KEYS = new Set(["format", "version", "updatedAt", "presets"]);
const PRESET_KEYS = new Set(["id", "label", "description", "name", "baseUrl", "api", "model"]);
const CACHE_KEYS = new Set(["format", "version", "url", "fetchedAt", "sha256", "catalog"]);
const PRESET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象`);
  }
}

function assertExactKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path} 不允许字段 ${key}`);
  }
}

function requiredString(value, path, maxLength) {
  if (typeof value !== "string") throw new Error(`${path} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${path} 不能为空`);
  if (normalized.length > maxLength) throw new Error(`${path} 不能超过 ${maxLength} 个字符`);
  if (/\p{Cc}/u.test(normalized)) throw new Error(`${path} 不能包含控制字符`);
  return normalized;
}

function normalizeDate(value, path) {
  const normalized = requiredString(value, path, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${path} 必须是 ISO 日期时间`);
  return normalized;
}

function normalizeBaseUrl(value, path) {
  const text = requiredString(value, path, 512);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${path} 不是有效 URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${path} 必须使用 HTTPS`);
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${path} 不能包含凭据、查询参数或片段`);
  }
  return text.replace(/\/+$/, "");
}

function normalizePreset(value, index) {
  const path = `presets[${index}]`;
  assertObject(value, path);
  assertExactKeys(value, PRESET_KEYS, path);
  for (const key of PRESET_KEYS) {
    if (!hasOwn(value, key)) throw new Error(`${path}.${key} 是必填字段`);
  }

  const id = requiredString(value.id, `${path}.id`, 64);
  if (!PRESET_ID.test(id) || id === "custom") {
    throw new Error(`${path}.id 必须是非 custom 的小写模板标识`);
  }
  const label = requiredString(value.label, `${path}.label`, 80);
  const description = requiredString(value.description, `${path}.description`, 280);
  const name = requiredString(value.name, `${path}.name`, 80);
  const baseUrl = normalizeBaseUrl(value.baseUrl, `${path}.baseUrl`);
  const api = requiredString(value.api, `${path}.api`, 64);
  const model = requiredString(value.model, `${path}.model`, 160);
  if (!API_TYPES.includes(api)) throw new Error(`${path}.api 不是 Pi 支持的 API 类型`);

  // Reuse the same name and model constraints used before models.json writes.
  validateProvider(name, { baseUrl, api, models: [{ id: model }] }, path);
  return { id, label, description, name, baseUrl, api, model };
}

/** Parse and strictly normalize an untrusted public catalog document. */
export function validateProviderCatalog(value) {
  assertObject(value, "catalog");
  assertExactKeys(value, CATALOG_KEYS, "catalog");
  if (value.format !== PROVIDER_CATALOG_FORMAT) throw new Error("不是 Pi Switch Provider 模板目录");
  if (value.version !== PROVIDER_CATALOG_VERSION) throw new Error(`不支持的模板目录版本：${value.version}`);
  const updatedAt = normalizeDate(value.updatedAt, "catalog.updatedAt");
  if (!Array.isArray(value.presets) || value.presets.length === 0 || value.presets.length > 100) {
    throw new Error("catalog.presets 必须包含 1 到 100 个模板");
  }
  const presets = value.presets.map(normalizePreset);
  if (new Set(presets.map(preset => preset.id)).size !== presets.length) {
    throw new Error("catalog.presets 包含重复的模板标识");
  }
  return { format: PROVIDER_CATALOG_FORMAT, version: PROVIDER_CATALOG_VERSION, updatedAt, presets };
}

function validateCache(value) {
  assertObject(value, "catalog cache");
  assertExactKeys(value, CACHE_KEYS, "catalog cache");
  if (value.format !== PROVIDER_CATALOG_CACHE_FORMAT || value.version !== PROVIDER_CATALOG_CACHE_VERSION) {
    throw new Error("模板目录缓存版本不受支持");
  }
  if (value.url !== PROVIDER_CATALOG_URL) throw new Error("模板目录缓存来源不受信任");
  const fetchedAt = normalizeDate(value.fetchedAt, "catalog cache.fetchedAt");
  const sha256 = requiredString(value.sha256, "catalog cache.sha256", 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("catalog cache.sha256 无效");
  const catalog = validateProviderCatalog(value.catalog);
  if (sha256 !== catalogDigest(catalog)) throw new Error("模板目录缓存完整性校验失败");
  return {
    format: PROVIDER_CATALOG_CACHE_FORMAT,
    version: PROVIDER_CATALOG_CACHE_VERSION,
    url: PROVIDER_CATALOG_URL,
    fetchedAt,
    sha256,
    catalog,
  };
}

function catalogDigest(catalog) {
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex");
}

function loadCache() {
  try {
    if (!existsSync(paths.providerCatalog)) return { cache: null, error: null };
    return { cache: validateCache(readJson(paths.providerCatalog)), error: null };
  } catch {
    // A stale or manually edited cache must never make the desktop dashboard
    // unavailable. It is ignored until the next successful explicit sync.
    return { cache: null, error: "缓存无效，当前使用内置模板" };
  }
}

function mergePresets(remotePresets) {
  const remote = new Map(remotePresets.map(preset => [preset.id, preset]));
  const builtInIds = new Set(PROVIDER_PRESETS.map(preset => preset.id));
  return [
    ...PROVIDER_PRESETS.map(preset => preset.id === "custom" ? preset : remote.get(preset.id) || preset),
    ...remotePresets.filter(preset => !builtInIds.has(preset.id)),
  ];
}

/** Return templates and only non-sensitive cache metadata for the desktop UI. */
export function getProviderCatalog() {
  const { cache, error } = loadCache();
  return {
    presets: mergePresets(cache?.catalog.presets || []),
    status: {
      source: cache ? "remote-cache" : "bundled",
      url: PROVIDER_CATALOG_URL,
      fetchedAt: cache?.fetchedAt || null,
      updatedAt: cache?.catalog.updatedAt || null,
      sha256: cache?.sha256 || null,
      remotePresetCount: cache?.catalog.presets.length || 0,
      error,
    },
  };
}

async function readLimitedResponse(response) {
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > MAX_CATALOG_BYTES) {
    throw new Error("远程模板目录过大，已拒绝下载");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_CATALOG_BYTES) {
      throw new Error("远程模板目录过大，已拒绝下载");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CATALOG_BYTES) {
      await reader.cancel();
      throw new Error("远程模板目录过大，已拒绝下载");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function diffPresets(previous = [], next = []) {
  const before = new Map(previous.map(preset => [preset.id, preset]));
  const after = new Map(next.map(preset => [preset.id, preset]));
  const added = next.filter(preset => !before.has(preset.id)).map(preset => preset.id);
  const removed = previous.filter(preset => !after.has(preset.id)).map(preset => preset.id);
  const updated = next
    .filter(preset => before.has(preset.id) && JSON.stringify(before.get(preset.id)) !== JSON.stringify(preset))
    .map(preset => preset.id);
  return { added, updated, removed };
}

/**
 * Download, validate, and cache the fixed official catalog. Tests can provide
 * a fetch implementation; production callers never supply a user-controlled URL.
 */
export async function syncProviderCatalog({ fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持下载模板目录");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(PROVIDER_CATALOG_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (controller.signal.aborted) throw new Error("下载模板目录超时");
    throw new Error(`下载模板目录失败：${error?.message || String(error)}`);
  }
  if (!response?.ok) {
    clearTimeout(timer);
    throw new Error(`下载模板目录失败：HTTP ${response?.status || "unknown"}`);
  }

  let text;
  try {
    text = await readLimitedResponse(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("下载模板目录超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("远程模板目录不是有效 JSON");
  }
  const catalog = validateProviderCatalog(parsed);
  const previous = loadCache().cache?.catalog.presets || [];
  const fetchedAt = now().toISOString();
  const sha256 = catalogDigest(catalog);
  const cache = {
    format: PROVIDER_CATALOG_CACHE_FORMAT,
    version: PROVIDER_CATALOG_CACHE_VERSION,
    url: PROVIDER_CATALOG_URL,
    fetchedAt,
    sha256,
    catalog,
  };
  writeJson(paths.providerCatalog, cache);
  const changes = diffPresets(previous, catalog.presets);
  return {
    ...getProviderCatalog().status,
    changes,
    presetCount: catalog.presets.length,
  };
}

/** Discard the cache and immediately fall back to the templates shipped in the app. */
export function resetProviderCatalog() {
  if (existsSync(paths.providerCatalog)) {
    backup(paths.providerCatalog);
    rmSync(paths.providerCatalog);
  }
  return getProviderCatalog().status;
}
