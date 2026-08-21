import { describe, expect, it } from "vitest";
import { PatchError } from "@patch/shared";
import { isTransientProviderFailure } from "./provider-fallback";

describe("provider fallback policy", () => {
  it("allows fallback only for transient provider failures", () => {
    for (const code of ["AI_PROVIDER_RATE_LIMITED", "AI_PROVIDER_UNAVAILABLE", "AI_PROVIDER_NETWORK_ERROR", "AI_PROVIDER_TIMEOUT"] as const) {
      expect(isTransientProviderFailure(new PatchError(code, "transient"))).toBe(true);
    }
  });

  it("never hides malformed requests, auth, models, or capability bugs", () => {
    for (const code of ["AI_PROVIDER_INVALID_REQUEST", "AI_PROVIDER_AUTH_FAILED", "AI_PROVIDER_UNSUPPORTED_MODEL", "AI_PROVIDER_UNSUPPORTED_CAPABILITY"] as const) {
      expect(isTransientProviderFailure(new PatchError(code, "permanent"))).toBe(false);
    }
  });
});
