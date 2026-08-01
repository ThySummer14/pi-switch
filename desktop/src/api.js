import { invoke } from "@tauri-apps/api/core";
import { PROVIDER_PRESETS } from "../../src/provider-presets.js";

const mockDashboard = {
  providers: [
    {
      name: "botcf",
      api: "anthropic-messages",
      baseUrl: "https://api.botcf.example/v1",
      keyOk: true,
      keySource: "cmd:security",
      keyInline: false,
      models: ["claude-opus-5", "claude-sonnet-5"],
      modelObjects: [
        { id: "claude-opus-5", contextWindow: 1000000, maxTokens: 32768, reasoning: true, input: ["text", "image"], capabilities: { contextWindow: { confidence: "inferred", source: "model-context-registry" }, input: { confidence: "inferred", source: "model-family-registry" }, reasoning: { confidence: "inferred", source: "model-family-registry" } }, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }, source: "Anthropic" },
        { id: "claude-sonnet-5", contextWindow: 1000000, maxTokens: 32768, reasoning: true, input: ["text", "image"], capabilities: { contextWindow: { confidence: "inferred", source: "model-context-registry" }, input: { confidence: "inferred", source: "model-family-registry" }, reasoning: { confidence: "inferred", source: "model-family-registry" } }, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, source: "Anthropic" },
      ],
      isDefault: true,
      defaultModel: "claude-opus-5",
    },
    {
      name: "deepseek",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com",
      keyOk: true,
      keySource: "env:DEEPSEEK_API_KEY",
      keyInline: false,
      models: ["deepseek-chat", "deepseek-reasoner"],
      modelObjects: [
        { id: "deepseek-chat", contextWindow: 128000, maxTokens: 8192, reasoning: false, input: ["text"], capabilities: { contextWindow: { confidence: "confirmed", source: "demo" }, input: { confidence: "inferred", source: "known-text-only-registry" }, reasoning: { confidence: "confirmed", source: "demo" } }, cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 }, source: "DeepSeek" },
        { id: "deepseek-reasoner", contextWindow: 128000, maxTokens: 8192, reasoning: true, input: ["text"], capabilities: { contextWindow: { confidence: "confirmed", source: "demo" }, input: { confidence: "inferred", source: "known-text-only-registry" }, reasoning: { confidence: "inferred", source: "model-family-registry" } }, cost: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 }, source: "DeepSeek" },
      ],
      isDefault: false,
    },
    {
      name: "ark",
      api: "openai-responses",
      baseUrl: "https://ark.example/api/v3",
      keyOk: false,
      keyError: "ARK_API_KEY is not set",
      keyInline: false,
      models: ["doubao-seed-code"],
      modelObjects: [{ id: "doubao-seed-code", contextWindow: 256000, maxTokens: 32768, reasoning: true, input: ["text", "image"], capabilities: { contextWindow: { confidence: "inferred", source: "model-context-registry" }, input: { confidence: "inferred", source: "model-family-registry" }, reasoning: { confidence: "inferred", source: "model-family-registry" } }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, source: "火山方舟" }],
      isDefault: false,
    },
  ],
  settings: { defaultProvider: "botcf", defaultModel: "claude-opus-5", defaultThinkingLevel: "high" },
  mcp: [
    { name: "context7", command: "npx -y @upstash/context7-mcp", commandName: "npx", args: ["-y", "@upstash/context7-mcp"], envKeys: [], lifecycle: "eager", disabled: false, effectiveLayer: "shared-global", definedIn: ["shared-global"], canEdit: true, canDelete: false },
    { name: "chrome-devtools", command: "npx chrome-devtools-mcp", commandName: "npx", args: ["chrome-devtools-mcp"], envKeys: [], lifecycle: "lazy", disabled: false, effectiveLayer: "shared-global", definedIn: ["shared-global"], canEdit: true, canDelete: false },
    { name: "exa", command: "npx exa-mcp-server", commandName: "npx", args: ["exa-mcp-server"], envKeys: ["EXA_API_KEY"], lifecycle: "eager", disabled: true, effectiveLayer: "pi-global", definedIn: ["shared-global", "pi-global"], canEdit: true, canDelete: true },
  ],
  skillPaths: [
    { entry: "~/.pi/agent/skills", resolved: "/Users/demo/.pi/agent/skills", exists: true, kind: "dir", count: 24, names: ["browser", "review"] },
    { entry: "~/.agents/skills", resolved: "/Users/demo/.agents/skills", exists: true, kind: "dir", count: 14, names: ["agent-reach"] },
  ],
  skillCatalog: Array.from({ length: 38 }, (_, index) => ({ name: `skill-${index + 1}`, description: "Local Pi capability", from: "~/.pi/agent/skills" })),
  agents: [
    { name: "architect", displayName: "Architect", description: "Plans implementation and system structure.", enabled: true, source: "global", model: "inherit", thinking: "high", problems: [] },
    { name: "code-reviewer", displayName: "Code Reviewer", description: "Reviews changes for correctness and regressions.", enabled: true, source: "global", model: "inherit", thinking: "high", problems: [] },
    { name: "researcher", displayName: "Researcher", description: "Finds and verifies external technical information.", enabled: true, source: "global", model: "inherit", thinking: "medium", problems: [{ level: "warn", message: "description is short" }] },
  ],
  profiles: [
    { name: "code", label: "Code", mode: "code", cwd: "/Users/demo/projects", fixedCwd: false, exists: true, isDefault: true },
    { name: "novel", label: "Novel Studio", mode: "novel", cwd: "/Users/demo/novels", fixedCwd: true, exists: true, isDefault: false },
    { name: "obsidian", label: "Obsidian", mode: "obsidian", cwd: "/Users/demo/vault", fixedCwd: true, exists: true, isDefault: false },
  ],
  workspaceCwd: "/Users/demo/projects",
  apiTypes: ["anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai"],
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  providerPresets: PROVIDER_PRESETS,
  providerCatalog: {
    source: "bundled",
    url: "https://raw.githubusercontent.com/ThySummer14/pi-switch/main/catalog/provider-presets.json",
    fetchedAt: null,
    updatedAt: null,
    sha256: null,
    remotePresetCount: 0,
    error: null,
  },
  keychainAvailable: true,
  ccSwitchAvailable: true,
};

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

