/**
 * Model capability inference and provenance.
 *
 * Pi's model schema intentionally uses booleans and a non-empty input array,
 * so an unknown capability still needs a runtime value.  The `capabilities`
 * metadata below keeps that value from being mistaken for a verified claim:
 * unknown image support fails open to text+image, unknown reasoning stays
 * disabled, and an unknown context window uses a marked 200k fallback until
 * the user, the upstream, or the model registry provides a value.
 */

export const CAPABILITY_CONFIDENCES = ["confirmed", "inferred", "unknown"];
export const CONTEXT_WINDOW_FALLBACK = 200_000;

const INPUT_MODALITIES = new Set(["text", "image"]);

// These are intentionally narrow.  Everything not in this list fails open for
// image input, matching the safe behavior of current Codex catalog generation.
const CONFIRMED_TEXT_ONLY = [
  /(?:^|[\/_-])(?:embedding|embeddings|embed)(?:$|[\/_-])/i,
  /(?:^|[\/_-])(?:rerank|reranker)(?:$|[\/_-])/i,
  /(?:^|[\/_-])(?:whisper|tts|speech|audio)(?:$|[\/_-])/i,
  /(?:^|[\/_-])(?:moderation|moderations)(?:$|[\/_-])/i,
];

// Exact, confirmed text-only ids mirrored from the upstream capability policy.
// Match the final path segment so namespaced ids such as deepseek/deepseek-v4-pro
// follow the same rule without making every future suffix text-only.
const CONFIRMED_TEXT_ONLY_IDS = new Set([
  "ark-code-latest",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.1",
  "glm-5.2",
  "kat-coder",
  "kat-coder-pro",
  "kat-coder-pro v1",
  "kat-coder-pro v2",
  "kat-coder-pro-v1",
  "kat-coder-pro-v2",
  "ling-2.5-1t",
  "longcat-2.0",
  "longcat-flash-chat",
  "minimax-m2.7",
  "minimax-m2.7-highspeed",
  "mimo-v2.5-pro",
  "qwen3-coder-480b",
  "qwen3-coder-480b-a35b-instruct",
  "qwen3-coder-flash",
  "qwen3-coder-next",
  "qwen3-coder-plus",
  "step-3.5-flash",
  "step-3.5-flash-2603",
  "us.deepseek.r1-v1",
]);

const CONFIRMED_IMAGE_FAMILIES = [
  /(?:^|[\/_-])gpt-4o(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])gpt-5(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])claude-(?:3|4)(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])gemini(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])grok-4(?:\.5)?(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])kimi-k[23](?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])(?:glm-(?:4v|4\.5)|qwen.*-vl|seed.*(?:vision|omni)|mimo)(?:$|[\/.\/_-])/i,
];

// Model families that expose a distinct thinking/reasoning mode.  This list is
// a hint only; a server declaration or a manual edit always wins.
const REASONING_FAMILIES = [
  /(?:^|[\/_-])o[1-9](?:$|[\/_-])/i,
  /(?:^|[\/_-])(?:r1|qwq|reasoner|reasoning|thinking)(?:$|[\/_-])/i,
  /(?:^|[\/_-])qwen3(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])glm-(?:4\.5|5)(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])deepseek-(?:r1|reasoner)(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])kimi-k[23](?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])grok-4(?:\.5)?(?:$|[\/.\/_-])/i,
  /(?:^|[\/_-])(?:mimo|minimax-m[234])(?:$|[\/.\/_-])/i,
];

// Qwen 3.8 Max Preview is thinking-only on the Anthropic-compatible Token
// Plan endpoint. Marking `off` as unavailable makes Pi clamp an inherited
// `off` session to the first supported thinking level instead of sending an
// explicit disabled block that becomes `enable_thinking=false` at the gateway.
const ALWAYS_THINKING_FAMILIES = [
  /(?:^|[\/_-])qwen3\.8(?:$|[\/.\/_-])/i,
];

// Kimi-compatible OpenAI endpoints currently accept `system` but reject the
// newer `developer` role that Pi otherwise uses for reasoning models.
const SYSTEM_ROLE_ONLY_FAMILIES = [
  /(?:^|[\/_-])kimi-k[23](?:$|[\/.\/_-])/i,
];

