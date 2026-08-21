import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  PATCH_SYSTEM_POLICY,
  availableToolsBlock,
  imageReferences,
  untrustedContextBlock,
  type AIContextRequest,
  type AIProvider,
  type ActionPlanningRequest,
  type AssistantResponse,
  type ContextAnalysis,
  type ProviderCapabilities,
  type ProviderDescriptor,
  type ProviderDiagnosticReport,
  type ProviderDiagnosticSink,
  type ProviderValidationResult
} from "@patch/ai-core";
import { PatchPlanSchema, type ModelDescriptor, type PatchPlan } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import {
  GEMINI_CONTEXT_ANALYSIS_SCHEMA,
  GEMINI_PATCH_PLAN_SCHEMA,
  assertGeminiGenerateContentRequestShape,
  type GeminiContentPart,
  type GeminiJsonSchema
} from "./schema";
import { classifyGeminiError } from "./errors";
import { runGeminiDiagnostics } from "./diagnostics";

const ContextAnalysisSchema = z.object({
  answer: z.string(),
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string())
}).strict();

// Do not force the SDK onto Interactions/v1. PATCH now uses the mature GenerateContent
// path for its core multimodal + structured requests. @google/genai uses its current
// Gemini Developer API beta endpoint by default, which is where the SDK's current
// GenerateContent types/features are exposed together.
const GEMINI_API_VERSION = "v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const MODEL_PREFERENCE = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro"
] as const;

const GEMINI_CONNECTION_TEST_SCHEMA: GeminiJsonSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
};

export const GEMINI_DESCRIPTOR: ProviderDescriptor = {
  id: "gemini",
  displayName: "Google Gemini",
  apiInterface: "GenerateContent",
  apiVersion: GEMINI_API_VERSION,
  baseUrl: "https://generativelanguage.googleapis.com",
  defaultModel: DEFAULT_GEMINI_MODEL,
  supportsCustomModels: true,
  supportsStreaming: true,
  auth: [{
    type: "apiKey",
    label: "Gemini API key",
    environmentVariables: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    credentialUrl: "https://aistudio.google.com/apikey",
    setupUrl: "https://ai.google.dev/gemini-api/docs/api-key"
  }]
};

const inputFor = (request: AIContextRequest, extra = ""): Readonly<{ parts: GeminiContentPart[]; imageCount: number }> => {
  const images: GeminiContentPart[] = imageReferences(request.context).map((image) => ({
    inlineData: {
      data: image.dataBase64,
      mimeType: image.mimeType
    }
  }));
  return {
    parts: [
      { text: `${request.prompt}\n\n${untrustedContextBlock(request.context)}${extra}` },
      ...images
    ],
    imageCount: images.length
  };
};

const parseGeminiJson = (outputText: string | undefined, purpose: string): unknown => {
  if (!outputText?.trim()) throw new PatchError("VALIDATION_FAILED", `Gemini returned no structured output for ${purpose}.`);
  try {
    return JSON.parse(outputText);
  } catch {
    throw new PatchError("VALIDATION_FAILED", `Gemini returned invalid JSON for ${purpose}.`);
  }
};

const knownStable = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
]);

const normalizedAction = (value: string): string => value.replace(/[^a-z]/gi, "").toLowerCase();
const supportsGenerateContent = (actions: readonly string[] | undefined): boolean =>
  !actions?.length || actions.some((action) => normalizedAction(action) === "generatecontent");

const isGeneralGeminiGenerationModel = (id: string, actions: readonly string[] | undefined): boolean =>
  /^gemini-/i.test(id) &&
  !/(embedding|image(?:-|$)|tts|lyria|robotics|live)/i.test(id) &&
  supportsGenerateContent(actions);

