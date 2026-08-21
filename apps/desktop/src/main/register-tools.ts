import { z } from "zod";
import { SavedPatchSchema, WebsitePatchSchema } from "@patch/patch-dsl";
import type { PatchDatabase } from "@patch/persistence";
import type { ToolRegistry } from "@patch/tool-registry";
import type { BrowserBridgeServer } from "./browser-bridge";
import type { PhotoshopBridgeServer } from "./photoshop-bridge";
import type { WindowsBridgeClient } from "./windows-bridge";

const EmptySchema = z.object({}).strict();

export const registerRuntimeTools = (
  registry: ToolRegistry,
  windows: WindowsBridgeClient,
  browser: BrowserBridgeServer,
  photoshop: PhotoshopBridgeServer,
  db: PatchDatabase
): void => {
  registry.register({
    name: "windows.invoke",
    description: "Invoke a UI Automation element that exposes InvokePattern.",
    targetPrefixes: ["uia-"],
    risk: "SIDE_EFFECT",
    argsSchema: EmptySchema,
    execute: async (args, targetId) => {
      const result = await windows.execute("windows.invoke", targetId, args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? "UI element invoked and verified." : "UI element invoked but verification was inconclusive.", observation: result };
    }
  });

  registry.register({
    name: "windows.toggle",
    description: "Set a TogglePattern control to the requested state and verify it by querying the control again.",
    targetPrefixes: ["uia-"],
    risk: "REVERSIBLE",
    argsSchema: z.object({ state: z.enum(["On", "Off"]) }).strict(),
    execute: async (args, targetId) => {
      const result = await windows.execute("windows.toggle", targetId, args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? `Control is ${args.state}.` : `Attempted to set control ${args.state}; verification failed.`, observation: result };
    }
  });

  registry.register({
    name: "windows.setValue",
    description: "Set a UI Automation ValuePattern control and verify the resulting value.",
    targetPrefixes: ["uia-"],
    risk: "REVERSIBLE",
    argsSchema: z.object({ value: z.string().max(10000) }).strict(),
    execute: async (args, targetId) => {
      const result = await windows.execute("windows.setValue", targetId, args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? "Value set and verified." : "Value set attempt could not be verified.", observation: result };
    }
  });

  registry.register({
    name: "windows.select",
    description: "Select an item that exposes SelectionItemPattern and verify selection state.",
    targetPrefixes: ["uia-"],
    risk: "REVERSIBLE",
    argsSchema: EmptySchema,
    execute: async (args, targetId) => {
      const result = await windows.execute("windows.select", targetId, args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? "Item selected and verified." : "Selection could not be verified.", observation: result };
    }
  });

  registry.register({
    name: "windows.scroll",
    description: "Scroll a UI Automation container using ScrollPattern and verify movement or a scroll boundary.",
    targetPrefixes: ["uia-"],
    risk: "REVERSIBLE",
    argsSchema: z.object({ horizontal: z.enum(["NoAmount", "LargeDecrement", "SmallDecrement", "SmallIncrement", "LargeIncrement"]).default("NoAmount"), vertical: z.enum(["NoAmount", "LargeDecrement", "SmallDecrement", "SmallIncrement", "LargeIncrement"]).default("SmallIncrement") }).strict(),
    execute: async (args, targetId) => {
      const result = await windows.execute("windows.scroll", targetId, args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? "Scroll completed and verified." : "Scroll was attempted but could not be verified.", observation: result };
    }
  });

  registry.register({
    name: "screen.click",
    description: "Low-confidence visual fallback: click a point derived by PATCH from a real user annotation after confirmation. The model cannot supply coordinates.",
    targetPrefixes: ["annotation-"],
    risk: "SIDE_EFFECT",
    argsSchema: EmptySchema,
    execute: async (_args, targetId, context) => {
      const annotation = context.visualContext.annotations.find((item) => item.id === targetId);
      const display = context.visualContext.captureDisplayBounds;
      if (!annotation || !display) throw new Error("Grounded annotation/display context is unavailable for coordinate fallback.");
      let point: Readonly<{ x: number; y: number }>;
      if (annotation.kind === "rectangle") {
        point = { x: annotation.bounds.x + annotation.bounds.width / 2, y: annotation.bounds.y + annotation.bounds.height / 2 };
      } else if (annotation.kind === "arrow") {
        point = annotation.to;
      } else {
        const xs = annotation.points.map((item) => item.x);
        const ys = annotation.points.map((item) => item.y);
        point = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
      }
      const coordinates = { x: display.x + point.x, y: display.y + point.y };
      const result = await windows.execute("screen.click", targetId, coordinates);
      return { changed: true, verified: false, summary: "Grounded annotation click executed; resulting state requires visual re-observation.", observation: result };
    }
  });

  registry.register({
    name: "browser.applyPatch",
    description: "Change the current webpage live through the connected Chrome/Edge content adapter using the restricted declarative PATCH DSL. Use for hide/remove/simplify/rearrange/resize/restyle requests instead of returning DevTools or source-code instructions; never executes model JavaScript.",
    targetPrefixes: [],
    risk: "REVERSIBLE",
    argsSchema: z.object({ patch: WebsitePatchSchema }).strict(),
    execute: async (args) => {
      const applied = await browser.request("browser.applyPatch", { patch: args.patch });
      const patchId = applied && typeof applied === "object" && "patchId" in applied && typeof applied.patchId === "string" ? applied.patchId : null;
      if (!patchId) return { changed: true, verified: false, summary: "Website transformation was sent, but the browser adapter did not return a patch ID for verification.", observation: applied };

      await new Promise((resolve) => setTimeout(resolve, 300));
      const verification = await browser.request("browser.verifyPatch", { patchId }, 6000);
      const verified = Boolean(verification && typeof verification === "object" && "verified" in verification && verification.verified === true);
      let postContext: unknown = null;
      try { postContext = await browser.getContext(); } catch { postContext = null; }
      return {
        changed: true,
        verified,
        summary: verified ? "Website transformation applied and verified on the live DOM." : "Website transformation executed, but post-state verification failed.",
        observation: { applied, verification, postContext },
        undoToken: patchId
      };
    }
  });

  registry.register({
    name: "browser.restorePatch",
    description: "Restore DOM and style changes previously applied by PATCH.",
    targetPrefixes: [],
    risk: "REVERSIBLE",
    argsSchema: z.object({ patchId: z.string().min(1) }).strict(),
    execute: async (args) => {
      const result = await browser.request("browser.restorePatch", args);
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true && "restored" in result && result.restored === true);
      return { changed: verified, verified, summary: verified ? "Website patch restored." : "Website patch was not active, so nothing was restored.", observation: result };
    }
  });

  registry.register({
    name: "browser.savePatch",
    description: "Persist a restricted live-page PATCH for the current domain/path and reapply it after navigation or rerender.",
    targetPrefixes: [],
    risk: "REVERSIBLE",
    argsSchema: z.object({ patch: WebsitePatchSchema, name: z.string().min(1).max(120), pathPattern: z.string().min(1).max(500).optional() }).strict(),
    execute: async (args) => {
      const result = await browser.request("browser.savePatch", args);
      const saved = SavedPatchSchema.parse(result);
      db.upsertSavedPatch({ id: saved.id, name: saved.name, domain: saved.domain, pathPattern: saved.pathPattern, dslJson: JSON.stringify(saved), createdAt: saved.createdAt, lastAppliedAt: saved.lastAppliedAt, enabled: saved.enabled });
      return { changed: true, verified: true, summary: `Saved website PATCH for ${saved.domain}.`, observation: saved, undoToken: saved.id };
    }
  });

  registry.register({
    name: "browser.highlight",
    description: "Temporarily highlight a discovered DOM target.",
    targetPrefixes: ["dom-"],
    risk: "REVERSIBLE",
    argsSchema: EmptySchema,
    execute: async (args, targetId) => {
      const result = await browser.request("browser.highlight", { targetId, ...args });
      const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
      return { changed: true, verified, summary: verified ? "DOM target highlighted." : "Highlight request could not be verified.", observation: result };
    }
  });

  const photoshopMutation = async (method: string, args: Readonly<Record<string, unknown>>, targetId: string | null, successSummary: string) => {
    const result = await photoshop.request(method, { targetId, ...args });
    const verified = Boolean(result && typeof result === "object" && "verified" in result && result.verified === true);
    return { changed: true, verified, summary: verified ? successSummary : `${successSummary} Verification failed.`, observation: result };
  };
  registry.register({ name: "photoshop.selectLayer", description: "Select a discovered Photoshop layer.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: EmptySchema, execute: async (args, targetId) => photoshopMutation("photoshop.selectLayer", args, targetId, "Layer selected and verified.") });
  registry.register({ name: "photoshop.duplicateLayer", description: "Duplicate a discovered Photoshop layer.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: EmptySchema, execute: async (args, targetId) => photoshopMutation("photoshop.duplicateLayer", args, targetId, "Layer duplicated and verified.") });
  registry.register({ name: "photoshop.moveLayer", description: "Translate a discovered Photoshop layer by pixel offsets.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: z.object({ deltaX: z.number().finite(), deltaY: z.number().finite() }).strict(), execute: async (args, targetId) => photoshopMutation("photoshop.moveLayer", args, targetId, "Layer moved and verified.") });
  registry.register({ name: "photoshop.resizeLayer", description: "Scale a discovered Photoshop layer by percentages.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: z.object({ widthPercent: z.number().positive().max(1000), heightPercent: z.number().positive().max(1000) }).strict(), execute: async (args, targetId) => photoshopMutation("photoshop.resizeLayer", args, targetId, "Layer resized and verified.") });
  registry.register({ name: "photoshop.setOpacity", description: "Set layer opacity from 0 to 100 percent.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: z.object({ opacity: z.number().min(0).max(100) }).strict(), execute: async (args, targetId) => photoshopMutation("photoshop.setOpacity", args, targetId, `Opacity set to ${args.opacity}% and verified.`) });
  registry.register({ name: "photoshop.setBlendMode", description: "Set a supported Photoshop layer blend mode.", targetPrefixes: ["ps-layer-"], risk: "REVERSIBLE", argsSchema: z.object({ blendMode: z.string().min(1).max(80) }).strict(), execute: async (args, targetId) => photoshopMutation("photoshop.setBlendMode", args, targetId, "Blend mode changed and verified.") });
};