// Curated values copied from the public provider/model catalogs used by
// CC Switch and OpenCode.  Exact ids win over family guesses so a future
// dated variant does not silently inherit an old model's limit.
const KNOWN_CONTEXT_WINDOWS = new Map([
  ["kimi-k3", 1_048_576],
  ["kimi-k2.7-code", 262_144],
  ["kimi-k2.6", 262_144],
  ["kimi-k2.5", 262_144],
  ["kimi-for-coding", 262_144],
  ["ark-code-latest", 256_000],
  ["doubao-seed-2-1-pro-260628", 262_144],
  ["deepseek-v4-flash", 1_000_000],
  ["deepseek-v4-flash-free", 1_000_000],
  ["deepseek-v4-pro", 1_000_000],
  ["qwen3-coder-plus", 1_048_576],
  ["step-3.7-flash", 262_144],
  ["step-3.5-flash-2603", 262_144],
  ["step-3.5-flash", 262_144],
  ["longcat-2.0", 1_048_576],
  ["minimax-m3", 1_000_000],
  ["minimax-m2.7", 204_800],
  ["mimo-v2.5-pro", 1_048_576],
  ["mimo-v2.5", 1_048_576],
  ["grok-4.5", 500_000],
  ["claude-opus-5", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["global.anthropic.claude-opus-5", 1_000_000],
  ["global.anthropic.claude-sonnet-5", 1_000_000],
  ["nova-pro-v1:0", 300_000],
  ["us.amazon.nova-pro-v1:0", 300_000],
  ["moonshotai/kimi-k2.5", 262_144],
  ["glm-5.1", 204_800],
  ["glm-5.2", 204_800],
  ["qianfan-code-latest", 131_072],
  ["ling-2.6-1t", 262_144],
  ["gpt-5.6-sol", 400_000],
  ["gpt-5.6", 372_000],
  ["gpt-5.6-terra", 372_000],
  ["gpt-5.6-luna", 372_000],
  ["gpt-5.5", 272_000],
  ["gpt-5.3-codex", 400_000],
  ["gpt-5.2", 400_000],
  ["qwen3-coder-480b", 262_144],
  ["qwen3-coder-480b-a35b-instruct", 262_144],
  ["qwen3.6-flash", 1_000_000],
  ["qwen3.6-plus", 1_000_000],
  ["qwen3.7-max", 1_000_000],
  ["qwen3.7-plus", 1_000_000],
  ["qwen3.8-max-preview", 1_000_000],
  ["gemini-2.5-flash-lite", 1_048_576],
  ["gemini-2.5-flash", 1_048_576],
  ["gemini-2.5-pro", 1_048_576],
  ["gemini-3.6-flash", 1_048_576],
]);

const CONTEXT_WINDOW_KEYS = [
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
];

function cleanId(id) {
  return typeof id === "string" ? id.trim() : "";
}

function normalizeInput(value) {
  if (!Array.isArray(value)) return null;
  const input = [...new Set(value.map(item => String(item).trim().toLowerCase()))]
    .filter(item => INPUT_MODALITIES.has(item));
  return input.length > 0 ? input : null;
}

function declaredInput(source) {
  if (!source || typeof source !== "object") return null;
  const vision = source.vision ?? source.supportsVision ?? source.supports_vision ?? source.capabilities?.vision ?? source.capabilities?.supports_vision;
  if (typeof vision === "boolean") return vision ? ["text", "image"] : ["text"];
  return normalizeInput(
    source.input ??
    source.inputModalities ??
    source.input_modalities ??
    source.modalities?.input ??
    source.capabilities?.input ??
    source.capabilities?.input_modalities,
  );
}

function declaredReasoning(source) {
  if (!source || typeof source !== "object") return null;
  const candidates = [
    source.reasoning,
    source.supportsReasoning,
    source.supports_reasoning,
    source.supportsReasoningEffort,
    source.supports_reasoning_effort,
    source.capabilities?.reasoning,
    source.capabilities?.supports_reasoning,
    source.thinking,
    source.supportedReasoningLevels,
    source.supported_reasoning_levels,
  ];
  for (const value of candidates) {
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") {
      if (typeof value.enabled === "boolean") return value.enabled;
      if (typeof value.supported === "boolean") return value.supported;
    }
  }
  return null;
}

function confidenceFor(value, fallback = "unknown") {
  return CAPABILITY_CONFIDENCES.includes(value) ? value : fallback;
}

function knownTextOnly(id) {
  const normalized = normalizeModelId(id);
  const tail = normalized.split("/").pop() || normalized;
  return CONFIRMED_TEXT_ONLY_IDS.has(tail) || CONFIRMED_TEXT_ONLY.some(pattern => pattern.test(normalized));
}

