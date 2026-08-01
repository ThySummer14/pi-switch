/**
 * Safe, portable transfer of the Pi provider catalog.
 *
 * Export files intentionally carry provider metadata and model definitions but
 * never carry an apiKey value. Restoring a file keeps the existing key
 * reference for providers with the same name; new providers are imported
 * without a credential and can be keyed separately afterwards.
 */

import { validateModelsConfig } from "./validate.js";

export const CONFIG_EXPORT_FORMAT = "pi-switch-config";
export const CONFIG_EXPORT_VERSION = 1;

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function keyStorageKind(spec) {
  if (typeof spec !== "string" || !spec) return "missing";
  if (spec.startsWith("!")) return "command";
  if (spec.startsWith("$")) return "environment";
  return "inline";
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const SENSITIVE_KEYS = new Set(["apiKey", "api_key", "token", "authToken", "auth_token", "password", "secret", "authorization", "credentials", "headers"]);

function scrubSensitive(value) {
  if (Array.isArray(value)) return value.map(scrubSensitive);
  if (!value || typeof value !== "object") return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    safe[key] = scrubSensitive(child);
  }
  return safe;
}

function providerForExport(name, provider) {
  const source = structuredClone(provider || {});
  const apiKey = source.apiKey;
  const safe = scrubSensitive(source);
  delete safe.apiKey;
  return {
    name,
    ...safe,
    keyConfigured: typeof apiKey === "string" && apiKey.length > 0,
    keyStorage: keyStorageKind(apiKey),
  };
}

/** Create an export object that is safe to serialize or download. */
export function exportConfig(models, settings, now = new Date()) {
  const providers = Object.entries(models?.providers || {}).map(([name, provider]) => providerForExport(name, provider));
  return {
    format: CONFIG_EXPORT_FORMAT,
    version: CONFIG_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings: {
      defaultProvider: settings?.defaultProvider,
      defaultModel: settings?.defaultModel,
      defaultThinkingLevel: settings?.defaultThinkingLevel,
    },
    providers,
  };
}

function assertEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") throw new Error("配置文件必须是 JSON 对象");
  if (envelope.format !== CONFIG_EXPORT_FORMAT) throw new Error("这不是 Pi Switch 配置导出文件");
  if (envelope.version !== CONFIG_EXPORT_VERSION) throw new Error(`不支持的配置文件版本：${envelope.version}`);
  if (!Array.isArray(envelope.providers)) throw new Error("配置文件缺少 providers 列表");
  for (const [index, row] of envelope.providers.entries()) {
    if (!row || typeof row !== "object") throw new Error(`providers[${index}] 不是对象`);
    if (hasOwn(row, "apiKey") || hasOwn(row, "key") || hasOwn(row, "token")) {
      throw new Error(`providers[${index}] 包含凭据字段；请使用不含密钥的 Pi Switch 导出文件`);
    }
    if (typeof row.name !== "string" || !row.name.trim()) throw new Error(`providers[${index}].name 不能为空`);
  }
}

function providerModelCount(provider) {
  return Array.isArray(provider?.models) ? provider.models.length : 0;
}

/**
 * Validate and merge an export file without writing it.
 * Returns the complete next documents plus a secret-free summary.
 */
export function planRestoreConfig(currentModels, currentSettings, envelope) {
  assertEnvelope(envelope);
  const nextModels = structuredClone(currentModels || { providers: {} });
  if (!nextModels.providers || typeof nextModels.providers !== "object" || Array.isArray(nextModels.providers)) {
    nextModels.providers = {};
  }
  const nextSettings = structuredClone(currentSettings || {});
  const warnings = [];
  let providersAdded = 0;
  let providersUpdated = 0;
  let modelsImported = 0;
  let keysPreserved = 0;

  for (const row of envelope.providers) {
    const name = row.name.trim();
    const existing = nextModels.providers[name];
    const imported = scrubSensitive(row);
    delete imported.name;
    delete imported.keyConfigured;
    delete imported.keyStorage;
    if (existing && hasOwn(existing, "apiKey")) {
      imported.apiKey = existing.apiKey;
      keysPreserved += 1;
    }
    if (existing) providersUpdated += 1;
    else providersAdded += 1;
    modelsImported += providerModelCount(imported);
    nextModels.providers[name] = imported;
  }

  validateModelsConfig(nextModels);

  const requested = envelope.settings || {};
  const provider = nextModels.providers[requested.defaultProvider];
  const modelIds = provider && Array.isArray(provider.models) ? provider.models.map(model => model.id) : [];
  if (requested.defaultProvider && provider && requested.defaultModel && modelIds.includes(requested.defaultModel)) {
    nextSettings.defaultProvider = requested.defaultProvider;
    nextSettings.defaultModel = requested.defaultModel;
  } else if (requested.defaultProvider || requested.defaultModel) {
    warnings.push("导出文件中的默认 Provider/模型不存在，已保留当前默认配置");
  }
  if (requested.defaultThinkingLevel !== undefined) {
    if (THINKING_LEVELS.has(requested.defaultThinkingLevel)) nextSettings.defaultThinkingLevel = requested.defaultThinkingLevel;
    else warnings.push("导出文件中的 Thinking 级别无效，已保留当前值");
  }

  return {
    nextModels,
    nextSettings,
    summary: {
      providersAdded,
      providersUpdated,
      modelsImported,
      keysPreserved,
      warnings,
    },
  };
}
