import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  PATCH_SYSTEM_POLICY,
  type ProviderDiagnosticReport,
  type ProviderDiagnosticSink,
  type ProviderDiagnosticStage,
  type ProviderDiagnosticStageResult
} from "@patch/ai-core";
import { PatchPlanSchema } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import { classifyGeminiError } from "./errors";
import {
  GEMINI_CONTEXT_ANALYSIS_SCHEMA,
  GEMINI_PATCH_PLAN_SCHEMA,
  assertGeminiGenerateContentRequestShape,
  type GeminiContentPart,
  type GeminiJsonSchema
} from "./schema";

export const GEMINI_SDK_VERSION = "2.17.0";

const ContextDiagnosticSchema = z.object({
  answer: z.string(),
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string())
}).strict();

const tinyStructuredSchema: GeminiJsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
};

// 1x1 PNG fixture. It contains no user content and proves the exact GenerateContent
// inlineData transport used by real PATCH screenshots.
const SAFE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const safeImageParts = (text: string): GeminiContentPart[] => [
  { text },
  { inlineData: { data: SAFE_PIXEL_PNG, mimeType: "image/png" } }
];

const withSchemaInstruction = (parts: readonly GeminiContentPart[], schema: GeminiJsonSchema): GeminiContentPart[] => {
  const instruction = `\n\nReturn JSON only. It must satisfy this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  let applied = false;
  const output = parts.map<GeminiContentPart>((part) => {
    if (!applied && "text" in part) {
      applied = true;
      return { text: `${part.text}${instruction}` };
    }
    return part;
  });
  if (!applied) output.unshift({ text: instruction.trim() });
  return output;
};

const parseJson = (text: string | undefined, stage: string): unknown => {
  if (!text?.trim()) throw new PatchError("VALIDATION_FAILED", `Gemini returned no output during ${stage}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new PatchError("VALIDATION_FAILED", `Gemini returned invalid JSON during ${stage}.`);
  }
};

function stageFailure(stage: ProviderDiagnosticStage, error: unknown, durationMs: number): ProviderDiagnosticStageResult {
  const classified = classifyGeminiError(error);
  const details = classified.details ?? {};
  return {
    stage,
    ok: false,
    durationMs,
    errorCode: classified.code,
    httpStatus: typeof details.status === "number" ? details.status : null,
    providerCode: typeof details.providerCode === "string" ? details.providerCode : null,
    reason: typeof details.providerMessage === "string" ? details.providerMessage : classified.message
  };
}