function knownReasoning(id) {
  return REASONING_FAMILIES.some(pattern => pattern.test(normalizeModelId(id)));
}

function knownAlwaysThinking(id) {
  return ALWAYS_THINKING_FAMILIES.some(pattern => pattern.test(normalizeModelId(id)));
}

function knownSystemRoleOnly(id) {
  return SYSTEM_ROLE_ONLY_FAMILIES.some(pattern => pattern.test(normalizeModelId(id)));
}

function knownImage(id) {
  return CONFIRMED_IMAGE_FAMILIES.some(pattern => pattern.test(normalizeModelId(id)));
}

function normalizeModelId(id) {
  return cleanId(id).toLowerCase().replace(/\[[^\]]*\]$/, "");
}

function parseContextWindow(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/,/g, "");
  if (!text) return null;
  const unit = text.match(/^(\d+(?:\.\d+)?)\s*(k|m)$/i);
  const parsed = unit
    ? Number(unit[1]) * (unit[2].toLowerCase() === "m" ? 1_000_000 : 1_000)
    : Number(text);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Read a context limit from the field names used by OpenAI, Google and relays. */
function declaredContextWindow(source) {
  if (!source || typeof source !== "object") return null;
  const roots = [
    source,
    source.limits,
    source.limit,
    source.metadata,
    source.capabilities,
    source.top_provider,
    source.topProvider,
    source.model_info,
    source.modelInfo,
  ].filter(value => value && typeof value === "object");

  for (const root of roots) {
    for (const key of CONTEXT_WINDOW_KEYS) {
      const value = parseContextWindow(root[key]);
      if (value !== null) return value;
    }
    const value = parseContextWindow(root.context);
    if (value !== null) return value;
  }
  return null;
}

function hasOneMillionContextMarker(id) {
  return /\[(?:1m|1million)\]$/i.test(cleanId(id));
}

function knownContextWindow(id) {
  const normalized = normalizeModelId(id);
  if (hasOneMillionContextMarker(id)) {
    return { contextWindow: 1_000_000, source: "model-id-context-marker" };
  }
  const tail = normalized.split("/").pop() || normalized;
  const exact = KNOWN_CONTEXT_WINDOWS.get(tail) ?? KNOWN_CONTEXT_WINDOWS.get(normalized);
  if (exact) return { contextWindow: exact, source: "model-context-registry" };
  return null;
}

/**
 * Infer a model's context window and retain where the number came from.
 * `declared` is normally a provider `/models` row; `source` can be set to
 * `cc-switch-catalog` for imported catalog data or `manual` for a form edit.
 */
export function inferModelContextWindow(id, { declared, source = "server" } = {}) {
  const declaredValue = declaredContextWindow(declared);
  if (declaredValue !== null) {
    const confidence = source === "server" || source === "manual" ? "confirmed" : "inferred";
    return {
      contextWindow: declaredValue,
      contextWindowConfidence: confidence,
      contextWindowSource: source,
      capabilities: { contextWindow: { confidence, source } },
    };
  }

  const known = knownContextWindow(id);
  if (known) {
    return {
      contextWindow: known.contextWindow,
      contextWindowConfidence: "inferred",
      contextWindowSource: known.source,
      capabilities: { contextWindow: { confidence: "inferred", source: known.source } },
    };
  }

  return {
    contextWindow: CONTEXT_WINDOW_FALLBACK,
    contextWindowConfidence: "unknown",
    contextWindowSource: "fallback-200k",
    capabilities: { contextWindow: { confidence: "unknown", source: "fallback-200k" } },
  };
}

/**
 * Infer runtime values plus provenance from a model id and optional upstream
 * metadata.  Explicit upstream values are confirmed; model-name matches are
 * inferred; unknown image support fails open and unknown reasoning stays off.
 */
