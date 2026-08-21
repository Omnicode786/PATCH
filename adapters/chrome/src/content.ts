import "./chrome-types";
import { WebsitePatchSchema, type PatchOperation, type SavedLocator, type SavedPatch, type WebsitePatch } from "@patch/patch-dsl";

const elementIds = new WeakMap<Element, string>();
const idElements = new Map<string, Element>();
const activeUndo = new Map<string, UndoState>();
const persistentPatchIds = new Set<string>();
let nextElementId = 1;
let mutationTimer: ReturnType<typeof setTimeout> | null = null;
let suppressObserver = false;

type UndoState = {
  operations: PatchOperation[];
  locators: Map<string, SavedLocator>;
  pageKey: string;
  original: Map<
    Element,
    Readonly<{
      style: string | null;
      hiddenAttribute: string | null;
      parent: Node | null;
      nextSibling: Node | null;
    }>
  >;
  created: Set<Element>;
  containers: Map<string, HTMLElement>;
};

type SerializedElement = Readonly<{
  id: string;
  parentId?: string;
  tag: string;
  role?: string;
  text: string;
  name?: string;
  interactive: boolean;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  attributes: Readonly<Record<string, string>>;
}>;

function patchId(element: Element): string {
  let id = elementIds.get(element);
  if (!id) {
    id = `dom-${nextElementId++}`;
    elementIds.set(element, id);
  }
  idElements.set(id, element);
  return id;
}