export async function callBridge(action, payload = {}) {
  if (isTauri()) return invoke("bridge", { action, payload });
  await new Promise(resolve => setTimeout(resolve, action === "dashboard" ? 350 : 500));
  if (action === "dashboard") return structuredClone(mockDashboard);
  if (action === "exportConfig") {
    return {
      format: "pi-switch-config",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: structuredClone(mockDashboard.settings),
      providers: mockDashboard.providers.map(provider => ({
        name: provider.name,
        api: provider.api,
        baseUrl: provider.baseUrl,
        models: structuredClone(provider.modelObjects),
        keyConfigured: provider.keyOk,
        keyStorage: provider.keySource?.startsWith("cmd:") ? "command" : provider.keySource?.startsWith("env:") ? "environment" : "inline",
      })),
    };
  }
  if (action === "previewRestore") {
    const providers = payload?.config?.providers || [];
    return { providersAdded: providers.length, providersUpdated: 0, modelsImported: providers.reduce((total, provider) => total + (provider.models?.length || 0), 0), keysPreserved: 0, warnings: [] };
  }
  if (action === "restoreConfig") return { providersAdded: 0, providersUpdated: 1, modelsImported: 0, keysPreserved: 1, warnings: [] };
  if (action === "doctor") {
    const findings = [
      { level: "ok", area: "profiles", message: "3 startup profiles valid" },
      { level: "warn", area: "mcp", message: "exa references EXA_API_KEY, which is unset" },
    ];
    return payload.probe ? [...findings, { level: "ok", area: "reach", message: "botcf: reachable in 284ms, 2 models listed" }] : findings;
  }
  if (action === "testProvider") {
    return { ok: true, ms: 284, model: "claude-opus-5" };
  }
  if (action === "readProviderKey") {
    return { key: "demo-key-not-a-secret" };
  }
  if (action === "syncProvider") {
    return {
      ok: true,
      models: [],
      diff: { missing: [], aliased: [], extra: ["claude-haiku-5"], unknown: false },
      capabilityUpdates: [{ id: "claude-opus-5", fields: ["input evidence", "reasoning evidence"] }],
      capabilityRefresh: { changed: ["claude-opus-5"] },
    };
  }
  if (action === "syncProviderCatalog") {
    const fetchedAt = new Date().toISOString();
    mockDashboard.providerCatalog = {
      ...mockDashboard.providerCatalog,
      source: "remote-cache",
      fetchedAt,
      updatedAt: "2026-08-01T00:00:00.000Z",
      sha256: "1".repeat(64),
      remotePresetCount: PROVIDER_PRESETS.length - 1,
      error: null,
    };
    return {
      ...structuredClone(mockDashboard.providerCatalog),
      presetCount: PROVIDER_PRESETS.length - 1,
      changes: { added: ["openai", "anthropic"], updated: [], removed: [] },
    };
  }
  if (action === "resetProviderCatalog") {
    mockDashboard.providerCatalog = {
      ...mockDashboard.providerCatalog,
      source: "bundled",
      fetchedAt: null,
      updatedAt: null,
      sha256: null,
      remotePresetCount: 0,
      error: null,
    };
    return structuredClone(mockDashboard.providerCatalog);
  }
  if (action === "batchUpdateModels") {
    return { provider: payload.provider, updated: payload.ids || [], fields: Object.keys(payload.patch || {}) };
  }
  if (action === "importPreview") {
    return { importable: [{ sourceName: "Claude Relay", appType: "claude", targetName: "claude-relay" }], skipped: [] };
  }
  return true;
}
