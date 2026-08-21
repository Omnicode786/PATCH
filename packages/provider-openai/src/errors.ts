import { PatchError } from "@patch/shared";

export function classifyOpenAIError(error: unknown): PatchError {
  if (error instanceof PatchError) return error;
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : null;
  const message = error instanceof Error ? error.message : "OpenAI request failed.";
  if (status === 401 || status === 403) return new PatchError("AI_PROVIDER_AUTH_FAILED", "OpenAI rejected the API key or its permissions.", { provider: "openai", status });
  if (status === 400) return new PatchError("AI_PROVIDER_INVALID_REQUEST", "OpenAI rejected PATCH's provider request as invalid. Check the selected model and PATCH provider diagnostics.", { provider: "openai", status });
  if (status === 404) return new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", "The selected OpenAI model is not available for this account.", { provider: "openai", status });
  if (status === 408 || status === 504 || /timeout|timed out/i.test(message)) return new PatchError("AI_PROVIDER_TIMEOUT", "OpenAI request timed out.", { provider: "openai", status });
  if (status === 429) return new PatchError("AI_PROVIDER_RATE_LIMITED", "OpenAI rate limit reached.", { provider: "openai", status });
  if (status !== null && status >= 500) return new PatchError("AI_PROVIDER_UNAVAILABLE", "OpenAI is temporarily unavailable.", { provider: "openai", status });
  if (/fetch failed|network|econn|enotfound|socket|connection error/i.test(message)) return new PatchError("AI_PROVIDER_NETWORK_ERROR", "Could not reach OpenAI.", { provider: "openai", status });
  return new PatchError("AI_PROVIDER_UNAVAILABLE", "OpenAI request failed for an unclassified provider reason.", { provider: "openai", status });
}