export function inferModelCapabilities(id, { api, declared } = {}) {
  const modelId = cleanId(id);
  const inputDeclared = declaredInput(declared);
  const reasoningDeclared = declaredReasoning(declared);
  const context = inferModelContextWindow(modelId, { declared });

  let input;
  let inputConfidence;
  let inputSource;
  if (inputDeclared) {
    input = inputDeclared;
    inputConfidence = "confirmed";
    inputSource = "server";
  } else if (knownTextOnly(modelId)) {
    input = ["text"];
    inputConfidence = "inferred";
    inputSource = "known-text-only-registry";
  } else if (knownImage(modelId)) {
    input = ["text", "image"];
    inputConfidence = "inferred";
    inputSource = "model-family-registry";
  } else {
    input = ["text", "image"];
    inputConfidence = "unknown";
    inputSource = "fail-open-unknown";
  }

  let reasoning;
  let reasoningConfidence;
  let reasoningSource;
  if (reasoningDeclared !== null) {
    reasoning = reasoningDeclared;
    reasoningConfidence = "confirmed";
    reasoningSource = "server";
  } else if (knownReasoning(modelId)) {
    reasoning = true;
    reasoningConfidence = "inferred";
    reasoningSource = "model-family-registry";
  } else {
    reasoning = false;
    reasoningConfidence = "unknown";
    reasoningSource = api ? `unknown-for-${api}` : "unknown";
  }

  return {
    input,
    reasoning,
    contextWindow: context.contextWindow,
    contextWindowConfidence: context.contextWindowConfidence,
    contextWindowSource: context.contextWindowSource,
    capabilities: {
      contextWindow: context.capabilities.contextWindow,
      input: { confidence: inputConfidence, source: inputSource },
      reasoning: { confidence: reasoningConfidence, source: reasoningSource },
    },
  };
}

/**
 * Return transport hints for model/protocol combinations with a stricter
 * thinking contract than Pi's generic defaults. Explicit model metadata still
 * wins when these hints are merged by the CRUD layer.
 */
export function inferModelTransport(id, { api } = {}) {
  if ((api === "openai-completions" || api === "openai-responses") && knownSystemRoleOnly(id)) {
    return { compat: { supportsDeveloperRole: false } };
  }
  if (api === "anthropic-messages" && knownAlwaysThinking(id)) {
    return { thinkingLevelMap: { off: null } };
  }
  if (api === "openai-completions" && knownAlwaysThinking(id)) {
    return {
      thinkingLevelMap: { minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null },
      compat: {
        thinkingFormat: "qwen",
        supportsDeveloperRole: false,
        supportsStore: false,
        supportsReasoningEffort: true,
      },
    };
  }
  return {};
}

/**
 * Import a Codex model mapping without treating a generated catalog as a
 * server capability contract. Older CC Switch catalogs commonly copied a
 * template's `input_modalities: ["text"]` and reasoning fields to every row.
 * Image hints are useful when present, but a text-only hint is ignored so
 * unknown models keep the fail-open image default. Parser/template reasoning
 * fields (`supported_reasoning_levels`, `default_reasoning_level`, and
 * `supports_reasoning_summaries`) are intentionally ignored here.
 */
export function inferCcSwitchCatalogCapabilities(id, { api, catalog } = {}) {
  const inferred = inferModelCapabilities(id, { api });
  const context = inferModelContextWindow(id, { declared: catalog, source: "cc-switch-catalog" });
  const source = catalog && typeof catalog === "object" ? catalog : {};
  const inputHint = declaredInput(source);
  if (inputHint?.includes("image")) {
    inferred.input = ["text", "image"];
    inferred.capabilities.input = { confidence: "inferred", source: "cc-switch-catalog" };
  }

  const explicitReasoning = [
    source.reasoning,
    source.supportsReasoning,
    source.supports_reasoning,
    source.capabilities?.reasoning,
    source.capabilities?.supports_reasoning,
  ].find(value => typeof value === "boolean");
  // A catalog's false is often a copied template default. Keep the safer
  // family inference/unknown state; a true hint remains useful but unlocked.
  if (explicitReasoning === true) {
    inferred.reasoning = true;
    inferred.capabilities.reasoning = { confidence: "inferred", source: "cc-switch-catalog" };
  }
  inferred.contextWindow = context.contextWindow;
  inferred.contextWindowConfidence = context.contextWindowConfidence;
  inferred.contextWindowSource = context.contextWindowSource;
  inferred.capabilities.contextWindow = context.capabilities.contextWindow;
  return inferred;
}

