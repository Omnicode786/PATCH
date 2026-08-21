import OpenAI from "openai";
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
  type ProviderDiagnosticSink,
  type ProviderValidationResult
} from "@patch/ai-core";
import { PatchPlanSchema, type ModelDescriptor, type PatchPlan } from "@patch/schemas";
import { classifyOpenAIError } from "./errors";

const ContextAnalysisSchema = z.object({
  answer: z.string(),
  observed: z.array(z.string()),
  inferred: z.array(z.string()),
  unknown: z.array(z.string())
}).strict();

const DEFAULT_OPENAI_MODEL = "gpt-5.6";
const OPENAI_CONNECTION_TEST_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
} as const;

export const OPENAI_DESCRIPTOR: ProviderDescriptor = {
  id: "openai",
  displayName: "OpenAI",
  apiInterface: "Responses",
  apiVersion: "v1",
  baseUrl: "https://api.openai.com",
  defaultModel: DEFAULT_OPENAI_MODEL,
  supportsCustomModels: true,
  supportsStreaming: true,
  auth: [{
    type: "apiKey",
    label: "OpenAI API key",
    environmentVariables: ["OPENAI_API_KEY"],
    credentialUrl: "https://platform.openai.com/api-keys",
    setupUrl: "https://platform.openai.com/docs/quickstart"
  }]
};

const dataUrl = (image: ReturnType<typeof imageReferences>[number]): string => `data:${image.mimeType};base64,${image.dataBase64}`;
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-07" }) as Record<string, unknown>;

export class OpenAIProvider implements AIProvider {
  readonly id = "openai" as const;
  readonly name = "OpenAI";
  readonly descriptor = OPENAI_DESCRIPTOR;
  readonly #client: OpenAI;
  readonly #diagnostics: ProviderDiagnosticSink;

  constructor(apiKey: string, diagnostics: ProviderDiagnosticSink = () => undefined) {
    this.#client = new OpenAI({ apiKey });
    this.#diagnostics = diagnostics;
  }

  getCapabilities(): ProviderCapabilities {
    return { text: true, vision: true, structuredOutput: true, toolCalling: true, modelDiscovery: true };
  }

  async validateCredentials(): Promise<ProviderValidationResult> {
    try {
      await this.#client.models.list();
      return { ok: true, message: "API key authenticated successfully." };
    } catch (error: unknown) {
      const classified = classifyOpenAIError(error);
      return { ok: false, message: classified.message, errorCode: classified.code };
    }
  }

