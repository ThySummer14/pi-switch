/**
 * Small, credential-free Provider templates for the desktop form.
 *
 * These values are defaults, not a remote catalog: users can edit every field
 * before saving and the template never contains an API key.
 */
export const PROVIDER_PRESETS = [
  {
    id: "custom",
    label: "自定义 Provider",
    description: "手动填写服务端点、API 格式和模型。",
    name: "",
    baseUrl: "",
    api: "openai-completions",
    model: "",
  },
  {
    id: "openai",
    label: "OpenAI",
    description: "官方 OpenAI Responses API。",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    api: "openai-responses",
    model: "gpt-5",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "官方 Anthropic Messages API。",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
    api: "anthropic-messages",
    model: "claude-sonnet-4-5",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek OpenAI-compatible API。",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    api: "openai-completions",
    model: "deepseek-chat",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "聚合多家模型的 OpenAI-compatible API；模型 ID 可按账户权限替换。",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    model: "openai/gpt-4o-mini",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    description: "SiliconFlow OpenAI-compatible API；模型 ID 可按控制台可用列表替换。",
    name: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    api: "openai-completions",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    description: "Moonshot OpenAI-compatible API。",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "openai-completions",
    model: "moonshot-v1-8k",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    description: "智谱开放平台 OpenAI-compatible API。",
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "openai-completions",
    model: "glm-4.5",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Google Gemini 原生 API；API key 会按 Google 方式发送。",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    model: "gemini-2.5-flash",
  },
  {
    id: "volcengine-agent-plan",
    label: "火山方舟 Agent Plan",
    description: "OpenAI Responses 入口；kimi-k3 需要 Medium 或更高套餐。",
    name: "火山引擎",
    baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    api: "openai-responses",
    model: "kimi-k2.6",
  },
];

export function getProviderPreset(id) {
  return PROVIDER_PRESETS.find(preset => preset.id === id) || PROVIDER_PRESETS[0];
}