/** Build a new Pi model with safe defaults and capability provenance. */
export function createModelDefaults(id, providerName, options = {}) {
  const inferred = inferModelCapabilities(id, {
    api: options.api,
    declared: options.capabilitySource ?? options,
  });
  const contextSource = options.contextSource ?? options.capabilitySource;
  const contextSourceType = options.contextSourceType ?? (options.contextWindow !== undefined ? "manual" : "server");
  const inferredContext = inferModelContextWindow(id, {
    declared: options.contextWindow !== undefined ? options : contextSource,
    source: contextSourceType,
  });
  const {
    api: _api,
    capabilitySource: _capabilitySource,
    contextSource: _contextSource,
    contextSourceType: _contextSourceType,
    contextWindow: explicitContextWindow,
    input: explicitInput,
    reasoning: explicitReasoning,
    capabilities: explicitCapabilities,
    ...rest
  } = options;
  const hasExplicitInput = explicitInput !== undefined;
  const hasExplicitReasoning = explicitReasoning !== undefined;
  const hasExplicitContext = parseContextWindow(explicitContextWindow) !== null;
  const contextWindow = hasExplicitContext ? parseContextWindow(explicitContextWindow) : inferredContext.contextWindow;
  const transport = inferModelTransport(id, { api: options.api });
  return {
    id,
    name: `${id} (${providerName})`,
    contextWindow,
    maxTokens: 32_768,
    input: hasExplicitInput ? normalizeInput(explicitInput) ?? inferred.input : inferred.input,
    reasoning: hasExplicitReasoning ? Boolean(explicitReasoning) : inferred.reasoning,
    capabilities: explicitCapabilities && typeof explicitCapabilities === "object"
      ? explicitCapabilities
      : {
          contextWindow: hasExplicitContext
            ? { confidence: "confirmed", source: "manual" }
            : inferredContext.capabilities.contextWindow,
          input: hasExplicitInput
            ? { confidence: "confirmed", source: "manual" }
            : inferred.capabilities.input,
          reasoning: hasExplicitReasoning
            ? { confidence: "confirmed", source: "manual" }
            : inferred.capabilities.reasoning,
        },
    ...(transport.thinkingLevelMap ? { thinkingLevelMap: transport.thinkingLevelMap } : {}),
    ...(transport.compat ? { compat: transport.compat } : {}),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...rest,
  };
}

/**
 * Mark a model's explicitly edited fields as manual without touching unrelated
 * capability evidence. Used by the CRUD layer when a user changes a checkbox.
 */
export function markManualCapabilities(model, patch = {}) {
  const capabilities = model.capabilities && typeof model.capabilities === "object"
    ? structuredClone(model.capabilities)
    : {};
  if (Object.prototype.hasOwnProperty.call(patch, "input")) {
    capabilities.input = { confidence: "confirmed", source: "manual" };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "reasoning")) {
    capabilities.reasoning = { confidence: "confirmed", source: "manual" };
  }
  if (Object.prototype.hasOwnProperty.call(patch, "contextWindow")) {
    capabilities.contextWindow = { confidence: "confirmed", source: "manual" };
  }
  return Object.keys(capabilities).length > 0 ? capabilities : undefined;
}

/** Return a normalized display state without mutating the model. */
export function inspectModelCapabilities(model) {
  const capabilities = model?.capabilities && typeof model.capabilities === "object"
    ? model.capabilities
    : {};
  const input = normalizeInput(model?.input) ?? ["text"];
  const reasoning = Boolean(model?.reasoning);
  const declaredContext = parseContextWindow(model?.contextWindow);
  const inferredContext = inferModelContextWindow(model?.id);
  const contextWindow = declaredContext ?? CONTEXT_WINDOW_FALLBACK;
  const contextConfidence = capabilities.contextWindow?.confidence ?? (
    declaredContext !== null && inferredContext.contextWindowConfidence === "inferred" &&
    declaredContext === inferredContext.contextWindow
      ? "inferred"
      : "unknown"
  );
  const contextSource = capabilities.contextWindow?.source ?? (
    contextConfidence === "inferred" ? inferredContext.contextWindowSource : "fallback-200k"
  );
  return {
    input,
    reasoning,
    inputConfidence: confidenceFor(capabilities.input?.confidence),
    reasoningConfidence: confidenceFor(capabilities.reasoning?.confidence),
    inputSource: capabilities.input?.source,
    reasoningSource: capabilities.reasoning?.source,
    contextWindow,
    contextWindowConfidence: confidenceFor(contextConfidence),
    contextWindowSource: contextSource,
    needsReview: confidenceFor(capabilities.input?.confidence) === "unknown" ||
      confidenceFor(capabilities.reasoning?.confidence) === "unknown" ||
      confidenceFor(capabilities.contextWindow?.confidence) === "unknown",
  };
}

export function modelCapabilitySummary(model) {
  const inspected = inspectModelCapabilities(model);
  return {
    ...inspected,
    inputLabel: inspected.input.join(", "),
    reasoningLabel: inspected.reasoning ? "on" : "off",
    contextWindowLabel: inspected.contextWindowConfidence === "unknown"
      ? `${inspected.contextWindow} (fallback)`
      : String(inspected.contextWindow),
  };
}
