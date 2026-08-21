import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PatchPlanSchema } from "@patch/schemas";
import {
  GEMINI_PATCH_PLAN_SCHEMA,
  assertGeminiGenerateContentRequestShape,
  validateGeminiJsonSchema
} from "./schema";

describe("Gemini GenerateContent schema boundary", () => {
  it("accepts the provider-native PATCH plan schema", () => {
    expect(() => validateGeminiJsonSchema(GEMINI_PATCH_PLAN_SCHEMA)).not.toThrow();
  });

  it("rejects unsupported raw Zod JSON Schema keywords before network I/O", () => {
    const raw = z.toJSONSchema(PatchPlanSchema);
    expect(() => validateGeminiJsonSchema(raw)).toThrow(/Unsupported Gemini schema keyword/);
  });

  it("rejects unsupported string constraints before network I/O", () => {
    expect(() => validateGeminiJsonSchema({ type: "string", minLength: 1 })).toThrow(/minLength/);
  });

  it("accepts documented local recursive $ref schemas but rejects external references", () => {
    expect(() => validateGeminiJsonSchema({ type: "array", items: { $ref: "#" } })).not.toThrow();
    expect(() => validateGeminiJsonSchema({ $ref: "https://example.invalid/schema" })).toThrow(/local reference/);
  });

  it("rejects malformed inlineData before network I/O", () => {
    expect(() => assertGeminiGenerateContentRequestShape({
      model: "gemini-3.5-flash",
      schema: GEMINI_PATCH_PLAN_SCHEMA,
      parts: [{ inlineData: { data: "not base64!!", mimeType: "image/png" } }]
    })).toThrow(/base64/);
  });

  it("accepts the SDK GenerateContent text + inlineData Part shape", () => {
    expect(() => assertGeminiGenerateContentRequestShape({
      model: "gemini-3.5-flash",
      schema: GEMINI_PATCH_PLAN_SCHEMA,
      parts: [
        { text: "Plan this PATCH request." },
        { inlineData: { data: "aGVsbG8=", mimeType: "image/png" } }
      ]
    })).not.toThrow();
  });

  it("rejects the old Interactions image shape so it cannot regress", () => {
    expect(() => assertGeminiGenerateContentRequestShape({
      model: "gemini-3.5-flash",
      schema: GEMINI_PATCH_PLAN_SCHEMA,
      parts: [
        { type: "text", text: "Plan this PATCH request." },
        { type: "image", data: "aGVsbG8=", mime_type: "image/png" }
      ]
    })).toThrow(/Part field|Unsupported Gemini/);
  });
});
