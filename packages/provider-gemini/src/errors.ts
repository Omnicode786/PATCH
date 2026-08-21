import { PatchError } from "@patch/shared";

const statusFromError = (error: unknown): number | null => {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"] as const) {
    if (key in record) {
      const value = record[key];
      if (typeof value === "number") return value;
    }
  }
  return null;
};

const providerCodeFromError = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  let visited = 0;
  while (queue.length && visited < 64) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    visited += 1;
    const record = value as Record<string, unknown>;
    for (const key of ["reason", "code", "status", "errorCode"] as const) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.length <= 120) return candidate;
    }
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
};

const sanitizeProviderMessage = (value: string): string => value
  .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
  .replace(/(api[_ -]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
  .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 280);

const providerMessageFromError = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return error instanceof Error ? sanitizeProviderMessage(error.message) : null;
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  let visited = 0;
  while (queue.length && visited < 64) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value); visited += 1;
    const record = value as Record<string, unknown>;
    for (const key of ["message", "reason", "status"] as const) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim()) return sanitizeProviderMessage(candidate);
    }
    for (const child of Object.values(record)) if (child && typeof child === "object") queue.push(child);
  }
  return error instanceof Error ? sanitizeProviderMessage(error.message) : null;
};

export function classifyGeminiError(error: unknown): PatchError {
  if (error instanceof PatchError) return error;
  const status = statusFromError(error);
  const providerCode = providerCodeFromError(error);
  const originalMessage = error instanceof Error ? error.message : "Gemini request failed.";
  const lower = originalMessage.toLowerCase();
  const classifierText = `${providerCode ?? ""} ${originalMessage}`;
  const providerMessage = providerMessageFromError(error);
  const details = { provider: "gemini", status, providerCode, providerMessage } as const;

  // Keep credential detection intentionally strict. Provider errors can echo a redacted/API-key
  // field and later mention an unrelated "invalid argument"; a greedy `api key.*invalid`
  // pattern would misclassify that malformed request as an authentication failure.
  const credentialFailure =
    /api[_ -]?key(?:\s+is)?\s*(?:not\s+valid|invalid|expired|missing|revoked)\b/i.test(classifierText) ||
    /\b(?:invalid|expired|missing|revoked)\s+api[_ -]?key\b/i.test(classifierText) ||
    /\bapi[_ -]?key[_ -]?invalid\b/i.test(classifierText) ||
    /\b(?:authentication|unauthenticated)\b/i.test(classifierText);
  if (status === 401 || status === 403 || credentialFailure) {
    return new PatchError("AI_PROVIDER_AUTH_FAILED", "Gemini rejected the API key or its permissions.", details);
  }
  if (/failed[_ ]precondition/i.test(providerCode ?? "") || /billing|failed[_ ]precondition|prerequisite/i.test(originalMessage)) {
    return new PatchError("AI_PROVIDER_INVALID_REQUEST", "Gemini cannot process requests for this project until its account or billing prerequisites are satisfied.", details);
  }
  if (
    status === 404 ||
    /model.+(?:not\s+found|not\s+available|unavailable|unsupported|does\s+not\s+exist)/i.test(originalMessage) ||
    /(?:model[_ ]not[_ ]found|not[_ ]found)/i.test(providerCode ?? "")
  ) {
    return new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", "The selected Gemini model is not available for this account or API interface.", details);
  }
  if (status === 400 || /invalid argument|invalid_request|invalid request|parameter_unknown/i.test(classifierText)) {
    return new PatchError("AI_PROVIDER_INVALID_REQUEST", "Gemini rejected PATCH's provider request as invalid. Check the selected model and PATCH provider diagnostics.", details);
  }
  if (status === 408 || status === 504 || lower.includes("timeout") || lower.includes("timed out")) {
    return new PatchError("AI_PROVIDER_TIMEOUT", "Gemini request timed out.", details);
  }
  if (status === 429 || /rate_limit|quota_exceeded|resource_exhausted/i.test(classifierText)) {
    return new PatchError("AI_PROVIDER_RATE_LIMITED", "Gemini rate limit or quota was reached.", details);
  }
  if (status !== null && status >= 500) return new PatchError("AI_PROVIDER_UNAVAILABLE", "Gemini is temporarily unavailable.", details);
  if (error instanceof TypeError || /fetch failed|network|econn|enotfound|socket/i.test(originalMessage)) {
    return new PatchError("AI_PROVIDER_NETWORK_ERROR", "Could not reach Gemini.", details);
  }
  return new PatchError("AI_PROVIDER_UNAVAILABLE", "Gemini request failed for an unclassified provider reason.", details);
}
