import { describe, expect, it } from "vitest";
import { customModelFormatIsValid } from "./provider-config";

describe("custom provider model configuration", () => {
  it("accepts explicit compatible-shaped model identifiers", () => {
    expect(customModelFormatIsValid("gemini", "gemini-3.6-flash")).toBe(true);
    expect(customModelFormatIsValid("openai", "gpt-5.6")).toBe(true);
    expect(customModelFormatIsValid("openai", "ft:gpt-5.6:project:custom")).toBe(true);
  });

  it("rejects whitespace, empty, or non-Gemini identifiers for Gemini", () => {
    expect(customModelFormatIsValid("gemini", "")).toBe(false);
    expect(customModelFormatIsValid("gemini", "gpt-5.6")).toBe(false);
    expect(customModelFormatIsValid("gemini", "gemini bad model")).toBe(false);
  });
});

it("accepts a compatible unsaved model ID for Test Connection", () => {
  expect(customModelFormatIsValid("gemini", "gemini-3.6-flash-preview-08-2026")).toBe(true);
  expect(customModelFormatIsValid("openai", "gpt-5.6-mini")).toBe(true);
});
