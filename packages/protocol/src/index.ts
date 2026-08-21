import { z } from "zod";
import { PROTOCOL_VERSION } from "@patch/schemas";

const EnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: z.string().uuid(),
  timestamp: z.string().datetime()
});

export const AdapterRequestSchema = EnvelopeSchema.extend({
  kind: z.literal("request"),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({})
}).strict();
export type AdapterRequest = z.infer<typeof AdapterRequestSchema>;

export const AdapterResponseSchema = EnvelopeSchema.extend({
  kind: z.literal("response"),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).strict().optional()
}).strict().superRefine((value, ctx) => {
  if (value.ok && value.error) ctx.addIssue({ code: "custom", message: "Successful response cannot include error" });
  if (!value.ok && !value.error) ctx.addIssue({ code: "custom", message: "Failed response must include error" });
});
export type AdapterResponse = z.infer<typeof AdapterResponseSchema>;

export const createRequest = (method: string, params: Readonly<Record<string, unknown>> = {}): AdapterRequest => ({
  protocolVersion: PROTOCOL_VERSION,
  requestId: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  kind: "request",
  method,
  params: { ...params }
});

export const createResponse = (requestId: string, result: unknown): AdapterResponse => ({
  protocolVersion: PROTOCOL_VERSION,
  requestId,
  timestamp: new Date().toISOString(),
  kind: "response",
  ok: true,
  result
});
