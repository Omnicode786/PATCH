import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIContextRequest } from "@patch/ai-core";

const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  list: vi.fn()
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    readonly models = {
      generateContent: sdk.generateContent,
      list: sdk.list
    };
  }
}));

import { GeminiProvider } from "./index";

const safePixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const request: AIContextRequest = {
  model: "gemini-3.5-flash",
  prompt: "What is visible?",
  context: {
    annotations: [],
    activeApplication: { processName: "test.exe", windowTitle: "Test" },
    fullScreenImage: {
      mimeType: "image/png",
      dataBase64: safePixel,
      width: 1,
      height: 1,
      scaleFactor: 1
    }
  }
};

const contextResponse = JSON.stringify({
  answer: "A test pixel.",
  observed: ["A one-pixel test image is present."],
  inferred: [],
  unknown: []
});

beforeEach(() => {
  sdk.generateContent.mockReset();
  sdk.list.mockReset();
  sdk.list.mockResolvedValue({
    async *[Symbol.asyncIterator]() {
      yield {
        name: "models/gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        supportedActions: ["generateContent"]
      };
    }
  });
  sdk.generateContent.mockResolvedValue({ text: contextResponse });
});

describe("GeminiProvider production transport", () => {
  it("uses GenerateContent inlineData rather than an Interactions image Step", async () => {
    const provider = new GeminiProvider("test-api-key-1234567890");
    await provider.analyzeContext(request);

    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    const sent = sdk.generateContent.mock.calls[0]?.[0] as unknown as {
      model: string;
      contents: unknown[];
      config: Record<string, unknown>;
    };
    expect(sent.model).toBe("gemini-3.5-flash");
    expect(sent.contents).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.any(String) }),
      expect.objectContaining({ inlineData: { data: safePixel, mimeType: "image/png" } })
    ]));
    expect(sent.contents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image" })
    ]));
    expect(sent.config.responseMimeType).toBe("application/json");
    expect(sent.config.responseJsonSchema).toBeDefined();
  });

  it("resolves an unavailable saved model before sending user content", async () => {
    const provider = new GeminiProvider("test-api-key-1234567890");
    await provider.analyzeContext({ ...request, model: "gemini-does-not-exist" });

    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
    expect(sdk.generateContent.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ model: "gemini-3.5-flash" }));
  });

  it("retries one different discovered model after a provider-side generic 400", async () => {
    sdk.list.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedActions: ["generateContent"] };
        yield { name: "models/gemini-3.6-flash", displayName: "Gemini 3.6 Flash", supportedActions: ["generateContent"] };
      }
    });
    sdk.generateContent
      // First model: schema request and its schema-less compatibility retry both fail.
      .mockRejectedValueOnce(Object.assign(new Error("Request contains an invalid argument."), { status: 400 }))
      .mockRejectedValueOnce(Object.assign(new Error("Request contains an invalid argument."), { status: 400 }))
      .mockResolvedValueOnce({ text: contextResponse });

    const provider = new GeminiProvider("test-api-key-1234567890");
    const result = await provider.analyzeContext(request);

    expect(result.answer).toBe("A test pixel.");
    expect(sdk.generateContent).toHaveBeenCalledTimes(3);
    expect(sdk.generateContent.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ model: "gemini-3.6-flash" }));
  });
  it("uses prompt-carried JSON schema for the complex action plan while keeping local validation", async () => {
    const validPlan = JSON.stringify({
      version: "1",
      requestClass: "QUESTION",
      interpretation: { goal: "Answer", confidence: 0.99 },
      evidence: { observed: [], inferred: [], unknown: [] },
      requiresConfirmation: false,
      actions: [],
      expectedOutcome: "Answer without action"
    });
    sdk.generateContent.mockResolvedValueOnce({ text: validPlan });
    const provider = new GeminiProvider("test-api-key-1234567890");
    await provider.planActions({ ...request, availableTools: [] });

    const sent = sdk.generateContent.mock.calls[0]?.[0] as unknown as { contents: Array<{ text?: string }>; config: Record<string, unknown> };
    expect(sent.config.responseMimeType).toBe("application/json");
    expect(sent.config.responseJsonSchema).toBeUndefined();
    expect(sent.contents.find((part) => typeof part.text === "string")?.text).toContain("Return JSON only. It must satisfy this JSON Schema exactly");
  });

});
