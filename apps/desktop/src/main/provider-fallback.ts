import { PatchError, type PatchErrorCode } from "@patch/shared";

const transientProviderCodes = new Set<PatchErrorCode>([
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_PROVIDER_NETWORK_ERROR",
  "AI_PROVIDER_TIMEOUT"
]);

export function isTransientProviderFailure(error: unknown): error is PatchError {
  return error instanceof PatchError && transientProviderCodes.has(error.code);
}
