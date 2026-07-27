import { invoke } from "@tauri-apps/api/core";

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
        { id: "claude-opus-5", contextWindow: 200000, maxTokens: 32768, reasoning: true, input: ["text", "image"] },
        { id: "claude-sonnet-5", contextWindow: 200000, maxTokens: 32768, reasoning: true, input: ["text", "image"] },
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
        { id: "deepseek-chat", contextWindow: 128000, maxTokens: 8192, reasoning: false, input: ["text"] },
        { id: "deepseek-reasoner", contextWindow: 128000, maxTokens: 8192, reasoning: true, input: ["text"] },
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
      modelObjects: [{ id: "doubao-seed-code", contextWindow: 256000, maxTokens: 32768, reasoning: true, input: ["text", "image"] }],
      isDefault: false,
    },
  ],
  settings: { defaultProvider: "botcf", defaultModel: "claude-opus-5", defaultThinkingLevel: "high" },
  mcp: [
    { name: "context7", command: "npx -y @upstash/context7-mcp", lifecycle: "eager", disabled: false, effectiveLayer: "shared-global", definedIn: ["shared-global"] },
    { name: "chrome-devtools", command: "npx chrome-devtools-mcp", lifecycle: "lazy", disabled: false, effectiveLayer: "shared-global", definedIn: ["shared-global"] },
    { name: "exa", command: "npx exa-mcp-server", lifecycle: "eager", disabled: true, effectiveLayer: "pi-global", definedIn: ["shared-global", "pi-global"] },
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
  apiTypes: ["anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai"],
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  ccSwitchAvailable: true,
};

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);

export async function callBridge(action, payload = {}) {
  if (isTauri()) return invoke("bridge", { action, payload });
  await new Promise(resolve => setTimeout(resolve, action === "dashboard" ? 350 : 500));
  if (action === "dashboard") return structuredClone(mockDashboard);
  if (action === "doctor") {
    return [
      { level: "ok", area: "profiles", message: "3 startup profiles valid" },
      { level: "warn", area: "mcp", message: "exa references EXA_API_KEY, which is unset" },
    ];
  }
  if (action === "testProvider") {
    return { ok: true, ms: 284, models: ["claude-opus-5", "claude-sonnet-5"], diff: { missing: [], aliased: [], extra: [], unknown: false } };
  }
  if (action === "syncProvider") {
    return { ok: true, models: [], diff: { missing: [], aliased: [], extra: ["claude-haiku-5"], unknown: false } };
  }
  if (action === "importPreview") {
    return { importable: [{ sourceName: "Claude Relay", appType: "claude", targetName: "claude-relay" }], skipped: [] };
  }
  return true;
}
