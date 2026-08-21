import { PatchError } from "@patch/shared";

export type GeminiJsonSchema = Readonly<Record<string, unknown>>;

// responseJsonSchema on GenerateContent accepts a useful, but intentionally limited,
// JSON-Schema subset. Keep PATCH's provider-facing schema inside that subset and run
// strict Zod validation after every response.
const allowedKeywords = new Set([
  "$id", "$defs", "$ref", "$anchor",
  "type", "properties", "required", "additionalProperties", "propertyOrdering",
  "title", "description", "enum", "format", "minimum", "maximum",
  "items", "prefixItems", "minItems", "maxItems", "anyOf", "oneOf"
]);

const supportedTypes = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

export function validateGeminiJsonSchema(schema: unknown, path = "$", depth = 0): asserts schema is GeminiJsonSchema {
  if (depth > 32) throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini schema is too deeply nested at ${path}.`);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini schema must be an object at ${path}.`);
  }

  for (const [key, value] of Object.entries(schema)) {
    if (!allowedKeywords.has(key)) {
      throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Unsupported Gemini schema keyword "${key}" at ${path}.`);
    }

    if (key === "type") {
      const values = Array.isArray(value) ? value : [value];
      if (values.length === 0 || values.some((item) => typeof item !== "string" || !supportedTypes.has(item))) {
        throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Unsupported Gemini schema type at ${path}.type.`);
      }
    } else if ((key === "properties" || key === "$defs") && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, child] of Object.entries(value)) validateGeminiJsonSchema(child, `${path}.${key}.${name}`, depth + 1);
    } else if (key === "$ref") {
      if (typeof value !== "string" || !value.startsWith("#")) {
        throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini schema $ref must be a local reference at ${path}.$ref.`);
      }
    } else if (key === "items") {
      validateGeminiJsonSchema(value, `${path}.items`, depth + 1);
    } else if (key === "prefixItems" || key === "anyOf" || key === "oneOf") {
      if (!Array.isArray(value)) throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini schema ${key} must be an array at ${path}.`);
      value.forEach((child, index) => validateGeminiJsonSchema(child, `${path}.${key}[${index}]`, depth + 1));
    } else if (key === "additionalProperties" && typeof value !== "boolean") {
      validateGeminiJsonSchema(value, `${path}.additionalProperties`, depth + 1);
    }
  }
}

const stringArray = { type: "array", items: { type: "string" }, maxItems: 100 } as const;

export const GEMINI_CONTEXT_ANALYSIS_SCHEMA: GeminiJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    observed: stringArray,
    inferred: stringArray,
    unknown: stringArray
  },
  required: ["answer", "observed", "inferred", "unknown"],
  additionalProperties: false
};

export const GEMINI_PATCH_PLAN_SCHEMA: GeminiJsonSchema = {
  type: "object",
  properties: {
    version: { type: "string", enum: ["1"] },
    requestClass: { type: "string", enum: ["QUESTION", "EXPLANATION", "TRANSFORMATION", "APPLICATION_ACTION", "WEB_PATCH", "AMBIGUOUS"] },
    interpretation: {
      type: "object",
      properties: {
        goal: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["goal", "confidence"],
      additionalProperties: false
    },
    evidence: {
      type: "object",
      properties: { observed: stringArray, inferred: stringArray, unknown: stringArray },
      required: ["observed", "inferred", "unknown"],
      additionalProperties: false
    },
    requiresConfirmation: { type: "boolean" },
    actions: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          tool: { type: "string" },
          targetId: { anyOf: [{ type: "string" }, { type: "null" }] },
          arguments: { type: "object", additionalProperties: true },
          risk: { type: "string", enum: ["READ_ONLY", "REVERSIBLE", "SIDE_EFFECT", "DESTRUCTIVE", "SECURITY_SENSITIVE"] },
          expectedOutcome: { type: "string" }
        },
        required: ["id", "tool", "targetId", "arguments", "risk", "expectedOutcome"],
        additionalProperties: false
      }
    },
    expectedOutcome: { type: "string" }
  },
  required: ["version", "requestClass", "interpretation", "evidence", "requiresConfirmation", "actions", "expectedOutcome"],
  additionalProperties: false
};

const MAX_INLINE_GENERATE_CONTENT_BYTES = 19 * 1024 * 1024;

export type GeminiTextPart = Readonly<{ text: string }>;
export type GeminiInlineImagePart = Readonly<{ inlineData: Readonly<{ data: string; mimeType: string }> }>;
export type GeminiContentPart = GeminiTextPart | GeminiInlineImagePart;

function approximateBase64Bytes(value: string): number {
  const cleaned = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", "Gemini inline image data is not valid base64.");
  }
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(cleaned.length * 3 / 4) - padding);
}

function validateGenerateContentPart(part: unknown, path: string): number {
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini ${path} must be a content Part object.`);
  }

  const record = part as Record<string, unknown>;
  const hasText = Object.prototype.hasOwnProperty.call(record, "text");
  const hasInlineData = Object.prototype.hasOwnProperty.call(record, "inlineData");
  if (Number(hasText) + Number(hasInlineData) !== 1) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini ${path} must contain exactly one supported Part field.`);
  }

  if (hasText) {
    if (typeof record.text !== "string" || !record.text.trim()) {
      throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini text ${path} must contain non-empty text.`);
    }
    const unknownKeys = Object.keys(record).filter((key) => key !== "text");
    if (unknownKeys.length) throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Unsupported Gemini text field "${unknownKeys[0]}" at ${path}.`);
    return new TextEncoder().encode(record.text).byteLength;
  }

  const inlineData = record.inlineData;
  if (!inlineData || typeof inlineData !== "object" || Array.isArray(inlineData)) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini ${path}.inlineData must be an object.`);
  }
  const dataRecord = inlineData as Record<string, unknown>;
  if (typeof dataRecord.data !== "string" || !dataRecord.data) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini image ${path} must contain inline base64 data.`);
  }
  if (typeof dataRecord.mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(dataRecord.mimeType)) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Gemini image ${path} has an invalid MIME type.`);
  }
  const unknownKeys = Object.keys(dataRecord).filter((key) => key !== "data" && key !== "mimeType");
  if (unknownKeys.length) throw new PatchError("AI_PROVIDER_INVALID_REQUEST", `Unsupported Gemini inlineData field "${unknownKeys[0]}" at ${path}.inlineData.`);
  return approximateBase64Bytes(dataRecord.data);
}

export function assertGeminiGenerateContentRequestShape(input: Readonly<{
  model: string;
  schema?: GeminiJsonSchema;
  parts: readonly unknown[];
}>): void {
  if (!/^gemini-[a-z0-9][a-z0-9._-]*$/i.test(input.model)) {
    throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", `Invalid Gemini model identifier: ${input.model}`);
  }
  if (input.parts.length === 0) throw new PatchError("AI_PROVIDER_INVALID_REQUEST", "Gemini GenerateContent input cannot be empty.");
  if (input.schema) validateGeminiJsonSchema(input.schema);

  const approximateBytes = input.parts.reduce<number>(
    (total, part, index) => total + validateGenerateContentPart(part, `contents[0].parts[${index}]`),
    0
  );
  if (approximateBytes > MAX_INLINE_GENERATE_CONTENT_BYTES) {
    throw new PatchError("AI_PROVIDER_INVALID_REQUEST", "Gemini inline GenerateContent payload is too large; keep inline request content below 20 MB.");
  }
}