export async function runGeminiDiagnostics(
  client: GoogleGenAI,
  model: string,
  sink: ProviderDiagnosticSink,
  apiInterface: string,
  apiVersion: string
): Promise<ProviderDiagnosticReport> {
  const diagnosticId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const stages: ProviderDiagnosticStageResult[] = [];
  let lastSuccessfulStage: ProviderDiagnosticStage | null = null;
  let failedStage: ProviderDiagnosticStage | null = null;

  const run = async (stage: ProviderDiagnosticStage, operation: () => Promise<void>): Promise<boolean> => {
    const started = Date.now();
    await sink("info", "patch.provider.diagnostic_stage_start", {
      diagnosticId,
      provider: "gemini",
      model,
      stage,
      apiInterface,
      apiVersion,
      sdkVersion: GEMINI_SDK_VERSION
    });
    try {
      await operation();
      const result: ProviderDiagnosticStageResult = { stage, ok: true, durationMs: Date.now() - started };
      stages.push(result);
      lastSuccessfulStage = stage;
      await sink("info", "patch.provider.diagnostic_stage_success", {
        diagnosticId,
        provider: "gemini",
        model,
        stage,
        durationMs: result.durationMs
      });
      return true;
    } catch (error: unknown) {
      const result = stageFailure(stage, error, Date.now() - started);
      stages.push(result);
      failedStage = stage;
      await sink("error", "patch.provider.diagnostic_stage_failed", {
        diagnosticId,
        provider: "gemini",
        model,
        stage,
        durationMs: result.durationMs,
        errorCode: result.errorCode,
        httpStatus: result.httpStatus ?? null,
        providerCode: result.providerCode ?? null,
        reason: result.reason ?? null
      });
      return false;
    }
  };

  let proceed = await run("authentication", async () => {
    const models = await client.models.list();
    for await (const _ of models) break;
  });

  if (proceed) proceed = await run("text-generation", async () => {
    const response = await client.models.generateContent({
      model,
      contents: "Reply with OK."
    });
    if (!response.text?.trim()) throw new PatchError("VALIDATION_FAILED", "Gemini bare text diagnostic returned no output.");
  });

  if (proceed) proceed = await run("structured-output", async () => {
    const parts: GeminiContentPart[] = [{ text: "Return a JSON object with ok set to true." }];
    assertGeminiGenerateContentRequestShape({ model, schema: tinyStructuredSchema, parts });
    const response = await client.models.generateContent({
      model,
      contents: parts,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: tinyStructuredSchema
      }
    });
    const value = parseJson(response.text, "structured-output");
    if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
      throw new PatchError("VALIDATION_FAILED", "Gemini did not satisfy the tiny structured-output contract.");
    }
  });

  if (proceed) proceed = await run("system-instruction", async () => {
    const response = await client.models.generateContent({
      model,
      contents: "Reply with OK.",
      config: { systemInstruction: PATCH_SYSTEM_POLICY }
    });
    if (!response.text?.trim()) throw new PatchError("VALIDATION_FAILED", "Gemini system-instruction diagnostic returned no output.");
  });

  if (proceed) proceed = await run("multimodal", async () => {
    const parts = safeImageParts("Describe this safe one-pixel test image in one word.");
    assertGeminiGenerateContentRequestShape({ model, parts });
    const response = await client.models.generateContent({
      model,
      contents: parts
    });
    if (!response.text?.trim()) throw new PatchError("VALIDATION_FAILED", "Gemini multimodal diagnostic returned no output.");
  });

  if (proceed) proceed = await run("context-schema", async () => {
    const parts = safeImageParts("Analyze this safe test image as a test window. Return a concise answer with observed, inferred, and unknown facts.");
    assertGeminiGenerateContentRequestShape({ model, schema: GEMINI_CONTEXT_ANALYSIS_SCHEMA, parts });
    const response = await client.models.generateContent({
      model,
      contents: parts,
      config: {
        systemInstruction: PATCH_SYSTEM_POLICY,
        responseMimeType: "application/json",
        responseJsonSchema: GEMINI_CONTEXT_ANALYSIS_SCHEMA
      }
    });
    ContextDiagnosticSchema.parse(parseJson(response.text, "context-schema"));
  });

  if (proceed) await run("planning-schema", async () => {
    // Match the production planner transport: JSON mode + schema instruction, then
    // enforce the full PatchPlan contract locally with Zod. The context-schema stage
    // above still proves provider-side responseJsonSchema independently.
    const rawParts = safeImageParts("Create a PATCH plan for this safe test image and a question that requires no computer action. Use zero actions.");
    const parts = withSchemaInstruction(rawParts, GEMINI_PATCH_PLAN_SCHEMA);
    assertGeminiGenerateContentRequestShape({ model, parts });
    const response = await client.models.generateContent({
      model,
      contents: parts,
      config: {
        systemInstruction: PATCH_SYSTEM_POLICY,
        responseMimeType: "application/json"
      }
    });
    PatchPlanSchema.parse(parseJson(response.text, "planning-schema"));
  });

  const completedAt = new Date().toISOString();
  return {
    diagnosticId,
    provider: "gemini",
    model,
    apiInterface,
    apiVersion,
    sdkVersion: GEMINI_SDK_VERSION,
    startedAt,
    completedAt,
    success: failedStage === null && stages.length === 7,
    lastSuccessfulStage,
    failedStage,
    stages
  };
}
