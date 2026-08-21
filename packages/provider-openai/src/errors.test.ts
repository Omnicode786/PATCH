import { describe, expect, it } from "vitest";
import { classifyOpenAIError } from "./errors";

describe("OpenAI error normalization", () => {
  it("separates permanent and transient provider failures", () => {
    expect(classifyOpenAIError(Object.assign(new Error("invalid key"), { status: 401 })).code).toBe("AI_PROVIDER_AUTH_FAILED");
    expect(classifyOpenAIError(Object.assign(new Error("bad request"), { status: 400 })).code).toBe("AI_PROVIDER_INVALID_REQUEST");
    expect(classifyOpenAIError(Object.assign(new Error("model missing"), { status: 404 })).code).toBe("AI_PROVIDER_UNSUPPORTED_MODEL");
    expect(classifyOpenAIError(Object.assign(new Error("rate limit"), { status: 429 })).code).toBe("AI_PROVIDER_RATE_LIMITED");
    expect(classifyOpenAIError(Object.assign(new Error("server unavailable"), { status: 503 })).code).toBe("AI_PROVIDER_UNAVAILABLE");
  });
});
