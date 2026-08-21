import type { Annotation, PatchPlan, Rectangle, VisualContext } from "@patch/schemas";
import { PatchPlanSchema } from "@patch/schemas";
import { PermissionEngine, DEFAULT_PERMISSIONS, type PermissionSnapshot } from "@patch/security";
import { PatchError } from "@patch/shared";
import type { PatchDatabase } from "@patch/persistence";
import type { PatchLogger } from "@patch/logging";
import { ToolRegistry, type ToolResult } from "@patch/tool-registry";
import type { ProviderManager } from "./provider-manager";
import { isTransientProviderFailure } from "./provider-fallback";
import type { ScreenCaptureService } from "./screen-capture";
import type { WindowsBridgeClient } from "./windows-bridge";
import type { BrowserBridgeServer, BrowserAgentStatus } from "./browser-bridge";
import { classifyRuntimeActionIntent, isBrowserProcessName, type RuntimeActionIntent } from "./action-intent";
import type { PhotoshopBridgeServer } from "./photoshop-bridge";

export type ContextMode = "app" | "screen";

export type InvocationBootstrap = Readonly<{
  sessionId: string;
  contextMode: ContextMode;
  captureId?: string;
  imageDataUrl?: string;
  displayBounds: Rectangle;
  activeApplication: VisualContext["activeApplication"];
}>;

type SessionState = Readonly<{
  sessionId: string;
  contextMode: ContextMode;
  captureId?: string;
  displayBounds: Rectangle;
  activeApplication: VisualContext["activeApplication"];
  createdAt: number;
}>;


type AvailableTools = ReturnType<ToolRegistry["describe"]>;

type InvocationContextBundle = Readonly<{
  visualContext: VisualContext;
  browserStatus: BrowserAgentStatus | null;
  browserContextError: string | null;
}>;

type PendingPlan = Readonly<{
  token: string;
  session: SessionState;
  plan: PatchPlan;
  context: VisualContext;
  expiresAt: number;
}>;

export type SubmitResult =
  | Readonly<{ kind: "answer"; text: string }>
  | Readonly<{ kind: "confirmation"; token: string; title: string; actions: string[] }>
  | Readonly<{ kind: "done"; text: string; verified: boolean }>;