function visibleText(element: Element): string {
  if (isSensitive(element)) return "";
  const aria = element.getAttribute("aria-label")?.trim();
  const text = aria || (element instanceof HTMLElement ? element.innerText : element.textContent) || "";
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}
function isSensitive(element: Element): boolean {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  const type = element instanceof HTMLInputElement ? element.type.toLowerCase() : "";
  const autocomplete = element.getAttribute("autocomplete")?.toLowerCase() ?? "";
  return type === "password" || /password|cc-number|cc-csc|one-time-code/.test(autocomplete);
}
function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute("role")?.trim();
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  const map: Readonly<Record<string, string>> = { a: "link", button: "button", nav: "navigation", main: "main", form: "form", table: "table", img: "img", h1: "heading", h2: "heading", h3: "heading", input: "textbox", textarea: "textbox", select: "combobox" };
  return map[tag];
}
function isInteractive(element: Element): boolean {
  return element.matches("a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[tabindex]");
}
function safeAttributes(element: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["id", "name", "aria-label", "data-testid", "data-test", "type", "href"]) {
    if (isSensitive(element) && (name === "name" || name === "type")) continue;
    const value = element.getAttribute(name);
    if (value && value.length <= 300) out[name] = name === "href" ? sanitizeHref(value) : value;
  }
  return out;
}
function sanitizeHref(value: string): string {
  try { const url = new URL(value, location.href); return `${url.origin}${url.pathname}`.slice(0, 300); } catch { return ""; }
}
function serialize(element: Element, meaningful: ReadonlySet<Element>): SerializedElement {
  const rect = element.getBoundingClientRect();
  const role = roleOf(element);
  const text = visibleText(element);
  const name = element.getAttribute("aria-label")?.slice(0, 300) || undefined;
  let parent = element.parentElement;
  while (parent && !meaningful.has(parent)) parent = parent.parentElement;
  const parentId = parent ? patchId(parent) : undefined;
  return { id: patchId(element), ...(parentId ? { parentId } : {}), tag: element.tagName.toLowerCase(), ...(role ? { role } : {}), text, ...(name ? { name } : {}), interactive: isInteractive(element), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, attributes: safeAttributes(element) };
}
function context(): unknown {
  idElements.clear();
  const candidates = Array.from(document.querySelectorAll("body *"));
  const meaningful = candidates.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    return isInteractive(element) || Boolean(roleOf(element)) || visibleText(element).length > 0;
  }).slice(0, 2500);
  // Allocate stable IDs before serialization so every child can point at an observed ancestor.
  meaningful.forEach((element) => patchId(element));
  const meaningfulSet = new Set(meaningful);
  return { url: `${location.origin}${location.pathname}`, title: document.title, elements: meaningful.map((element) => serialize(element, meaningfulSet)), patchIds: [...activeUndo.keys()] };
}
function requireElement(id: string): Element {
  const element = idElements.get(id);
  if (!element || !element.isConnected) throw new Error(`DOM target ${id} is no longer available. Refresh PATCH context.`);
  return element;
}
function snapshot(state: UndoState, element: Element): void {
  if (state.original.has(element)) return;

  state.original.set(element, {
    style: element.getAttribute("style"),
    hiddenAttribute:
      element instanceof HTMLElement
        ? element.getAttribute("hidden")
        : null,
    parent: element.parentNode,
    nextSibling: element.nextSibling
  });
}
function setStyles(element: Element, styles: Readonly<Record<string, string | undefined>>): void {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return;
  for (const [name, value] of Object.entries(styles)) if (value !== undefined) (element as HTMLElement).style.setProperty(camelToKebab(name), value);
}
function camelToKebab(value: string): string { return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`); }
function ensureContainer(id: string, state: UndoState, parent: Element = document.body): HTMLElement {
  const existing = state.containers.get(id);
  if (existing?.isConnected) { idElements.set(id, existing); return existing; }
  const container = document.createElement("div");
  container.dataset.patchContainer = id;
  container.dataset.patchCreated = "true";
  state.created.add(container);
  state.containers.set(id, container);
  parent.append(container);
  idElements.set(id, container);
  return container;
}
function resolveTarget(id: string, state: UndoState): Element {
  return id.startsWith("patch-container-") ? ensureContainer(id, state) : requireElement(id);
}
function applyOperation(operation: PatchOperation, state: UndoState): void {
  switch (operation.action) {
    case "HIDE": { const el = resolveTarget(operation.target, state); snapshot(state, el); if (el instanceof HTMLElement) el.hidden = true; setStyles(el, { display: "none" }); break; }
    case "SHOW": { const el = resolveTarget(operation.target, state); snapshot(state, el); if (el instanceof HTMLElement) el.hidden = false; setStyles(el, { display: "" }); break; }
    case "MOVE": { const el = resolveTarget(operation.target, state); const dest = resolveTarget(operation.destination, state); snapshot(state, el); operation.position === "first" ? dest.prepend(el) : dest.append(el); break; }
    case "GROUP": { const container = ensureContainer(operation.containerId, state); for (const id of operation.targets) { const el = resolveTarget(id, state); snapshot(state, el); container.append(el); } break; }
    case "REORDER": { const el = resolveTarget(operation.target, state); snapshot(state, el); const parent = el.parentElement; if (!parent) throw new Error("Cannot reorder a detached DOM element."); const reference = parent.children.item(operation.index); if (reference) parent.insertBefore(el, reference); else parent.append(el); break; }
    case "RESIZE": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, { width: operation.width, height: operation.height }); break; }
    case "RESTYLE": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, operation.styles); break; }
    case "COLLAPSE": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, operation.collapsed ? { maxHeight: "0", overflow: "hidden", opacity: "0" } : { maxHeight: "", overflow: "", opacity: "" }); break; }
    case "HIGHLIGHT": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, { boxShadow: operation.emphasis === "strong" ? "0 0 0 4px rgba(80,120,255,.45)" : "0 0 0 2px rgba(80,120,255,.3)" }); break; }
    case "SET_TYPOGRAPHY": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, { fontSize: operation.fontSize, lineHeight: operation.lineHeight, fontWeight: operation.fontWeight }); break; }
    case "REDUCE_MOTION": { const el = resolveTarget(operation.target, state); snapshot(state, el); if (el instanceof HTMLElement) { el.style.setProperty("animation", "none", "important"); el.style.setProperty("transition", "none", "important"); } break; }
    case "CHANGE_LAYOUT": { const el = resolveTarget(operation.target, state); snapshot(state, el); setStyles(el, { display: operation.display, gap: operation.gap, gridTemplateColumns: operation.columns }); break; }
    case "ADD_LABEL": { const el = resolveTarget(operation.target, state); const label = document.createElement("span"); label.textContent = operation.text; label.dataset.patchCreated = "true"; label.dataset.patchOp = operation.opId; state.created.add(label); operation.placement === "before" ? el.before(label) : el.after(label); break; }
    case "CREATE_CONTAINER": { const parent = operation.parent ? resolveTarget(operation.parent, state) : document.body; const container = ensureContainer(operation.containerId, state, parent); setStyles(container, operation.styles); break; }
  }
}
function applyPatch(input: unknown, forcedId?: string): { patchId: string; verified: true } {
  const patch = WebsitePatchSchema.parse(input);
  const patchIdValue = forcedId ?? crypto.randomUUID();
  if (activeUndo.has(patchIdValue)) restorePatch(patchIdValue);
  const locators = new Map<string, SavedLocator>();
  for (const operation of patch.operations) {
    for (const ref of references(operation)) {
      if (ref.startsWith("dom-") && !locators.has(ref)) locators.set(ref, locatorFor(requireElement(ref)));
    }
  }
  const state: UndoState = { operations: [...patch.operations], locators, pageKey: `${location.origin}${location.pathname}`, original: new Map(), created: new Set(), containers: new Map() };
  activeUndo.set(patchIdValue, state);
  try {
    for (const operation of patch.operations) applyOperation(operation, state);
    return { patchId: patchIdValue, verified: true };
  } catch (error: unknown) {
    // Browser transformations are transactional: never leave a half-applied page if one operation fails.
    restorePatch(patchIdValue);
    throw error;
  }
}
function styleEquals(element: Element, property: string, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
  return (element as HTMLElement).style.getPropertyValue(camelToKebab(property)).trim() === expected.trim();
}
function verifyOperation(operation: PatchOperation, state: UndoState): boolean {
  const target = "target" in operation && typeof operation.target === "string" ? idElements.get(operation.target) : undefined;
  switch (operation.action) {
    case "HIDE": return Boolean(target?.isConnected && ((target instanceof HTMLElement && target.hidden) || getComputedStyle(target).display === "none"));
    case "SHOW": return Boolean(target?.isConnected && (!(target instanceof HTMLElement) || !target.hidden) && getComputedStyle(target).display !== "none");
    case "MOVE": { const destination = idElements.get(operation.destination); if (!target?.isConnected || !destination?.isConnected) return false; return target.parentElement === destination; }
    case "GROUP": { const container = state.containers.get(operation.containerId); return Boolean(container?.isConnected && operation.targets.every((id) => idElements.get(id)?.parentElement === container)); }
    case "REORDER": return Boolean(target?.isConnected && target.parentElement && Array.from(target.parentElement.children).indexOf(target) === Math.min(operation.index, Math.max(0, target.parentElement.children.length - 1)));
    case "RESIZE": return Boolean(target?.isConnected && styleEquals(target, "width", operation.width) && styleEquals(target, "height", operation.height));
    case "RESTYLE": return Boolean(target?.isConnected && Object.entries(operation.styles).every(([name, value]) => typeof value === "string" && styleEquals(target, name, value)));
    case "COLLAPSE": return Boolean(target?.isConnected && (operation.collapsed ? styleEquals(target, "maxHeight", "0") && styleEquals(target, "overflow", "hidden") : styleEquals(target, "maxHeight", "") && styleEquals(target, "overflow", "")));
    case "HIGHLIGHT": return Boolean(target?.isConnected && (target instanceof HTMLElement || target instanceof SVGElement) && (target as HTMLElement).style.getPropertyValue("box-shadow").trim());
    case "SET_TYPOGRAPHY": return Boolean(target?.isConnected && styleEquals(target, "fontSize", operation.fontSize) && styleEquals(target, "lineHeight", operation.lineHeight) && styleEquals(target, "fontWeight", operation.fontWeight));
    case "REDUCE_MOTION": return Boolean(target?.isConnected && (target instanceof HTMLElement) && target.style.getPropertyValue("animation") === "none" && target.style.getPropertyPriority("animation") === "important" && target.style.getPropertyValue("transition") === "none");
    case "CHANGE_LAYOUT": return Boolean(target?.isConnected && styleEquals(target, "display", operation.display) && styleEquals(target, "gap", operation.gap) && styleEquals(target, "gridTemplateColumns", operation.columns));
    case "ADD_LABEL": return Boolean(document.querySelector(`[data-patch-created="true"][data-patch-op="${CSS.escape(operation.opId)}"]`));
    case "CREATE_CONTAINER": return Boolean(state.containers.get(operation.containerId)?.isConnected);
  }
  return false;
}
function reconcilePatch(patchIdValue: string): boolean {
  const state = activeUndo.get(patchIdValue);
  if (!state || state.pageKey !== `${location.origin}${location.pathname}`) return false;
  for (const [targetId, locator] of state.locators) {
    const current = idElements.get(targetId);
    if (current?.isConnected) continue;
    const replacement = resolveLocator(locator);
    if (replacement) {
      // Preserve the original grounded target ID across a framework rerender so
      // subsequent semantic observations, verification, and undo refer to the
      // same PATCH target rather than allocating a new dom-* identity.
      elementIds.set(replacement, targetId);
      idElements.set(targetId, replacement);
    }
  }
  let changed = false;
  for (const operation of state.operations) {
    if (verifyOperation(operation, state)) continue;
    try { applyOperation(operation, state); changed = true; } catch { /* a stale locator is reported by verification */ }
  }
  return changed;
}
function verificationForState(state: UndoState): Array<{ opId: string; action: string; verified: boolean }> {
  return state.operations.map((operation) => ({ opId: operation.opId, action: operation.action, verified: verifyOperation(operation, state) }));
}
function verifyPatch(patchIdValue: string): { verified: boolean; reconciled: boolean; operations: Array<{ opId: string; action: string; verified: boolean }> } {
  const state = activeUndo.get(patchIdValue);
  if (!state) return { verified: false, reconciled: false, operations: [] };
  let operations = verificationForState(state);
  let reconciled = false;
  if (!operations.every((operation) => operation.verified)) {
    reconciled = reconcilePatch(patchIdValue);
    operations = verificationForState(state);
  }
  return { verified: operations.every((operation) => operation.verified), reconciled, operations };
}

function restorePatch(patchIdValue: string): { restored: boolean; verified: boolean } {
  const state = activeUndo.get(patchIdValue);
  if (!state) return { restored: false, verified: true };
  for (const created of [...state.created].reverse()) if (created.isConnected) created.remove();
  for (const [element, original] of [...state.original.entries()].reverse()) {
    if (original.style === null) element.removeAttribute("style");
    else element.setAttribute("style", original.style);

    if (element instanceof HTMLElement) {
      if (original.hiddenAttribute === null) element.removeAttribute("hidden");
      else element.setAttribute("hidden", original.hiddenAttribute);
    }

    // A live PATCH move/reorder keeps the element connected. If a client-rendered
    // app replaced it, do not resurrect the stale detached node during undo.
    if (original.parent && original.parent.isConnected && element.isConnected) {
      original.parent.insertBefore(
        element,
        original.nextSibling && original.nextSibling.parentNode === original.parent ? original.nextSibling : null
      );
    }
  }
  activeUndo.delete(patchIdValue);
  persistentPatchIds.delete(patchIdValue);
  return { restored: true, verified: true };
}
function temporaryHighlight(targetId: string): { verified: true } {
  const element = requireElement(targetId);
  if (!(element instanceof HTMLElement)) return { verified: true };
  const oldOutline = element.style.outline;
  element.style.outline = "3px solid rgba(90,130,255,.9)";
  setTimeout(() => { if (element.isConnected) element.style.outline = oldOutline; }, 1500);
  return { verified: true };
}
function locatorFor(element: Element): SavedLocator {
  if (element.id) return { kind: "id", value: element.id };
  for (const name of ["data-testid", "data-test", "name", "aria-label"] as const) { const value = element.getAttribute(name); if (value) return { kind: "attribute", name, value }; }
  const role = roleOf(element); const text = visibleText(element).slice(0, 200);
  if (role && text) {
    const peers = Array.from(document.querySelectorAll("body *")).filter((candidate) => roleOf(candidate) === role && visibleText(candidate).slice(0, 200) === text);
    return { kind: "semantic", role, text, occurrence: Math.max(0, peers.indexOf(element)) };
  }
  const segments: number[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && segments.length < 30) {
    const parentElement: Element | null = current.parentElement;
    if (!parentElement) break;
    segments.unshift(Array.from(parentElement.children).indexOf(current));
    current = parentElement;
  }
  return { kind: "path", segments: segments.length ? segments : [0] };
}
function resolveLocator(locator: SavedLocator): Element | null {
  if (locator.kind === "id") return document.getElementById(locator.value);
  if (locator.kind === "attribute") return document.querySelector(`[${CSS.escape(locator.name)}="${CSS.escape(locator.value)}"]`);
  if (locator.kind === "semantic") return Array.from(document.querySelectorAll("body *")).filter((element) => roleOf(element) === locator.role && visibleText(element).slice(0, 200) === locator.text)[locator.occurrence] ?? null;
  let current: Element = document.body; for (const index of locator.segments) { const next = current.children.item(index); if (!next) return null; current = next; } return current;
}
function references(operation: PatchOperation): string[] {
  if (operation.action === "GROUP") return operation.targets;
  if (operation.action === "MOVE") return [operation.target, operation.destination];
  if (operation.action === "CREATE_CONTAINER") return operation.parent ? [operation.parent] : [];
  if ("target" in operation) return [operation.target];
  return [];
}
function compileSavedPatch(params: unknown): SavedPatch {
  const record = params && typeof params === "object" ? params as Readonly<Record<string, unknown>> : {};
  const patch = WebsitePatchSchema.parse(record.patch);
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 120) : `PATCH for ${location.hostname}`;
  const pathPattern = typeof record.pathPattern === "string" && record.pathPattern.trim() ? record.pathPattern.trim() : `${location.pathname}*`;
  const id = crypto.randomUUID();
  const operations = patch.operations.map((operation) => {
    const locators: Record<string, SavedLocator> = {};
    for (const ref of references(operation)) if (ref.startsWith("dom-")) locators[ref] = locatorFor(requireElement(ref));
    return { operation, locators };
  });
  return { id, name, domain: location.hostname, pathPattern, createdAt: new Date().toISOString(), lastAppliedAt: null, enabled: true, operations };
}
function applySaved(saved: SavedPatch): boolean {
  idElements.clear();
  const remap = new Map<string, string>();
  for (const item of saved.operations) for (const [oldId, locator] of Object.entries(item.locators)) { const element = resolveLocator(locator); if (!element) return false; remap.set(oldId, patchId(element)); }
  const operations = saved.operations.map(({ operation }) => {
    const json = JSON.parse(JSON.stringify(operation)) as Record<string, unknown>;
    for (const key of ["target", "destination", "parent"]) if (typeof json[key] === "string" && remap.has(json[key] as string)) json[key] = remap.get(json[key] as string);
    if (Array.isArray(json.targets)) json.targets = json.targets.map((value) => typeof value === "string" && remap.has(value) ? remap.get(value) : value);
    return json;
  });
  applyPatch({ version: "1", operations }, saved.id);
  persistentPatchIds.add(saved.id);
  return true;
}
async function loadSaved(force = false): Promise<void> {
  const result = await new Promise<Readonly<{ ok?: boolean; patches?: SavedPatch[] }>>((resolve) => {
    chrome.runtime.sendMessage({ source: "patch-content", method: "savedPatches:get", href: location.href }, (message) => {
      const record = message && typeof message === "object" ? message as Readonly<{ ok?: boolean; patches?: SavedPatch[] }> : {};
      resolve(record);
    });
  });
  for (const saved of result.patches ?? []) {
    if (force || !persistentPatchIds.has(saved.id)) {
      try {
        suppressObserver = true;
        applySaved(saved);
        setTimeout(() => { suppressObserver = false; }, 0);
      } catch { suppressObserver = false; /* malformed or stale saved rules are isolated */ }
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const record = message && typeof message === "object" ? message as Readonly<Record<string, unknown>> : null;
  if (record?.source !== "patch-extension" || typeof record.method !== "string") return;
  try {
    let result: unknown;
    if (record.method === "browser.ping") result = { protocolVersion: "1", pageUrl: `${location.origin}${location.pathname}`, pageTitle: document.title, domReady: Boolean(document.documentElement && document.body), mutationCapable: true };
    else if (record.method === "browser.getContext") result = context();
    else if (record.method === "browser.applyPatch") { const params = record.params as Readonly<{ patch?: unknown }>; result = applyPatch(params?.patch); }
    else if (record.method === "browser.verifyPatch") { const params = record.params as Readonly<{ patchId?: string }>; result = verifyPatch(params.patchId ?? ""); }
    else if (record.method === "browser.restorePatch") { const params = record.params as Readonly<{ patchId?: string }>; result = restorePatch(params.patchId ?? ""); }
    else if (record.method === "browser.highlight") { const params = record.params as Readonly<{ targetId?: string }>; result = temporaryHighlight(params.targetId ?? ""); }
    else if (record.method === "browser.compileSavedPatch") result = compileSavedPatch(record.params);
    else throw new Error(`Unsupported browser method: ${record.method}`);
    sendResponse({ ok: true, result });
  } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : "Browser operation failed." }); }
});

const observer = new MutationObserver(() => {
  if (suppressObserver || (persistentPatchIds.size === 0 && activeUndo.size === 0) || mutationTimer) return;
  mutationTimer = setTimeout(() => {
    mutationTimer = null;
    suppressObserver = true;
    try {
      for (const patchIdValue of activeUndo.keys()) reconcilePatch(patchIdValue);
      void loadSaved(true).finally(() => { setTimeout(() => { suppressObserver = false; }, 0); });
    } catch {
      suppressObserver = false;
    }
  }, 250);
});
observer.observe(document.documentElement, { subtree: true, childList: true });
void loadSaved();
