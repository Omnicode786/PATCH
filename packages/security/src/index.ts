import type { PatchPlan, RiskLevel, ToolAction } from "@patch/schemas";
import { PatchError } from "@patch/shared";

export type PermissionName =
  | "captureScreen"
  | "readAccessibility"
  | "controlAccessibility"
  | "coordinateControl"
  | "modifyBrowser"
  | "controlPhotoshop"
  | "actionsWithoutConfirmation";

export type PermissionSnapshot = Readonly<Record<PermissionName, boolean>>;

const riskOrder: Readonly<Record<RiskLevel, number>> = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  SIDE_EFFECT: 2,
  DESTRUCTIVE: 3,
  SECURITY_SENSITIVE: 4
};

const permissionForTool = (tool: string): PermissionName | null => {
  if (tool === "screen.click") return "coordinateControl";
  if (tool.startsWith("windows.")) return "controlAccessibility";
  if (tool.startsWith("browser.")) return "modifyBrowser";
  if (tool.startsWith("photoshop.")) return "controlPhotoshop";
  return null;
};

export const actionRequiresConfirmation = (action: ToolAction, permissions: PermissionSnapshot): boolean => {
  if (!permissions.actionsWithoutConfirmation) return action.risk !== "READ_ONLY";
  return riskOrder[action.risk] >= riskOrder.SIDE_EFFECT;
};

export class PermissionEngine {
  validatePlan(plan: PatchPlan, permissions: PermissionSnapshot): Readonly<{ requiresConfirmation: boolean }> {
    if ((plan.requestClass === "QUESTION" || plan.requestClass === "EXPLANATION" || plan.requestClass === "AMBIGUOUS") && plan.actions.length > 0) {
      throw new PatchError("ACTION_DENIED", "Questions, explanations, and ambiguous requests cannot execute actions.");
    }
    if (plan.actions.length > 0 && plan.interpretation.confidence < 0.65) {
      throw new PatchError("AMBIGUOUS_TARGET", "PATCH will not execute a low-confidence action plan. Refresh context or clarify the target.");
    }

    let requiresConfirmation = plan.requiresConfirmation;
    for (const action of plan.actions) {
      const required = permissionForTool(action.tool);
      if (required && !permissions[required]) throw new PatchError("ACTION_DENIED", `${required} permission is disabled.`);
      requiresConfirmation ||= actionRequiresConfirmation(action, permissions);
    }
    return { requiresConfirmation };
  }
}

export const DEFAULT_PERMISSIONS: PermissionSnapshot = {
  captureScreen: true,
  readAccessibility: true,
  controlAccessibility: true,
  coordinateControl: false,
  modifyBrowser: true,
  controlPhotoshop: true,
  actionsWithoutConfirmation: false
};

export const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/(api.?key|authorization|password|secret|token)/i.test(key)) return [key, "[REDACTED]"];
      return [key, redactSecrets(item)];
    }));
  }
  return value;
};
