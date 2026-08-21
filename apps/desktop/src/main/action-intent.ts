import type { VisualContext } from "@patch/schemas";

export type RuntimeActionIntent = Readonly<{
  actionable: boolean;
  requestClass: "WEB_PATCH" | "APPLICATION_ACTION" | null;
  requestedCapability: string | null;
  reason: string;
}>;

const browserProcess = (processName?: string): boolean => /(?:^|\\)(?:chrome|msedge|brave|chromium)(?:\.exe)?$/i.test(processName ?? "") || /(?:chrome|msedge|brave|chromium)/i.test(processName ?? "");
const webMutation = /\b(hide|remove|simplif(?:y|ied)|rearrange|resize|restyle|move|reorder|collapse|show|wid(?:en|er)|narrow(?:er)?|larger|smaller|expand|shrink|reduce|declutter|clean\s*up|make\s+(?:this|the)\s+(?:page|site|website)|get\s+rid\s+of)\b/i;
const browserObject = /\b(page|website|site|sidebar|column|recommendations?|navigation|nav|section|panel|article|video|layout|content|header|footer|menu|element|this|that)\b/i;
const explanationOnly = /^(?:please\s+)?(?:explain|tell\s+me\s+how|show\s+me\s+how|how\s+(?:do|can|would|should)\s+i|what\s+(?:is|are)|why\s+)/i;

export const classifyRuntimeActionIntent = (
  prompt: string,
  activeApplication: VisualContext["activeApplication"]
): RuntimeActionIntent => {
  const text = prompt.trim();
  if (!text) return { actionable: false, requestClass: null, requestedCapability: null, reason: "empty_prompt" };

  const chrome = browserProcess(activeApplication.processName);
  const mutation = webMutation.test(text);
  const pageLike = browserObject.test(text);
  const asksHow = explanationOnly.test(text) && !/\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:hide|remove|simplify|rearrange|resize|restyle|move|reorder|collapse|show|widen|wider|narrow|narrower|larger|smaller|expand|shrink|reduce)\b/i.test(text);

  if (chrome && mutation && pageLike && !asksHow) {
    return {
      actionable: true,
      requestClass: "WEB_PATCH",
      requestedCapability: "browser.applyPatch",
      reason: "imperative_browser_mutation"
    };
  }

  return { actionable: false, requestClass: null, requestedCapability: null, reason: asksHow ? "informational_browser_question" : "no_runtime_action_match" };
};

export const isBrowserProcessName = browserProcess;
