import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeStyle {
  constructor() { this.map = new Map(); this.priority = new Map(); }
  setProperty(key, value, priority = "") {
    if (value === "") { this.map.delete(key); this.priority.delete(key); }
    else { this.map.set(key, String(value)); this.priority.set(key, String(priority)); }
  }
  getPropertyValue(key) { return this.map.get(key) ?? ""; }
  getPropertyPriority(key) { return this.priority.get(key) ?? ""; }
}

class FakeElement {
  constructor(tag, text = "") {
    this.tagName = tag.toUpperCase();
    this.textContent = text;
    this.innerText = text;
    this.attrs = new Map();
    this._children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.style = new FakeStyle();
    this.hidden = false;
    this.dataset = {};
    this.rect = { x: 0, y: 0, width: 100, height: 30 };
    this._connected = false;
  }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(value) { this.setAttribute("id", value); }
  get children() { const value = this._children.slice(); value.item = (index) => value[index] ?? null; return value; }
  get nextSibling() { if (!this.parentElement) return null; const index = this.parentElement._children.indexOf(this); return this.parentElement._children[index + 1] ?? null; }
  get isConnected() { return this._connected; }
  _setConnected(value) { this._connected = value; for (const child of this._children) child._setConnected(value); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === "hidden") this.hidden = true; }
  removeAttribute(name) { this.attrs.delete(name); if (name === "hidden") this.hidden = false; if (name === "style") this.style = new FakeStyle(); }
  matches(selector) { return (selector.includes("button") && this.tagName === "BUTTON") || (selector.includes("a[href]") && this.tagName === "A" && Boolean(this.getAttribute("href"))); }
  getBoundingClientRect() { return this.rect; }
  append(...elements) { for (const element of elements) this._insert(element, this._children.length); }
  prepend(...elements) { let index = 0; for (const element of elements) this._insert(element, index++); }
  _insert(element, index) {
    if (element.parentElement) { const previous = element.parentElement._children; const previousIndex = previous.indexOf(element); if (previousIndex >= 0) previous.splice(previousIndex, 1); }
    element.parentElement = this; element.parentNode = this; this._children.splice(index, 0, element); element._setConnected(this.isConnected);
  }
  insertBefore(element, reference) { const index = reference ? this._children.indexOf(reference) : -1; this._insert(element, index >= 0 ? index : this._children.length); }
  remove() { if (this.parentElement) { const siblings = this.parentElement._children; const index = siblings.indexOf(this); if (index >= 0) siblings.splice(index, 1); } this.parentElement = null; this.parentNode = null; this._setConnected(false); }
  before(element) { if (this.parentElement) this.parentElement._insert(element, this.parentElement._children.indexOf(this)); }
  after(element) { if (this.parentElement) this.parentElement._insert(element, this.parentElement._children.indexOf(this) + 1); }
}
class FakeHTMLElement extends FakeElement {}
class FakeSVGElement extends FakeElement {}
class FakeInputElement extends FakeHTMLElement { constructor() { super("input"); this.type = "text"; } }
class FakeTextAreaElement extends FakeHTMLElement {}

const descendants = (root) => root._children.flatMap((child) => [child, ...descendants(child)]);

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PATCH restricted content adapter dynamic-page runtime", () => {
  it("grounds a sidebar, applies HIDE, reconciles a SPA replacement with the same target ID, verifies, and restores", async () => {
    const html = new FakeHTMLElement("html");
    const body = new FakeHTMLElement("body");
    html.append(body);
    html._setConnected(true);
    const main = new FakeHTMLElement("main", "Video article");
    main.rect = { x: 0, y: 0, width: 900, height: 700 };
    let sidebar = new FakeHTMLElement("aside", "Recommendations");
    sidebar.id = "right-sidebar";
    sidebar.rect = { x: 900, y: 0, width: 300, height: 700 };
    body.append(main, sidebar);

    const document = {
      documentElement: html,
      body,
      title: "Example",
      querySelectorAll(selector) { return selector === "body *" ? descendants(body) : []; },
      getElementById(id) { return descendants(body).find((element) => element.id === id) ?? null; },
      querySelector(selector) {
        const attribute = selector.match(/^\[([^=]+)="([^"]*)"\]$/);
        if (attribute) return descendants(body).find((element) => element.getAttribute(attribute[1]) === attribute[2]) ?? null;
        const patchOp = selector.match(/^\[data-patch-created="true"\]\[data-patch-op="([^"]+)"\]$/);
        if (patchOp) return descendants(body).find((element) => element.dataset.patchCreated === "true" && element.dataset.patchOp === patchOp[1]) ?? null;
        return null;
      },
      createElement(tag) { return new FakeHTMLElement(tag); }
    };

    let observerCallback = null;
    let contentListener = null;
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    vi.stubGlobal("SVGElement", FakeSVGElement);
    vi.stubGlobal("HTMLInputElement", FakeInputElement);
    vi.stubGlobal("HTMLTextAreaElement", FakeTextAreaElement);
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { origin: "https://example.test", pathname: "/watch", href: "https://example.test/watch", hostname: "example.test" });
    vi.stubGlobal("CSS", { escape: (value) => String(value) });
    vi.stubGlobal("getComputedStyle", (element) => ({ display: element.style.getPropertyValue("display") || (element.hidden ? "none" : "block") }));
    vi.stubGlobal("MutationObserver", class { constructor(callback) { observerCallback = callback; } observe() {} });
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: (listener) => { contentListener = listener; } },
        sendMessage: (message, callback) => callback(message.method === "savedPatches:get" ? { ok: true, patches: [] } : { ok: true }),
        lastError: undefined
      }
    });

    await import("./content");
    expect(contentListener).not.toBeNull();
    const call = (method, params = {}) => {
      let response;
      contentListener({ source: "patch-extension", method, params }, null, (value) => { response = value; });
      if (!response || response.ok !== true) throw new Error(response?.error ?? "No PATCH content response.");
      return response.result;
    };

    const observed = call("browser.getContext");
    const observedSidebar = observed.elements.find((element) => element.text === "Recommendations");
    expect(observedSidebar?.id).toMatch(/^dom-/);

    const applied = call("browser.applyPatch", { patch: { version: "1", operations: [{ opId: "hide-side", action: "HIDE", target: observedSidebar.id }] } });
    expect(sidebar.hidden || sidebar.style.getPropertyValue("display") === "none").toBe(true);
    expect(call("browser.verifyPatch", { patchId: applied.patchId }).verified).toBe(true);

    sidebar.remove();
    const replacement = new FakeHTMLElement("aside", "Recommendations");
    replacement.id = "right-sidebar";
    replacement.rect = { x: 900, y: 0, width: 300, height: 700 };
    body.append(replacement);
    sidebar = replacement;
    observerCallback?.([]);
    await new Promise((resolve) => setTimeout(resolve, 330));

    expect(sidebar.hidden || sidebar.style.getPropertyValue("display") === "none").toBe(true);
    expect(call("browser.verifyPatch", { patchId: applied.patchId }).verified).toBe(true);
    const postContext = call("browser.getContext");
    expect(postContext.elements.find((element) => element.text === "Recommendations")?.id).toBe(observedSidebar.id);

    expect(call("browser.restorePatch", { patchId: applied.patchId })).toEqual({ restored: true, verified: true });
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.style.getPropertyValue("display")).not.toBe("none");
  }, 15000);
});
