import type { RiskLevel, ToolAction, VisualContext } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import { z, type ZodType } from "zod";

export type ToolResult = Readonly<{
  changed: boolean;
  verified: boolean;
  summary: string;
  observation?: unknown;
  undoToken?: string;
}>;

export type ToolExecutionContext = Readonly<{
  sessionId: string;
  signal: AbortSignal;
  visualContext: VisualContext;
}>;

export type ToolDefinition<TArgs> = Readonly<{
  name: string;
  description: string;
  targetPrefixes: string[];
  risk: RiskLevel;
  argsSchema: ZodType<TArgs>;
  execute: (args: TArgs, targetId: string | null, context: ToolExecutionContext) => Promise<ToolResult>;
}>;

type RegisteredTool = ToolDefinition<unknown>;

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  register<TArgs>(definition: ToolDefinition<TArgs>): void {
    if (this.#tools.has(definition.name)) throw new Error(`Tool already registered: ${definition.name}`);
    this.#tools.set(definition.name, definition as RegisteredTool);
  }

  describe(): ReadonlyArray<Readonly<{ name: string; description: string; targetPrefixes: string[]; risk: RiskLevel; argumentsSchema: Readonly<Record<string, unknown>> }>> {
    return [...this.#tools.values()].map(({ name, description, targetPrefixes, risk, argsSchema }) => ({
      name,
      description,
      targetPrefixes,
      risk,
      argumentsSchema: z.toJSONSchema(argsSchema, { target: "draft-07" }) as Readonly<Record<string, unknown>>
    }));
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  riskOf(name: string): RiskLevel | null {
    return this.#tools.get(name)?.risk ?? null;
  }

  validateAction(action: ToolAction, knownTargets: ReadonlySet<string>): void {
    const tool = this.#tools.get(action.tool);
    if (!tool) throw new PatchError("TOOL_UNAVAILABLE", `Tool is not registered: ${action.tool}`);
    if (action.risk !== tool.risk) throw new PatchError("VALIDATION_FAILED", `Risk mismatch for ${action.tool}`);
    if (tool.targetPrefixes.length > 0 && action.targetId === null) {
      throw new PatchError("TARGET_NOT_FOUND", `${action.tool} requires a grounded target.`);
    }
    if (action.targetId !== null) {
      if (!knownTargets.has(action.targetId)) throw new PatchError("TARGET_NOT_FOUND", `Unknown target: ${action.targetId}`);
      if (!tool.targetPrefixes.some((prefix) => action.targetId?.startsWith(prefix))) {
        throw new PatchError("VALIDATION_FAILED", `Target ${action.targetId} is incompatible with ${action.tool}`);
      }
    }
    tool.argsSchema.parse(action.arguments);
  }

  async execute(action: ToolAction, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.#tools.get(action.tool);
    if (!tool) throw new PatchError("TOOL_UNAVAILABLE", `Tool is not registered: ${action.tool}`);
    const args = tool.argsSchema.parse(action.arguments);
    return tool.execute(args, action.targetId, context);
  }
}