const schemaInstructionParts = (parts: readonly GeminiContentPart[], schema: GeminiJsonSchema): GeminiContentPart[] => {
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

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly name = "Google Gemini";
  readonly descriptor = GEMINI_DESCRIPTOR;
  readonly #client: GoogleGenAI;
  readonly #diagnostics: ProviderDiagnosticSink;

  constructor(apiKey: string, diagnostics: ProviderDiagnosticSink = () => undefined) {
    this.#client = new GoogleGenAI({ apiKey });
    this.#diagnostics = diagnostics;
  }

  getCapabilities(): ProviderCapabilities {
    return { text: true, vision: true, structuredOutput: true, toolCalling: true, modelDiscovery: true };
  }

  async #diagnostic(level: "debug" | "info" | "warn" | "error", event: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#diagnostics(level, event, metadata);
  }

  async validateCredentials(): Promise<ProviderValidationResult> {
    try {
      const models = await this.#client.models.list();
      for await (const _model of models) break;
      return { ok: true, message: "API key authenticated successfully." };
    } catch (error: unknown) {
      const classified = classifyGeminiError(error);
      return { ok: false, message: classified.message, errorCode: classified.code };
    }
  }

  async #resolveDiscoveredModel(preferred: string, excluded: ReadonlySet<string> = new Set()): Promise<string> {
    const models = await this.listModels();
    const usable = models.filter((model) => model.capabilities.text && !excluded.has(model.id));
    if (!excluded.has(preferred) && usable.some((model) => model.id === preferred)) return preferred;

    const byId = new Set(usable.map((model) => model.id));
    const fallback = MODEL_PREFERENCE.find((id) => byId.has(id)) ?? usable.find((model) => model.stable)?.id ?? usable[0]?.id;
    if (!fallback) throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", "Gemini model discovery returned no alternative model that supports content generation.");

    await this.#diagnostic("warn", "patch.provider.model_fallback", {
      provider: "gemini",
      requestedModel: preferred,
      selectedModel: fallback,
      excludedModels: [...excluded],
      reason: excluded.size ? "provider-rejected-selected-model" : "requested-model-not-returned-by-discovery"
    });
    return fallback;
  }

  async #withModelRecovery<T>(preferred: string, operation: (model: string) => Promise<T>): Promise<Readonly<{ model: string; value: T }>> {
    // Resolve the persisted/custom role against the key's current model list before
    // sending user content. This prevents stale model IDs from causing a dead-end 400.
    // If discovery itself is temporarily unavailable, still try the explicitly selected
    // model so a transient list-models outage cannot block an otherwise valid request.
    let selected = preferred;
    try {
      selected = await this.#resolveDiscoveredModel(preferred);
    } catch (discoveryError: unknown) {
      const classifiedDiscovery = classifyGeminiError(discoveryError);
      if (classifiedDiscovery.code === "AI_PROVIDER_AUTH_FAILED") throw classifiedDiscovery;
    }

    try {
      return { model: selected, value: await operation(selected) };
    } catch (error: unknown) {
      const classified = classifyGeminiError(error);
      // #generateStructured already retries once without provider-side JSON Schema.
      // At this point an unsupported model OR a provider-side generic 400 can still be
      // model-specific. Retry exactly once with a different discovered GenerateContent
      // model. PATCH validates the local request shape before either network call, so
      // this does not mask a locally malformed payload.
      if (classified.code !== "AI_PROVIDER_UNSUPPORTED_MODEL" && classified.code !== "AI_PROVIDER_INVALID_REQUEST") throw classified;

      let fallback: string;
      try {
        fallback = await this.#resolveDiscoveredModel(preferred, new Set([selected]));
      } catch {
        throw classified;
      }
      if (fallback === selected) throw classified;

      try {
        return { model: fallback, value: await operation(fallback) };
      } catch (fallbackError: unknown) {
        throw classifyGeminiError(fallbackError);
      }
    }
  }

  async #generateStructured(
    model: string,
    parts: readonly GeminiContentPart[],
    schema: GeminiJsonSchema,
    purpose: string,
    schemaTransport: "provider-json-schema" | "prompt-json-schema" = "provider-json-schema"
  ): Promise<unknown> {
    if (schemaTransport === "prompt-json-schema") {
      // Complex action-plan schemas are locally enforced by PatchPlanSchema. Keeping
      // the schema in the prompt avoids model/API revisions rejecting a supported
      // GenerateContent request solely because of provider-side schema transport.
      const promptedParts = schemaInstructionParts(parts, schema);
      assertGeminiGenerateContentRequestShape({ model, parts: promptedParts });
      try {
        const response = await this.#client.models.generateContent({
          model,
          contents: promptedParts,
          config: {
            systemInstruction: PATCH_SYSTEM_POLICY,
            responseMimeType: "application/json"
          }
        });
        return parseGeminiJson(response.text, purpose);
      } catch (error: unknown) {
        throw classifyGeminiError(error);
      }
    }

    assertGeminiGenerateContentRequestShape({ model, schema, parts });

    try {
      const response = await this.#client.models.generateContent({
        model,
        contents: [...parts],
        config: {
          systemInstruction: PATCH_SYSTEM_POLICY,
          responseMimeType: "application/json",
          responseJsonSchema: schema
        }
      });
      return parseGeminiJson(response.text, purpose);
    } catch (error: unknown) {
      const classified = classifyGeminiError(error);
      if (classified.code !== "AI_PROVIDER_INVALID_REQUEST") throw classified;

      // Some model revisions accept JSON mode but reject one JSON-Schema keyword.
      // Preserve PATCH's strict application-level Zod boundary while retrying once
      // without the provider-enforced schema. The schema is included as untrusted-free
      // system/request metadata in the prompt and the result is still parsed + validated.
      await this.#diagnostic("warn", "patch.provider.schema_transport_fallback", {
        provider: "gemini",
        model,
        purpose,
        reason: "provider-rejected-response-json-schema"
      });
      const fallbackParts = schemaInstructionParts(parts, schema);
      assertGeminiGenerateContentRequestShape({ model, parts: fallbackParts });
      const response = await this.#client.models.generateContent({
        model,
        contents: fallbackParts,
        config: {
          systemInstruction: PATCH_SYSTEM_POLICY,
          responseMimeType: "application/json"
        }
      });
      return parseGeminiJson(response.text, purpose);
    }
  }

  async testConnection(model = DEFAULT_GEMINI_MODEL): Promise<ProviderValidationResult> {
    try {
      const parts: GeminiContentPart[] = [{ text: "Return a JSON object with ok set to true." }];
      const result = await this.#withModelRecovery(model, async (selectedModel) => {
        const value = await this.#generateStructured(selectedModel, parts, GEMINI_CONNECTION_TEST_SCHEMA, "connection test");
        if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
          throw new PatchError("AI_PROVIDER_UNSUPPORTED_CAPABILITY", "Gemini authenticated, but the selected model did not satisfy PATCH's structured-output contract.");
        }
      });
      const suffix = result.model === model ? "" : ` (requested ${model}; using available model ${result.model})`;
      return { ok: true, message: `Connected successfully to ${result.model}; structured output is working${suffix}.` };
    } catch (error: unknown) {
      const classified = classifyGeminiError(error);
      return { ok: false, message: classified.message, errorCode: classified.code };
    }
  }

  async diagnose(model = DEFAULT_GEMINI_MODEL): Promise<ProviderDiagnosticReport> {
    let selectedModel = model;
    try {
      selectedModel = await this.#resolveDiscoveredModel(model);
    } catch {
      // Let the staged authentication/model calls produce the actionable report.
    }
    return runGeminiDiagnostics(
      this.#client,
      selectedModel,
      this.#diagnostics,
      this.descriptor.apiInterface,
      this.descriptor.apiVersion
    );
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const pager = await this.#client.models.list();
      const models: ModelDescriptor[] = [];
      for await (const model of pager) {
        const id = model.name?.replace(/^models\//, "");
        if (!id || !/^gemini-/i.test(id)) continue;
        const actions = model.supportedActions;
        const isGenerationModel = isGeneralGeminiGenerationModel(id, actions);
        if (!isGenerationModel) continue;
        models.push({
          id,
          displayName: model.displayName ?? id,
          stable: knownStable.has(id),
          capabilities: {
            text: true,
            vision: true,
            structuredOutput: true,
            toolCalling: true
          }
        });
      }
      return models.sort((a, b) => {
        const aRank = MODEL_PREFERENCE.indexOf(a.id as typeof MODEL_PREFERENCE[number]);
        const bRank = MODEL_PREFERENCE.indexOf(b.id as typeof MODEL_PREFERENCE[number]);
        const normalizedA = aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank;
        const normalizedB = bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank;
        return normalizedA - normalizedB || a.id.localeCompare(b.id);
      });
    } catch (error: unknown) {
      throw classifyGeminiError(error);
    }
  }

  async #structuredRequest<T>(options: Readonly<{
    request: AIContextRequest;
    schema: GeminiJsonSchema;
    purpose: string;
    capability: "vision" | "planning";
    extra: string;
    toolCount: number;
    parse: (value: unknown) => T;
    schemaTransport?: "provider-json-schema" | "prompt-json-schema";
  }>): Promise<T> {
    const { parts, imageCount } = inputFor(options.request, options.extra);
    const started = Date.now();
    const diagnosticId = crypto.randomUUID();
    let activeModel = options.request.model;

    try {
      assertGeminiGenerateContentRequestShape({ model: options.request.model, schema: options.schema, parts });
      await this.#diagnostic("info", "patch.provider.request_start", {
        diagnosticId,
        provider: "gemini",
        model: options.request.model,
        capability: options.capability,
        toolCount: options.toolCount,
        schemaValidation: "passed",
        apiInterface: this.descriptor.apiInterface,
        apiVersion: this.descriptor.apiVersion,
        imageCount
      });

      const result = await this.#withModelRecovery(options.request.model, async (model) => {
        activeModel = model;
        const value = await this.#generateStructured(model, parts, options.schema, options.purpose, options.schemaTransport);
        try {
          return options.parse(value);
        } catch {
          throw new PatchError("VALIDATION_FAILED", `Gemini returned JSON that did not satisfy PATCH's ${options.purpose} contract.`);
        }
      });
      activeModel = result.model;

      await this.#diagnostic("info", "patch.provider.request_success", {
        diagnosticId,
        provider: "gemini",
        requestedModel: options.request.model,
        model: activeModel,
        capability: options.capability,
        durationMs: Date.now() - started
      });
      return result.value;
    } catch (error: unknown) {
      const classified = classifyGeminiError(error);
      const details = classified.details && typeof classified.details === "object" ? classified.details : {};
      await this.#diagnostic("error", "patch.provider.request_rejected", {
        diagnosticId,
        provider: "gemini",
        requestedModel: options.request.model,
        model: activeModel,
        capability: options.capability,
        failureStage: options.capability === "planning" ? "planActions" : "analyzeContext",
        errorCode: classified.code,
        durationMs: Date.now() - started,
        ...details
      });
      throw new PatchError(
        classified.code,
        `${classified.message} Diagnostic ID: ${diagnosticId}.`,
        { ...details, diagnosticId, requestedModel: options.request.model, model: activeModel }
      );
    }
  }

  async analyzeContext(request: AIContextRequest): Promise<ContextAnalysis> {
    return this.#structuredRequest({
      request,
      schema: GEMINI_CONTEXT_ANALYSIS_SCHEMA,
      purpose: "context analysis",
      capability: "vision",
      extra: "\nAnswer the question and separate observed, inferred, and unknown facts.",
      toolCount: 0,
      parse: (value) => ContextAnalysisSchema.parse(value)
    });
  }

  async planActions(request: ActionPlanningRequest): Promise<PatchPlan> {
    return this.#structuredRequest({
      request,
      schema: GEMINI_PATCH_PLAN_SCHEMA,
      purpose: "action plan",
      capability: "planning",
      extra: `\n\n${availableToolsBlock(request.availableTools)}${request.runtimeDirective ? `\n\nRUNTIME DIRECTIVE (trusted PATCH capability state): ${request.runtimeDirective}` : ""}\nCreate a grounded PATCH plan. Use zero actions for questions/explanations. When the current app is a connected browser and the user asks to change the webpage, prefer browser.applyPatch and execute the live page change rather than describing DevTools or source edits.`,
      toolCount: request.availableTools.length,
      schemaTransport: "prompt-json-schema",
      parse: (value) => PatchPlanSchema.parse(value)
    });
  }

  async respond(request: AIContextRequest): Promise<AssistantResponse> {
    const analysis = await this.analyzeContext(request);
    return { text: analysis.answer };
  }
}
