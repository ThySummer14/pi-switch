/**
 * validate.js — reject a models.json that pi would refuse, before writing it.
 *
 * pi validates models.json against a strict TypeBox schema and, on any single
 * failure, loads NO providers at all — one bad field silently takes out the whole
 * file. So the checks here mirror that schema's sharp edges rather than being
 * general-purpose linting. Verified against pi 0.82's core/model-config.js:
 *
 *   - String fields are `minLength: 1`. An empty `apiKey`, `baseUrl`, `api`, model
 *     `id` or model `name` fails the file. (`pi-switch add` with no --key used to
 *     write `apiKey: ""` and take out every provider.)
 *   - `cost` requires all four of input/output/cacheRead/cacheWrite together.
 *   - `contextWindow` / `maxTokens` must be numbers, not numeric strings.
 *   - `input` accepts only "text" and "image".
 *   - Unknown keys ARE allowed, so we don't reject on those.
 */

import { API_TYPES } from "./api-types.js";

/** Cost keys pi requires as a set: partial cost objects fail the schema. */
const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"];
const INPUT_MODALITIES = ["text", "image"];
const CAPABILITY_CONFIDENCES = ["confirmed", "inferred", "unknown"];

class ValidationError extends Error {}

/** Fail with a message naming the field path, the way pi's own error does. */
function fail(path, message) {
  throw new ValidationError(`${path}: ${message}`);
}

/** A string field pi declares as minLength 1 — present but empty breaks the file. */
function checkOptionalString(value, path) {
  if (value === undefined) return;
  if (typeof value !== "string") fail(path, "must be a string");
  if (value === "") {
    fail(path, "must not be empty — pi rejects the whole models.json, loading zero providers");
  }
}

function checkOptionalNumber(value, path) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, `must be a number, not ${typeof value === "string" ? `the string "${value}"` : typeof value}`);
  }
}

/** Validate one model definition. */
export function validateModel(model, path = "model") {
  if (!model || typeof model !== "object") fail(path, "must be an object");
  if (typeof model.id !== "string" || model.id === "") fail(`${path}.id`, "is required and must be a non-empty string");
  checkOptionalString(model.name, `${path}.name`);
  checkOptionalString(model.api, `${path}.api`);
  checkOptionalString(model.baseUrl, `${path}.baseUrl`);
  checkOptionalNumber(model.contextWindow, `${path}.contextWindow`);
  checkOptionalNumber(model.maxTokens, `${path}.maxTokens`);

  if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") {
    fail(`${path}.reasoning`, "must be true or false");
  }
  if (model.input !== undefined) {
    if (!Array.isArray(model.input)) fail(`${path}.input`, "must be an array");
    for (const [i, item] of model.input.entries()) {
      if (!INPUT_MODALITIES.includes(item)) {
        fail(`${path}.input.${i}`, `must be one of ${INPUT_MODALITIES.join(", ")} (got "${item}")`);
      }
    }
  }
  if (model.cost !== undefined) {
    if (!model.cost || typeof model.cost !== "object") fail(`${path}.cost`, "must be an object");
    const missing = COST_KEYS.filter(k => typeof model.cost[k] !== "number");
    if (missing.length > 0) {
      fail(`${path}.cost`, `needs all of ${COST_KEYS.join(", ")} as numbers (missing or non-numeric: ${missing.join(", ")})`);
    }
  }
  if (model.capabilities !== undefined) {
    if (!model.capabilities || typeof model.capabilities !== "object" || Array.isArray(model.capabilities)) {
      fail(`${path}.capabilities`, "must be an object");
    }
    for (const key of ["input", "reasoning", "contextWindow"]) {
      const entry = model.capabilities[key];
      if (entry === undefined) continue;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        fail(`${path}.capabilities.${key}`, "must be an object");
      }
      if (!CAPABILITY_CONFIDENCES.includes(entry.confidence)) {
        fail(`${path}.capabilities.${key}.confidence`, `must be one of ${CAPABILITY_CONFIDENCES.join(", ")}`);
      }
      checkOptionalString(entry.source, `${path}.capabilities.${key}.source`);
    }
  }
  return model;
}

/**
 * Validate one provider entry.
 *
 * `api` is checked against the wire formats pi ships. pi's own schema takes any
 * non-empty string here, but an unrecognised one fails later at request time
 * with a much worse message, so it is rejected up front.
 */
export function validateProvider(name, provider, path = `providers.${name}`) {
  if (!name || typeof name !== "string") fail("provider name", "is required");
  if (name.trim() !== name) {
    fail("provider name", `"${name}" must not start or end with spaces`);
  }
  if (/[^\p{L}\p{N}._ -]/u.test(name)) {
    fail("provider name", `"${name}" may only contain Unicode letters, numbers, spaces, . _ -`);
  }
  if (!provider || typeof provider !== "object") fail(path, "must be an object");

  checkOptionalString(provider.name, `${path}.name`);
  checkOptionalString(provider.baseUrl, `${path}.baseUrl`);
  checkOptionalString(provider.apiKey, `${path}.apiKey`);
  checkOptionalString(provider.api, `${path}.api`);

  if (provider.api !== undefined && !API_TYPES.includes(provider.api)) {
    fail(`${path}.api`, `"${provider.api}" is not an api pi implements (${API_TYPES.join(", ")})`);
  }
  if (provider.authHeader !== undefined && typeof provider.authHeader !== "boolean") {
    fail(`${path}.authHeader`, "must be true or false");
  }
  if (provider.models !== undefined) {
    if (!Array.isArray(provider.models)) fail(`${path}.models`, "must be an array");
    const seen = new Set();
    for (const [i, model] of provider.models.entries()) {
      validateModel(model, `${path}.models.${i}`);
      if (seen.has(model.id)) fail(`${path}.models.${i}.id`, `"${model.id}" is defined twice`);
      seen.add(model.id);
    }
  }
  return provider;
}

/**
 * Validate a whole models.json document. Called immediately before every write,
 * so pi-switch can never be the reason pi fails to start.
 */
export function validateModelsConfig(config) {
  if (!config || typeof config !== "object") fail("models.json", "must be an object");
  if (!config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)) {
    fail("models.json.providers", "must be an object keyed by provider name");
  }
  for (const [name, provider] of Object.entries(config.providers)) {
    validateProvider(name, provider);
  }
  return config;
}

export { ValidationError };
