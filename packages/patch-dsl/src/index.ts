import { z } from "zod";

export const PatchTargetIdSchema = z.string().regex(/^(dom-|patch-container-)[A-Za-z0-9_-]+$/);

const SafeCssValueSchema = z.string().max(300).refine(
  (value) => !/(url\s*\(|@import|expression\s*\(|javascript:|data:text\/html)/i.test(value),
  "Unsafe CSS value"
);

const SafeStyleSchema = z.object({
  display: SafeCssValueSchema.optional(),
  position: SafeCssValueSchema.optional(),
  width: SafeCssValueSchema.optional(),
  height: SafeCssValueSchema.optional(),
  minWidth: SafeCssValueSchema.optional(),
  maxWidth: SafeCssValueSchema.optional(),
  minHeight: SafeCssValueSchema.optional(),
  maxHeight: SafeCssValueSchema.optional(),
  margin: SafeCssValueSchema.optional(),
  padding: SafeCssValueSchema.optional(),
  gap: SafeCssValueSchema.optional(),
  gridTemplateColumns: SafeCssValueSchema.optional(),
  flexDirection: SafeCssValueSchema.optional(),
  alignItems: SafeCssValueSchema.optional(),
  justifyContent: SafeCssValueSchema.optional(),
  fontSize: SafeCssValueSchema.optional(),
  fontWeight: SafeCssValueSchema.optional(),
  lineHeight: SafeCssValueSchema.optional(),
  color: SafeCssValueSchema.optional(),
  backgroundColor: SafeCssValueSchema.optional(),
  border: SafeCssValueSchema.optional(),
  borderRadius: SafeCssValueSchema.optional(),
  boxShadow: SafeCssValueSchema.optional(),
  opacity: SafeCssValueSchema.optional(),
  overflow: SafeCssValueSchema.optional()
}).strict();
export type SafeStyle = z.infer<typeof SafeStyleSchema>;

const Base = z.object({ opId: z.string().min(1).max(100) });
export const PatchOperationSchema = z.discriminatedUnion("action", [
  Base.extend({ action: z.literal("HIDE"), target: PatchTargetIdSchema }).strict(),
  Base.extend({ action: z.literal("SHOW"), target: PatchTargetIdSchema }).strict(),
  Base.extend({ action: z.literal("MOVE"), target: PatchTargetIdSchema, destination: PatchTargetIdSchema, position: z.enum(["first", "last"]).default("last") }).strict(),
  Base.extend({ action: z.literal("GROUP"), targets: z.array(PatchTargetIdSchema).min(1).max(100), containerId: z.string().regex(/^patch-container-/) }).strict(),
  Base.extend({ action: z.literal("REORDER"), target: PatchTargetIdSchema, index: z.number().int().min(0).max(10000) }).strict(),
  Base.extend({ action: z.literal("RESIZE"), target: PatchTargetIdSchema, width: SafeCssValueSchema.optional(), height: SafeCssValueSchema.optional() }).strict(),
  Base.extend({ action: z.literal("RESTYLE"), target: PatchTargetIdSchema, styles: SafeStyleSchema }).strict(),
  Base.extend({ action: z.literal("COLLAPSE"), target: PatchTargetIdSchema, collapsed: z.boolean() }).strict(),
  Base.extend({ action: z.literal("HIGHLIGHT"), target: PatchTargetIdSchema, emphasis: z.enum(["subtle", "strong"]).default("subtle") }).strict(),
  Base.extend({ action: z.literal("SET_TYPOGRAPHY"), target: PatchTargetIdSchema, fontSize: SafeCssValueSchema.optional(), lineHeight: SafeCssValueSchema.optional(), fontWeight: SafeCssValueSchema.optional() }).strict(),
  Base.extend({ action: z.literal("REDUCE_MOTION"), target: PatchTargetIdSchema }).strict(),
  Base.extend({ action: z.literal("CHANGE_LAYOUT"), target: PatchTargetIdSchema, display: z.enum(["block", "flex", "grid"]), gap: SafeCssValueSchema.optional(), columns: SafeCssValueSchema.optional() }).strict(),
  Base.extend({ action: z.literal("ADD_LABEL"), target: PatchTargetIdSchema, text: z.string().min(1).max(200), placement: z.enum(["before", "after"]).default("before") }).strict(),
  Base.extend({ action: z.literal("CREATE_CONTAINER"), containerId: z.string().regex(/^patch-container-/), parent: PatchTargetIdSchema.nullable(), styles: SafeStyleSchema.default({}) }).strict()
]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const WebsitePatchSchema = z.object({
  version: z.literal("1"),
  operations: z.array(PatchOperationSchema).min(1).max(200)
}).strict();
export type WebsitePatch = z.infer<typeof WebsitePatchSchema>;

export const SavedLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("id"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("attribute"), name: z.enum(["data-testid", "data-test", "name", "aria-label"]), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("semantic"), role: z.string().min(1), text: z.string().min(1).max(200), occurrence: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("path"), segments: z.array(z.number().int().nonnegative()).min(1).max(30) }).strict()
]);
export type SavedLocator = z.infer<typeof SavedLocatorSchema>;

export const SavedPatchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  domain: z.string().min(1),
  pathPattern: z.string().min(1),
  createdAt: z.string().datetime(),
  lastAppliedAt: z.string().datetime().nullable(),
  enabled: z.boolean(),
  operations: z.array(z.object({ operation: PatchOperationSchema, locators: z.record(z.string(), SavedLocatorSchema) }).strict()).min(1)
}).strict();
export type SavedPatch = z.infer<typeof SavedPatchSchema>;