  async testConnection(model = DEFAULT_OPENAI_MODEL): Promise<ProviderValidationResult> {
    try {
      const response = await this.#client.responses.create({
        model,
        store: false,
        input: "Return a JSON object with ok set to true.",
        text: { format: { type: "json_schema", name: "patch_connection_test", schema: OPENAI_CONNECTION_TEST_SCHEMA, strict: true } }
      });
      const parsed: unknown = JSON.parse(response.output_text);
      if (!parsed || typeof parsed !== "object" || !("ok" in parsed) || parsed.ok !== true) {
        return { ok: false, message: "OpenAI authenticated, but the selected model did not satisfy PATCH's structured-output contract.", errorCode: "AI_PROVIDER_UNSUPPORTED_CAPABILITY" };
      }
      return { ok: true, message: `Connected successfully to ${model}; structured output is working.` };
    } catch (error: unknown) {
      const classified = classifyOpenAIError(error);
      return { ok: false, message: classified.message, errorCode: classified.code };
    }
  }

  async listModels(): Promise<ModelDescriptor[]> {
    try {
      const page = await this.#client.models.list();
      return page.data
        .filter((model) => /^gpt-5\./.test(model.id) || /^gpt-4\.1/.test(model.id) || /^gpt-4o/.test(model.id))
        .map((model) => ({
          id: model.id,
          displayName: model.id,
          stable: !/(preview|beta|latest)/i.test(model.id),
          capabilities: { text: true, vision: /^gpt-(5\.|4\.1|4o)/.test(model.id), structuredOutput: true, toolCalling: true }
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error: unknown) { throw classifyOpenAIError(error); }
  }

  async #log(level: "info" | "error", event: string, metadata: Readonly<Record<string, unknown>>): Promise<void> {
    await this.#diagnostics(level, event, metadata);
  }

  async analyzeContext(request: AIContextRequest): Promise<ContextAnalysis> {
    const prompt = `${request.prompt}\n\n${untrustedContextBlock(request.context)}\nAnswer the user's question and separate observed, inferred, and unknown facts.`;
    const started = Date.now();
    try {
      await this.#log("info", "patch.provider.request_start", { provider: "openai", model: request.model, capability: "vision", apiInterface: this.descriptor.apiInterface, apiVersion: this.descriptor.apiVersion, imageCount: imageReferences(request.context).length });
      const response = await this.#client.responses.create({
        model: request.model, store: false, instructions: PATCH_SYSTEM_POLICY,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...imageReferences(request.context).map((image) => ({ type: "input_image" as const, image_url: dataUrl(image), detail: "auto" as const }))] }],
        text: { format: { type: "json_schema", name: "patch_context_analysis", schema: jsonSchema(ContextAnalysisSchema), strict: true } }
      });
      const result = ContextAnalysisSchema.parse(JSON.parse(response.output_text));
      await this.#log("info", "patch.provider.request_success", { provider: "openai", model: request.model, capability: "vision", durationMs: Date.now() - started });
      return result;
    } catch (error: unknown) {
      const classified = classifyOpenAIError(error);
      await this.#log("error", "patch.provider.request_rejected", { provider: "openai", model: request.model, capability: "vision", failureStage: "analyzeContext", errorCode: classified.code, durationMs: Date.now() - started });
      throw classified;
    }
  }

  async planActions(request: ActionPlanningRequest): Promise<PatchPlan> {
    const runtimeDirective = request.runtimeDirective ? `\n\nRUNTIME DIRECTIVE (trusted PATCH capability state): ${request.runtimeDirective}` : "";
    const prompt = `${request.prompt}\n\n${untrustedContextBlock(request.context)}\n\n${availableToolsBlock(request.availableTools)}${runtimeDirective}\nCreate a grounded PATCH plan. Use zero actions for questions/explanations. When the current app is a connected browser and the user asks to change the webpage, prefer browser.applyPatch and execute the live page change rather than describing DevTools or source edits.`;
    const started = Date.now();
    try {
      await this.#log("info", "patch.provider.request_start", { provider: "openai", model: request.model, capability: "planning", toolCount: request.availableTools.length, runtimeMode: request.runtimeMode ?? "CONVERSATION", toolNames: request.availableTools.map((tool) => tool.name), apiInterface: this.descriptor.apiInterface, apiVersion: this.descriptor.apiVersion, imageCount: imageReferences(request.context).length });
      const response = await this.#client.responses.create({
        model: request.model, store: false, instructions: PATCH_SYSTEM_POLICY,
        input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...imageReferences(request.context).map((image) => ({ type: "input_image" as const, image_url: dataUrl(image), detail: "auto" as const }))] }],
        text: { format: { type: "json_schema", name: "patch_plan", schema: jsonSchema(PatchPlanSchema), strict: true } }
      });
      const result = PatchPlanSchema.parse(JSON.parse(response.output_text));
      await this.#log("info", "patch.provider.request_success", { provider: "openai", model: request.model, capability: "planning", durationMs: Date.now() - started });
      return result;
    } catch (error: unknown) {
      const classified = classifyOpenAIError(error);
      await this.#log("error", "patch.provider.request_rejected", { provider: "openai", model: request.model, capability: "planning", failureStage: "planActions", errorCode: classified.code, durationMs: Date.now() - started });
      throw classified;
    }
  }

  async respond(request: AIContextRequest): Promise<AssistantResponse> {
    const analysis = await this.analyzeContext(request);
    return { text: analysis.answer };
  }
}
