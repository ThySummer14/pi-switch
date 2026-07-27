/**
 * api-types.js — the wire formats pi implements, as of 0.82.
 *
 * Taken from pi-ai's legacy-api-aliases.js, which imports one module per api;
 * `api:` in models.json must name one of these or requests fail at send time.
 * Kept in its own module so validate.js and providers.js can share it without a
 * circular import.
 */
export const API_TYPES = [
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
];
