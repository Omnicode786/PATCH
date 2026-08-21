import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "./index";

const action = { id: "a1", tool: "windows.toggle", targetId: "uia-real", arguments: { state: "Off" }, risk: "REVERSIBLE" as const, expectedOutcome: "off" };

describe("tool registry grounding", () => {
  const registry = new ToolRegistry();
  registry.register({ name: "windows.toggle", description: "toggle", targetPrefixes: ["uia-"], risk: "REVERSIBLE", argsSchema: z.object({ state: z.enum(["On", "Off"]) }), execute: async () => ({ changed: true, verified: true, summary: "done" }) });
  it("rejects invented targets", () => expect(() => registry.validateAction(action, new Set(["uia-other"]))).toThrow(/unknown target/i));
  it("rejects missing required targets", () => expect(() => registry.validateAction({ ...action, targetId: null }, new Set(["uia-real"]))).toThrow(/requires a grounded target/i));
  it("rejects model risk downgrades", () => expect(() => registry.validateAction({ ...action, risk: "READ_ONLY" }, new Set(["uia-real"]))).toThrow(/risk mismatch/i));
  it("accepts a grounded action", () => expect(() => registry.validateAction(action, new Set(["uia-real"]))).not.toThrow());
});
