import { describe, expect, it } from "vitest";
import { PatchPlanSchema } from "./index";

describe("PatchPlan schema", () => {
  it("requires known risk levels and strict fields", () => {
    const plan = { version: "1", requestClass: "QUESTION", interpretation: { goal: "explain", confidence: 0.9 }, evidence: { observed: [], inferred: [], unknown: [] }, requiresConfirmation: false, actions: [], expectedOutcome: "answer" };
    expect(PatchPlanSchema.parse(plan)).toEqual(plan);
    expect(() => PatchPlanSchema.parse({ ...plan, invented: true })).toThrow();
  });
});
