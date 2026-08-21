import { z } from "zod";

export const PROTOCOL_VERSION = "1" as const;

export const RectangleSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative()
}).strict();

export type Rectangle = z.infer<typeof RectangleSchema>;
export const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const AnnotationSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1), kind: z.literal("rectangle"), bounds: RectangleSchema }).strict(),
  z.object({ id: z.string().min(1), kind: z.literal("freehand"), points: z.array(PointSchema).min(2).max(5000) }).strict(),
  z.object({ id: z.string().min(1), kind: z.literal("arrow"), from: PointSchema, to: PointSchema }).strict()
]);
export type Annotation = z.infer<typeof AnnotationSchema>;

export const ImageReferenceSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataBase64: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  scaleFactor: z.number().positive().default(1)
}).strict();
export type ImageReference = z.infer<typeof ImageReferenceSchema>;

export const ActiveApplicationSchema = z.object({
  processName: z.string().optional(),
  windowTitle: z.string().optional(),
  executablePath: z.string().optional(),
  nativeWindowHandle: z.string().optional(),
  bounds: RectangleSchema.optional()
}).strict();
export type ActiveApplication = z.infer<typeof ActiveApplicationSchema>;

export const AccessibilityNodeSchema: z.ZodType<AccessibilityNode> = z.lazy(() => z.object({
  id: z.string().regex(/^uia-/),
  role: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  offscreen: z.boolean(),
  bounds: RectangleSchema.nullable(),
  patterns: z.array(z.string()),
  value: z.string().optional(),
  toggleState: z.enum(["On", "Off", "Indeterminate"]).optional(),
  children: z.array(AccessibilityNodeSchema)
}).strict());


export interface AccessibilityNode {
  id: string;
  role: string;
  name: string;
  enabled: boolean;
  offscreen: boolean;
  bounds: z.infer<typeof RectangleSchema> | null;
  patterns: string[];
  value?: string | undefined;
  toggleState?: "On" | "Off" | "Indeterminate" | undefined;
  children: AccessibilityNode[];
}
export const BrowserElementSchema = z.object({
  id: z.string().regex(/^dom-/),
  parentId: z.string().regex(/^dom-/).optional(),
  tag: z.string(),
  role: z.string().optional(),
  text: z.string().max(500),
  name: z.string().max(300).optional(),
  interactive: z.boolean(),
  bounds: RectangleSchema,
  attributes: z.record(z.string(), z.string()).default({})
}).strict();
export type BrowserElement = z.infer<typeof BrowserElementSchema>;

export const BrowserContextSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  elements: z.array(BrowserElementSchema).max(2500),
  patchIds: z.array(z.string()).default([])
}).strict();
export type BrowserContext = z.infer<typeof BrowserContextSchema>;

export const PhotoshopLayerSchema: z.ZodType<PhotoshopLayer> = z.lazy(() => z.object({
  id: z.string().regex(/^ps-layer-/),
  nativeId: z.number().int(),
  name: z.string(),
  kind: z.string(),
  opacity: z.number().min(0).max(100),
  visible: z.boolean(),
  locked: z.boolean(),
  bounds: RectangleSchema.nullable(),
  children: z.array(PhotoshopLayerSchema)
}).strict());
export interface PhotoshopLayer {
  id: string;
  nativeId: number;
  name: string;
  kind: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  bounds: z.infer<typeof RectangleSchema> | null;
  children: PhotoshopLayer[];
}

export const PhotoshopContextSchema = z.object({
  documentId: z.number().int(),
  documentName: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  activeLayerId: z.string().regex(/^ps-layer-/).nullable(),
  layers: z.array(PhotoshopLayerSchema)
}).strict();
export type PhotoshopContext = z.infer<typeof PhotoshopContextSchema>;

export const VisualContextSchema = z.object({
  fullScreenImage: ImageReferenceSchema.optional(),
  activeWindowImage: ImageReferenceSchema.optional(),
  selectedCrop: ImageReferenceSchema.optional(),
  annotations: z.array(AnnotationSchema),
  captureDisplayBounds: RectangleSchema.optional(),
  activeApplication: ActiveApplicationSchema,
  accessibilityContext: z.array(AccessibilityNodeSchema).optional(),
  browserContext: BrowserContextSchema.optional(),
  photoshopContext: PhotoshopContextSchema.optional()
}).strict();
export type VisualContext = z.infer<typeof VisualContextSchema>;

export const RequestClassSchema = z.enum([
  "QUESTION", "EXPLANATION", "TRANSFORMATION", "APPLICATION_ACTION", "WEB_PATCH", "AMBIGUOUS"
]);
export type RequestClass = z.infer<typeof RequestClassSchema>;

export const RiskLevelSchema = z.enum([
  "READ_ONLY", "REVERSIBLE", "SIDE_EFFECT", "DESTRUCTIVE", "SECURITY_SENSITIVE"
]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const EvidenceSchema = z.object({
  observed: z.array(z.string()).max(100),
  inferred: z.array(z.string()).max(100),
  unknown: z.array(z.string()).max(100)
}).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ToolActionSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  targetId: z.string().nullable(),
  arguments: z.record(z.string(), z.unknown()),
  risk: RiskLevelSchema,
  expectedOutcome: z.string().min(1)
}).strict();
export type ToolAction = z.infer<typeof ToolActionSchema>;

export const PatchPlanSchema = z.object({
  version: z.literal("1"),
  requestClass: RequestClassSchema,
  interpretation: z.object({ goal: z.string().min(1), confidence: z.number().min(0).max(1) }).strict(),
  evidence: EvidenceSchema,
  requiresConfirmation: z.boolean(),
  actions: z.array(ToolActionSchema).max(30),
  expectedOutcome: z.string().min(1)
}).strict();
export type PatchPlan = z.infer<typeof PatchPlanSchema>;

export const ModelCapabilitiesSchema = z.object({
  text: z.boolean(),
  vision: z.boolean(),
  structuredOutput: z.boolean(),
  toolCalling: z.boolean(),
  audio: z.boolean().optional(),
  realtime: z.boolean().optional()
}).strict();
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelDescriptorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  capabilities: ModelCapabilitiesSchema,
  stable: z.boolean()
}).strict();
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

export const ProviderIdSchema = z.enum(["openai", "gemini"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ProviderSelectionSchema = z.object({
  defaultProvider: ProviderIdSchema.nullable(),
  visionProvider: ProviderIdSchema.nullable(),
  reasoningProvider: ProviderIdSchema.nullable(),
  automaticFallback: z.boolean().default(false),
  costPreference: z.enum(["lower-cost", "balanced", "best-quality"]).default("balanced")
}).strict();
export type ProviderSelection = z.infer<typeof ProviderSelectionSchema>;
