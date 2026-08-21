import { describe, expect, it } from "vitest";
import { DEFAULT_PERMISSIONS, PermissionEngine, actionRequiresConfirmation, redactSecrets } from "./index";
import type { PatchPlan, ToolAction } from "@patch/schemas";

const action: ToolAction = { id: "a1", tool: "windows.toggle", targetId: "uia-1", arguments: { state: "Off" }, risk: "REVERSIBLE", expectedOutcome: "off" };

describe("permission policy", () => {
  it("requires confirmation for mutations by default", () => expect(actionRequiresConfirmation(action, DEFAULT_PERMISSIONS)).toBe(true));
  it("forbids actions inside explanation plans", () => {
    const plan: PatchPlan = { version: "1", requestClass: "EXPLANATION", interpretation: { goal: "explain", confidence: 1 }, evidence: { observed: [], inferred: [], unknown: [] }, requiresConfirmation: false, actions: [action], expectedOutcome: "answer" };
    expect(() => new PermissionEngine().validatePlan(plan, DEFAULT_PERMISSIONS)).toThrow(/cannot execute actions/i);
  });

  it("blocks coordinate fallback unless explicitly enabled", () => {
    const screenAction: ToolAction = { id: "s1", tool: "screen.click", targetId: "annotation-1", arguments: {}, risk: "SIDE_EFFECT", expectedOutcome: "click" };
    const plan: PatchPlan = { version: "1", requestClass: "APPLICATION_ACTION", interpretation: { goal: "click selection", confidence: 1 }, evidence: { observed: ["User annotated target"], inferred: [], unknown: [] }, requiresConfirmation: true, actions: [screenAction], expectedOutcome: "clicked" };
    expect(() => new PermissionEngine().validatePlan(plan, DEFAULT_PERMISSIONS)).toThrow(/coordinateControl permission is disabled/i);
    expect(() => new PermissionEngine().validatePlan(plan, { ...DEFAULT_PERMISSIONS, coordinateControl: true })).not.toThrow();
  });
  it("redacts nested credentials", () => expect(redactSecrets({ apiKey: "secret", nested: { authorization: "Bearer x", safe: "ok" } })).toEqual({ apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]", safe: "ok" } }));
});
