/**
 * Convert provider errors into short, actionable UI guidance.
 * Keep the original error separate: it remains useful for debugging and may
 * contain a request id that support needs.
 */
export function diagnoseProviderError(error) {
  const text = String(error ?? "");
  if (/UnsupportedModel|does not support the agent\s+plan feature/i.test(text)) {
    return {
      code: "unsupported-agent-plan-model",
      title: "当前 Agent Plan 套餐不支持这个模型",
      message: "火山引擎已经收到请求并完成鉴权，但当前套餐不允许使用该模型。Agent Plan Small 不支持 kimi-k3；请升级到 Medium 或更高套餐，或者改用 kimi-k2.6 / kimi-k2.7-code。",
    };
  }
  if (/enable_thinking[\s\S]{0,120}restricted\s+to\s+true/i.test(text)) {
    return {
      code: "thinking-required",
      title: "这个 Qwen 模型必须开启 Thinking",
      message: "服务端拒绝了关闭 Thinking 的请求。Pi Switch 已将 qwen3.8 Max Preview 标记为不可关闭 Thinking；重新启动会话，或先执行 /thinking high（也可以使用 minimal）。",
    };
  }
  if (/Stream ended without finish_reason/i.test(text)) {
    return {
      code: "incomplete-stream",
      title: "服务端返回了不完整的流",
      message: "服务端没有返回完整的结束标记。请确认 Provider 使用服务端支持的 API 格式，或稍后重试。",
    };
  }
  if (/Invalid token|invalid api key|unauthorized|\bHTTP 401\b/i.test(text)) {
    return {
      code: "invalid-credentials",
      title: "API 密钥未被服务端接受",
      message: "请确认密钥属于当前 Provider、没有多余空格，并检查服务端是否已启用对应模型或套餐。",
    };
  }
  return null;
}
