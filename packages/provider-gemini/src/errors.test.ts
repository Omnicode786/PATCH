import { describe, expect, it } from "vitest";
import { classifyGeminiError } from "./errors";

describe("Gemini error normalization", () => {
  it("does not confuse an API-key client error with a malformed PATCH request", () => {
    const error = Object.assign(new Error("API key not valid. Please pass a valid API key. API_KEY_INVALID"), { status: 400 });
    expect(classifyGeminiError(error).code).toBe("AI_PROVIDER_AUTH_FAILED");
  });

  it("keeps malformed request failures permanent", () => {
    const error = Object.assign(new Error("Request contains an invalid argument."), { status: 400, error: { code: "invalid_request" } });
    expect(classifyGeminiError(error).code).toBe("AI_PROVIDER_INVALID_REQUEST");
  });

  it("does not treat an echoed API-key field plus INVALID_ARGUMENT as an auth failure", () => {
    const error = Object.assign(
      new Error("Request contains an invalid argument. API key=AIzaTHIS_SHOULD_NEVER_APPEAR"),
      { status: 400, error: { code: "INVALID_ARGUMENT" } }
    );
    expect(classifyGeminiError(error).code).toBe("AI_PROVIDER_INVALID_REQUEST");
  });

  it("normalizes model, rate-limit, timeout, and outage failures separately", () => {
    expect(classifyGeminiError(Object.assign(new Error("model not found"), { status: 404 })).code).toBe("AI_PROVIDER_UNSUPPORTED_MODEL");
    expect(classifyGeminiError(Object.assign(new Error("The requested model is not available for this account"), { status: 400 })).code).toBe("AI_PROVIDER_UNSUPPORTED_MODEL");
    expect(classifyGeminiError(Object.assign(new Error("quota exceeded"), { status: 429 })).code).toBe("AI_PROVIDER_RATE_LIMITED");
    expect(classifyGeminiError(Object.assign(new Error("timed out"), { status: 504 })).code).toBe("AI_PROVIDER_TIMEOUT");
    expect(classifyGeminiError(Object.assign(new Error("server unavailable"), { status: 503 })).code).toBe("AI_PROVIDER_UNAVAILABLE");
  });
  it("redacts credential-like text from safe diagnostic metadata", () => {
    const classified = classifyGeminiError(Object.assign(new Error("Request failed; api key=AIza123456789012345678901234567890"), { status: 400 }));
    expect(classified.details?.providerMessage).toContain("[REDACTED]");
    expect(classified.details?.providerMessage).not.toContain("AIza123456789012345678901234567890");
  });

});
