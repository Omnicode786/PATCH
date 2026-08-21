import type { GoogleGenAI } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { runGeminiDiagnostics } from "./diagnostics";

const validPlan = JSON.stringify({
  version: "1",
  requestClass: "QUESTION",
  interpretation: { goal: "Answer the test question", confidence: 0.99 },
  evidence: { observed: [], inferred: [], unknown: [] },
  requiresConfirmation: false,
  actions: [],
  expectedOutcome: "Answer without computer action"
});

function fakeClient(failGenerationCall?: number): GoogleGenAI {
  let generationCall = 0;
  const outputs = [
    "OK",
    JSON.stringify({ ok: true }),
    "OK",
    "pixel",
    JSON.stringify({ answer: "Test", observed: ["test window"], inferred: [], unknown: [] }),
    validPlan
  ];
  const client = {
    models: {
      list: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield { name: "models/gemini-3.5-flash", supportedActions: ["generateContent"] };
        }
      })),
      generateContent: vi.fn(async () => {
        generationCall += 1;
        if (generationCall === failGenerationCall) {
          throw Object.assign(
            new Error("Request contains an invalid argument. API key=AIzaTHIS_SHOULD_NEVER_APPEAR"),
            { status: 400, error: { code: "INVALID_ARGUMENT" } }
          );
        }
        return { text: outputs[generationCall - 1] };
      })
    }
  };
  return client as unknown as GoogleGenAI;
}

describe("staged Gemini diagnostics", () => {
  it("isolates all seven GenerateContent layers without using user screenshots", async () => {
    const client = fakeClient();
    const report = await runGeminiDiagnostics(client, "gemini-3.5-flash", () => undefined, "GenerateContent", "v1beta");
    expect(report.success).toBe(true);
    expect(report.stages).toHaveLength(7);
    expect(report.failedStage).toBeNull();
    expect(report.lastSuccessfulStage).toBe("planning-schema");

    const calls = vi.mocked(client.models.generateContent).mock.calls;
    for (const callIndex of [3, 4, 5]) {
      const request = calls[callIndex]?.[0] as { contents?: unknown[] };
      const parts = request.contents ?? [];
      expect(parts).toEqual(expect.arrayContaining([
        expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: "image/png" }) })
      ]));
    }
    const planning = calls[5]?.[0] as unknown as { contents?: Array<{ text?: string }>; config?: Record<string, unknown> };
    expect(planning.config?.responseMimeType).toBe("application/json");
    expect(planning.config?.responseJsonSchema).toBeUndefined();
    expect(planning.contents?.find((part) => typeof part.text === "string")?.text).toContain("Return JSON only. It must satisfy this JSON Schema exactly");
  });

  it("stops at the exact failing stage and sanitizes provider details", async () => {
    const report = await runGeminiDiagnostics(fakeClient(2), "gemini-3.5-flash", () => undefined, "GenerateContent", "v1beta");
    expect(report.success).toBe(false);
    expect(report.failedStage).toBe("structured-output");
    expect(report.stages).toHaveLength(3);
    const failure = report.stages.at(-1);
    expect(failure?.errorCode).toBe("AI_PROVIDER_INVALID_REQUEST");
    expect(failure?.reason).not.toContain("AIzaTHIS_SHOULD_NEVER_APPEAR");
  });
});