const collectUiaTargets = (nodes: VisualContext["accessibilityContext"], output: Set<string>): void => {
  if (!nodes) return;
  const visit = (node: NonNullable<VisualContext["accessibilityContext"]>[number]): void => {
    output.add(node.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
};

const collectPhotoshopTargets = (layers: NonNullable<VisualContext["photoshopContext"]>["layers"], output: Set<string>): void => {
  const visit = (layer: NonNullable<VisualContext["photoshopContext"]>["layers"][number]): void => {
    output.add(layer.id);
    layer.children.forEach(visit);
  };
  layers.forEach(visit);
};

const targetIdsFromDsl = (value: unknown): string[] => {
  if (!value || typeof value !== "object" || !("patch" in value)) return [];
  const patch = value.patch;
  if (!patch || typeof patch !== "object" || !("operations" in patch) || !Array.isArray(patch.operations)) return [];
  const ids: string[] = [];
  for (const op of patch.operations) {
    if (!op || typeof op !== "object") continue;
    for (const [key, field] of Object.entries(op)) {
      if (["target", "destination", "parent"].includes(key) && typeof field === "string") ids.push(field);
      if (key === "targets" && Array.isArray(field)) for (const item of field) if (typeof item === "string") ids.push(item);
    }
  }
  return ids;
};

export class PatchOrchestrator {
  readonly #providers: ProviderManager;
  readonly #capture: ScreenCaptureService;
  readonly #windows: WindowsBridgeClient;
  readonly #browser: BrowserBridgeServer;
  readonly #photoshop: PhotoshopBridgeServer;
  readonly #db: PatchDatabase;
  readonly #logger: PatchLogger;
  readonly #tools: ToolRegistry;
  readonly #permissions = new PermissionEngine();
  readonly #sessions = new Map<string, SessionState>();
  readonly #pending = new Map<string, PendingPlan>();

  constructor(deps: Readonly<{
    providers: ProviderManager;
    capture: ScreenCaptureService;
    windows: WindowsBridgeClient;
    browser: BrowserBridgeServer;
    photoshop: PhotoshopBridgeServer;
    db: PatchDatabase;
    logger: PatchLogger;
    tools: ToolRegistry;
  }>) {
    this.#providers = deps.providers;
    this.#capture = deps.capture;
    this.#windows = deps.windows;
    this.#browser = deps.browser;
    this.#photoshop = deps.photoshop;
    this.#db = deps.db;
    this.#logger = deps.logger;
    this.#tools = deps.tools;
  }

  #permissionSnapshot(): PermissionSnapshot {
    const names = Object.keys(DEFAULT_PERMISSIONS) as Array<keyof PermissionSnapshot>;
    return Object.fromEntries(names.map((name) => [name, this.#db.getPermission(name) ?? DEFAULT_PERMISSIONS[name]])) as PermissionSnapshot;
  }

  async #createInvocationFor(activeApplication: VisualContext["activeApplication"], contextMode: ContextMode): Promise<InvocationBootstrap> {
    const fallbackBounds: Rectangle = activeApplication.bounds && activeApplication.bounds.width > 0 && activeApplication.bounds.height > 0
      ? activeApplication.bounds
      : { x: 0, y: 0, width: 960, height: 720 };
    const sessionId = crypto.randomUUID();

    if (contextMode === "screen") {
      const permissions = this.#permissionSnapshot();
      if (!permissions.captureScreen) throw new PatchError("ACTION_DENIED", "Screen capture permission is disabled.");
      const capture = await this.#capture.capture(activeApplication.bounds);
      const state: SessionState = { sessionId, contextMode, captureId: capture.id, displayBounds: capture.displayBounds, activeApplication, createdAt: Date.now() };
      this.#sessions.set(sessionId, state);
      await this.#logger.info("patch.session.created", { sessionId, contextMode, processName: activeApplication.processName, captureWidth: capture.image.width, captureHeight: capture.image.height });
      return { sessionId, contextMode, captureId: capture.id, displayBounds: capture.displayBounds, activeApplication, imageDataUrl: `data:${capture.image.mimeType};base64,${capture.image.dataBase64}` };
    }

    const state: SessionState = { sessionId, contextMode, displayBounds: fallbackBounds, activeApplication, createdAt: Date.now() };
    this.#sessions.set(sessionId, state);
    await this.#logger.info("patch.session.created", { sessionId, contextMode, processName: activeApplication.processName, screenshotShared: false });
    return { sessionId, contextMode, displayBounds: fallbackBounds, activeApplication };
  }

  async createInvocation(contextMode: ContextMode = "app"): Promise<InvocationBootstrap> {
    let activeApplication: VisualContext["activeApplication"] = {};
    try { activeApplication = await this.#windows.getActiveWindow(); } catch { activeApplication = {}; }
    return this.#createInvocationFor(activeApplication, contextMode);
  }

  async switchInvocation(sessionId: string, contextMode: ContextMode): Promise<InvocationBootstrap> {
    const current = this.#sessions.get(sessionId);
    if (!current) throw new PatchError("VALIDATION_FAILED", "PATCH session is no longer active.");
    if (current.contextMode === contextMode) {
      const image = current.captureId ? this.#capture.get(current.captureId) : undefined;
      return { sessionId: current.sessionId, contextMode, ...(current.captureId ? { captureId: current.captureId } : {}), displayBounds: current.displayBounds, activeApplication: current.activeApplication, ...(image ? { imageDataUrl: `data:${image.mimeType};base64,${image.dataBase64}` } : {}) };
    }
    const next = await this.#createInvocationFor(current.activeApplication, contextMode);
    this.#finishSession(sessionId);
    return next;
  }

  async #context(session: SessionState, annotations: Annotation[]): Promise<InvocationContextBundle> {
    const permissions = this.#permissionSnapshot();
    const fullScreenImage = session.captureId ? this.#capture.get(session.captureId) : undefined;
    if (session.contextMode === "screen" && !fullScreenImage) throw new PatchError("SCREEN_CAPTURE_DENIED", "Capture expired before the request was processed.");
    const groundedAnnotations = session.captureId ? annotations : [];
    const rectangle = groundedAnnotations.find((annotation): annotation is Extract<Annotation, { kind: "rectangle" }> => annotation.kind === "rectangle");
    const selectedCrop = rectangle && session.captureId ? this.#capture.crop(session.captureId, {
      x: session.displayBounds.x + rectangle.bounds.x,
      y: session.displayBounds.y + rectangle.bounds.y,
      width: rectangle.bounds.width,
      height: rectangle.bounds.height
    }) : undefined;

    let accessibilityContext: VisualContext["accessibilityContext"];
    if (permissions.readAccessibility) {
      try { accessibilityContext = await this.#windows.getAccessibilityTree(7, 1200, session.activeApplication.nativeWindowHandle); } catch { accessibilityContext = undefined; }
    }

    let browserStatus: BrowserAgentStatus | null = null;
    let browserContext: VisualContext["browserContext"];
    let browserContextError: string | null = null;
    const processName = session.activeApplication.processName?.toLowerCase() ?? "";

    // Browser adapter health is safe/read-only and is useful diagnostically even
    // when the preserved foreground process is not a browser. Semantic DOM is
    // acquired ONLY when the original invocation target is actually Chrome/Edge/
    // Brave/Chromium, preserving PATCH's application-routing security boundary.
    try { browserStatus = await this.#browser.getStatus(); }
    catch (error: unknown) {
      browserStatus = null;
      browserContextError = error instanceof Error ? error.message : "PATCH could not query browser adapter health.";
    }

    if (isBrowserProcessName(processName) && browserStatus) {
      if (browserStatus.nativeBridgeConnected && browserStatus.protocolCompatible && browserStatus.activeTabAvailable && browserStatus.contentReachable && browserStatus.domContextAvailable) {
        try {
          browserContext = await this.#browser.getContext();
          if (browserContext.elements.length === 0) {
            browserContext = undefined;
            browserContextError = "The PATCH content adapter returned an empty semantic DOM.";
            browserStatus = {
              ...browserStatus,
              domContextAvailable: false,
              mutationCapabilityAvailable: false,
              failureCode: "BROWSER_CONTEXT_EMPTY",
              failureMessage: browserContextError
            };
          }
        } catch (error: unknown) {
          browserContext = undefined;
          browserContextError = error instanceof Error ? error.message : "PATCH could not acquire semantic browser context.";
          browserStatus = {
            ...browserStatus,
            domContextAvailable: false,
            mutationCapabilityAvailable: false,
            failureCode: error instanceof PatchError ? error.code : "BROWSER_CONTEXT_EMPTY",
            failureMessage: browserContextError
          };
        }
      } else {
        browserContextError = browserStatus.failureMessage ?? null;
      }
    } else if (!isBrowserProcessName(processName) && browserStatus?.nativeBridgeConnected) {
      browserContextError = `Browser adapter is connected, but the preserved invocation target is ${session.activeApplication.processName ?? "unknown"}, not a Chromium browser.`;
    }

    let photoshopContext: VisualContext["photoshopContext"];
    if (this.#photoshop.connected && /photoshop/.test(processName)) {
      try { photoshopContext = await this.#photoshop.getContext(); } catch { photoshopContext = undefined; }
    }

    const visualContext: VisualContext = {
      ...(fullScreenImage ? { fullScreenImage } : {}),
      ...(selectedCrop ? { selectedCrop } : {}),
      annotations: groundedAnnotations,
      ...(fullScreenImage ? { captureDisplayBounds: session.displayBounds } : {}),
      activeApplication: session.activeApplication,
      ...(accessibilityContext ? { accessibilityContext } : {}),
      ...(browserContext ? { browserContext } : {}),
      ...(photoshopContext ? { photoshopContext } : {})
    };
    return { visualContext, browserStatus, browserContextError };
  }

  #knownTargets(context: VisualContext): Set<string> {
    const targets = new Set<string>(context.annotations.map((item) => item.id));
    collectUiaTargets(context.accessibilityContext, targets);
    context.browserContext?.elements.forEach((element) => targets.add(element.id));
    if (context.photoshopContext) collectPhotoshopTargets(context.photoshopContext.layers, targets);
    return targets;
  }

  #availableTools(context: VisualContext) {
    const permissions = this.#permissionSnapshot();
    return this.#tools.describe().filter((tool) => {
      if (tool.name.startsWith("browser.")) return Boolean(context.browserContext);
      if (tool.name.startsWith("photoshop.")) return Boolean(context.photoshopContext);
      if (tool.name.startsWith("windows.")) return Boolean(context.accessibilityContext);
      if (tool.name.startsWith("screen.")) return permissions.coordinateControl && context.annotations.length > 0;
      return true;
    });
  }

  async #logInvocationDiagnostics(session: SessionState, intent: RuntimeActionIntent, bundle: InvocationContextBundle, availableTools: AvailableTools): Promise<void> {
    const browser = bundle.browserStatus;
    await this.#logger.info("patch.invocation.capabilities", {
      sessionId: session.sessionId,
      activeProcess: session.activeApplication.processName ?? null,
      originalWindowTitle: session.activeApplication.windowTitle ?? null,
      nativeWindowHandle: session.activeApplication.nativeWindowHandle ?? null,
      chromeAdapterConnected: browser?.nativeBridgeConnected ?? false,
      activeBrowserTabAvailable: browser?.activeTabAvailable ?? false,
      browserContentReachable: browser?.contentReachable ?? false,
      browserContextReceived: Boolean(bundle.visualContext.browserContext),
      observedDomNodeCount: bundle.visualContext.browserContext?.elements.length ?? 0,
      targetRegistryCount: this.#knownTargets(bundle.visualContext).size,
      registeredTools: this.#tools.describe().map((tool) => tool.name),
      eligibleTools: availableTools.map((tool) => tool.name),
      browserGetContextAvailable: Boolean(bundle.visualContext.browserContext),
      browserApplyPatchAvailable: availableTools.some((tool) => tool.name === "browser.applyPatch"),
      browserRestorePatchAvailable: availableTools.some((tool) => tool.name === "browser.restorePatch"),
      requestedCapability: intent.requestedCapability,
      intentActionable: intent.actionable,
      intentClass: intent.requestClass,
      intentReason: intent.reason,
      browserFailureCode: browser?.failureCode ?? null,
      browserFailureMessage: bundle.browserContextError ? bundle.browserContextError.slice(0, 240) : browser?.failureMessage?.slice(0, 240) ?? null
    });
  }

  #assertWebPatchCapability(intent: RuntimeActionIntent, bundle: InvocationContextBundle, availableTools: AvailableTools): void {
    if (!(intent.actionable && intent.requestClass === "WEB_PATCH")) return;
    const status = bundle.browserStatus;
    if (!status?.nativeBridgeConnected) throw new PatchError("BROWSER_ADAPTER_NOT_CONNECTED", "PATCH can see Chrome, but the PATCH browser adapter is not connected. Reconnect/reload the PATCH extension and native host.", { stage: "BROWSER_ADAPTER_NOT_CONNECTED" });
    if (!status.protocolCompatible) throw new PatchError("PROTOCOL_MISMATCH", status.failureMessage ?? "The PATCH desktop and browser extension protocol versions do not match.", { stage: "PROTOCOL_MISMATCH" });
    if (!status.activeTabAvailable) throw new PatchError("ACTIVE_TAB_NOT_AVAILABLE", "PATCH can see Chrome, but no active browser tab is reachable through the PATCH adapter.", { stage: "ACTIVE_TAB_NOT_AVAILABLE" });
    if (!status.contentReachable) throw new PatchError("BROWSER_CONTEXT_EMPTY", status.failureMessage ?? "PATCH can see Chrome, but the content adapter is not connected to this tab. Reload the tab or extension.", { stage: "BROWSER_CONTEXT_EMPTY" });
    if (!status.domContextAvailable || !bundle.visualContext.browserContext || bundle.visualContext.browserContext.elements.length === 0) throw new PatchError("BROWSER_CONTEXT_EMPTY", bundle.browserContextError ?? "PATCH reached the tab, but semantic DOM context is unavailable.", { stage: "BROWSER_CONTEXT_EMPTY" });
    if (!status.mutationCapabilityAvailable) throw new PatchError("TOOL_NOT_ELIGIBLE", "PATCH can observe this tab, but live browser mutation is not available from the connected content adapter.", { stage: "TOOL_NOT_ELIGIBLE", tool: "browser.applyPatch" });
    if (!availableTools.some((tool) => tool.name === "browser.applyPatch")) throw new PatchError("TOOL_NOT_ELIGIBLE", "browser.applyPatch is registered but was removed from this invocation before planning.", { stage: "TOOL_NOT_ELIGIBLE", tool: "browser.applyPatch" });
  }

  #validatePlan(planInput: PatchPlan, context: VisualContext): Readonly<{ plan: PatchPlan; requiresConfirmation: boolean }> {
    const plan = PatchPlanSchema.parse(planInput);
    const knownTargets = this.#knownTargets(context);
    for (const action of plan.actions) {
      this.#tools.validateAction(action, knownTargets);
      if (action.tool === "browser.applyPatch" || action.tool === "browser.savePatch") {
        const allowed = new Set(knownTargets);
        for (const id of targetIdsFromDsl(action.arguments)) {
          if (id.startsWith("patch-container-")) continue;
          if (!allowed.has(id)) throw new PatchError("TARGET_NOT_FOUND", `Website plan references unknown DOM target ${id}`);
        }
      }
      if (action.tool === "browser.restorePatch") {
        const patchId = action.arguments.patchId;
        if (typeof patchId !== "string" || !context.browserContext?.patchIds.includes(patchId)) {
          throw new PatchError("TARGET_NOT_FOUND", "Website restore references a patch that is not active on the current page.");
        }
      }
    }
    const policy = this.#permissions.validatePlan(plan, this.#permissionSnapshot());
    return { plan, requiresConfirmation: policy.requiresConfirmation };
  }

  async #withProviderFallback<T>(role: "vision" | "reasoning", operation: (candidate: Awaited<ReturnType<ProviderManager["resolveCandidates"]>>[number]) => Promise<T>): Promise<T> {
    const candidates = await this.#providers.resolveCandidates(role);
    let lastError: unknown = null;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate) continue;
      try { return await operation(candidate); }
      catch (error: unknown) {
        lastError = error;
        if (!isTransientProviderFailure(error) || index === candidates.length - 1) throw error;
        await this.#logger.warn("patch.provider.fallback", { role, from: candidate.providerId, errorCode: error instanceof PatchError ? error.code : "unknown" });
      }
    }
    throw lastError instanceof Error ? lastError : new PatchError("AI_PROVIDER_UNAVAILABLE", "No configured provider completed the request.");
  }

  async submit(sessionId: string, prompt: string, annotations: Annotation[]): Promise<SubmitResult> {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new PatchError("VALIDATION_FAILED", "PATCH session is no longer active.");
    if (!prompt.trim()) throw new PatchError("VALIDATION_FAILED", "Enter a request for PATCH.");

    const intent = classifyRuntimeActionIntent(prompt, session.activeApplication);
    const bundle = await this.#context(session, annotations);
    const context = bundle.visualContext;
    const availableTools = this.#availableTools(context);
    await this.#logInvocationDiagnostics(session, intent, bundle, availableTools);
    this.#assertWebPatchCapability(intent, bundle, availableTools);

    const runtimeDirective = intent.actionable && intent.requestClass === "WEB_PATCH"
      ? "PATCH runtime has classified this as an actionable live WEB_PATCH. The current PATCH browser adapter is already selected and browser.applyPatch is invocation-eligible. Return a grounded WEB_PATCH using browser.applyPatch and observed dom-* targets. Never ask the user which PATCH Chrome extension/adapter is meant and never substitute DevTools/source-code instructions. If the requested DOM target itself is genuinely ambiguous, return AMBIGUOUS with a target clarification only."
      : undefined;

    let plan: PatchPlan;
    try {
      plan = await this.#withProviderFallback("reasoning", async (reasoning) => {
        await this.#logger.info("patch.planner.request", {
          sessionId, provider: reasoning.providerId, model: reasoning.model, runtimeMode: intent.requestClass ?? "CONVERSATION",
          plannerToolCount: availableTools.length, plannerToolNames: availableTools.map((tool) => tool.name),
          browserApplyPatchAvailable: availableTools.some((tool) => tool.name === "browser.applyPatch")
        });
        return reasoning.provider.planActions({
          prompt, context, model: reasoning.model, availableTools,
          runtimeMode: intent.requestClass ?? "CONVERSATION",
          ...(runtimeDirective ? { runtimeDirective } : {})
        });
      });
    } catch (error: unknown) {
      if (intent.actionable) {
        await this.#logger.error("patch.planner.actionable_failed", { sessionId, stage: "PLANNER_DID_NOT_RETURN_ACTION", errorCode: error instanceof PatchError ? error.code : "unknown" });
        throw error;
      }
      const safeReadOnlyFallback = error instanceof PatchError && new Set([
        "AI_PROVIDER_INVALID_REQUEST", "AI_PROVIDER_UNSUPPORTED_MODEL", "AI_PROVIDER_UNSUPPORTED_CAPABILITY", "VALIDATION_FAILED"
      ]).has(error.code);
      if (!safeReadOnlyFallback) throw error;
      await this.#logger.warn("patch.plan.degraded_to_readonly", { sessionId, errorCode: error.code });
      const analysis = await this.#withProviderFallback("vision", (vision) => vision.provider.analyzeContext({ prompt, context, model: vision.model }));
      return { kind: "answer", text: analysis.answer };
    }

    if (intent.actionable && intent.requestClass === "WEB_PATCH") {
      const adapterClarification = plan.requestClass === "AMBIGUOUS" && /(?:which|what).{0,40}(?:extension|adapter)|chrome extension adapter/i.test(plan.expectedOutcome);
      if (adapterClarification) {
        throw new PatchError("PLANNER_DID_NOT_RETURN_ACTION", "The planner asked the user to identify PATCH's own Chrome adapter even though exactly one runtime browser adapter is already selected.", { stage: "PLANNER_DID_NOT_RETURN_ACTION" });
      }
      if (plan.requestClass === "QUESTION" || plan.requestClass === "EXPLANATION" || plan.actions.length === 0) {
        throw new PatchError("PLANNER_DID_NOT_RETURN_ACTION", "PATCH identified a live browser action, but the planner did not return an executable browser action. No manual DevTools fallback was used.", { stage: "PLANNER_DID_NOT_RETURN_ACTION" });
      }
      if (plan.requestClass !== "AMBIGUOUS" && !plan.actions.some((action) => action.tool === "browser.applyPatch")) {
        throw new PatchError("PLANNER_DID_NOT_RETURN_ACTION", "PATCH identified a WEB_PATCH, but the returned plan did not use browser.applyPatch.", { stage: "PLANNER_DID_NOT_RETURN_ACTION", returnedTools: plan.actions.map((action) => action.tool) });
      }
      if (plan.actions.some((action) => !action.tool.startsWith("browser."))) {
        throw new PatchError("PLAN_VALIDATION_FAILED", "A deterministic browser adapter is available, so PATCH will not silently downgrade this WEB_PATCH to Windows or coordinate mutation tools.", { stage: "PLAN_VALIDATION_FAILED", returnedTools: plan.actions.map((action) => action.tool) });
      }
    }

    const validated = this.#validatePlan(plan, context);
    await this.#logger.info("patch.plan.validated", { sessionId, requestClass: plan.requestClass, actionCount: plan.actions.length, actionTools: plan.actions.map((action) => action.tool), requiresConfirmation: validated.requiresConfirmation });

    if (plan.requestClass === "AMBIGUOUS") return { kind: "answer", text: plan.expectedOutcome };
    if (plan.requestClass === "QUESTION" || plan.requestClass === "EXPLANATION" || plan.actions.length === 0) {
      const analysis = await this.#withProviderFallback("vision", (vision) => vision.provider.analyzeContext({ prompt, context, model: vision.model }));
      return { kind: "answer", text: analysis.answer };
    }

    if (validated.requiresConfirmation) {
      const token = crypto.randomUUID();
      this.#pending.set(token, { token, session, plan, context, expiresAt: Date.now() + 120_000 });
      return { kind: "confirmation", token, title: plan.interpretation.goal, actions: plan.actions.map((action) => `${action.tool}: ${action.expectedOutcome}`) };
    }

    return this.#execute(session, plan, context);
  }

  discardSession(sessionId: string): void {
    this.#finishSession(sessionId);
  }

  async confirm(token: string): Promise<SubmitResult> {
    const pending = this.#pending.get(token);
    if (!pending) throw new PatchError("VALIDATION_FAILED", "Confirmation expired or is invalid.");
    this.#pending.delete(token);
    if (Date.now() > pending.expiresAt) {
      this.#finishSession(pending.session.sessionId);
      throw new PatchError("VALIDATION_FAILED", "Confirmation expired. Invoke PATCH again to refresh system state.");
    }
    return this.#execute(pending.session, pending.plan, pending.context);
  }

  cancel(token: string): void {
    const pending = this.#pending.get(token);
    if (!pending) return;
    this.#pending.delete(token);
    this.#finishSession(pending.session.sessionId);
  }

  async #execute(session: SessionState, plan: PatchPlan, context: VisualContext): Promise<SubmitResult> {
    const knownTargets = this.#knownTargets(context);
    for (const action of plan.actions) this.#tools.validateAction(action, knownTargets);
    const controller = new AbortController();
    const results: ToolResult[] = [];
    try {
      for (const action of plan.actions) {
        const started = performance.now();
        const result = await this.#tools.execute(action, { sessionId: session.sessionId, signal: controller.signal, visualContext: context });
        results.push(result);
        await this.#logger.info("patch.action.executed", { sessionId: session.sessionId, tool: action.tool, verified: result.verified, durationMs: Math.round(performance.now() - started) });
        if (result.changed && !result.verified) {
          this.#finishSession(session.sessionId);
          return { kind: "done", verified: false, text: "PATCH ran the action, but could not verify the expected state. No further actions were executed." };
        }
      }
      const verified = results.every((result) => !result.changed || result.verified);
      this.#finishSession(session.sessionId);
      return { kind: "done", verified, text: verified ? plan.expectedOutcome : "PATCH completed the low-confidence fallback action, but the resulting state was not deterministically verifiable." };
    } catch (error: unknown) {
      controller.abort();
      await this.#logger.error("patch.action.failed", { sessionId: session.sessionId, completedActions: results.length, message: error instanceof Error ? error.message.slice(0, 220) : "unknown" });
      this.#finishSession(session.sessionId);
      throw error;
    }
  }

  #finishSession(sessionId: string): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    // Confirmation tokens must never outlive their grounded screen session.
    for (const [token, pending] of this.#pending) {
      if (pending.session.sessionId === sessionId) this.#pending.delete(token);
    }
    if (session.captureId) {
      const deleteCapture = this.#db.getSetting("deleteScreenshotsAfterRequest", true);
      if (deleteCapture) this.#capture.release(session.captureId);
      else this.#capture.releaseLater(session.captureId);
    }
    this.#sessions.delete(sessionId);
  }
}
