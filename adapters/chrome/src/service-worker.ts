import type { NativePort } from "./chrome-types";

type WireRequest = Readonly<{ requestId: string; kind: "request"; method: string; params?: unknown }>;
type WireResponse = Readonly<{ requestId: string; kind: "response"; ok: boolean; result?: unknown; error?: Readonly<{ code: string; message: string }> }>;
type SavedPatchRecord = Readonly<{ id: string; domain: string; pathPattern: string; enabled: boolean; operations: unknown[] }>;
type ContentPing = Readonly<{ protocolVersion?: string; pageUrl?: string; pageTitle?: string; domReady?: boolean; mutationCapable?: boolean }>;

const HOST = "com.patch.browser";
const STORAGE_KEY = "patch.savedPatches.v1";
const PROTOCOL_VERSION = "1";
let nativePort: NativePort | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function isWireRequest(value: unknown): value is WireRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Readonly<Record<string, unknown>>;
  return typeof record.requestId === "string" && record.kind === "request" && typeof record.method === "string";
}

function connect(): void {
  if (nativePort) return;
  try {
    const port = chrome.runtime.connectNative(HOST);
    nativePort = port;
    port.onMessage.addListener((message) => { if (isWireRequest(message)) void handleNativeRequest(message); });
    port.onDisconnect.addListener(() => {
      nativePort = null;
      scheduleReconnect();
    });
  } catch { scheduleReconnect(); }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 2500);
}

function respond(response: WireResponse): void {
  try { nativePort?.postMessage(response); } catch { nativePort = null; scheduleReconnect(); }
}

async function activeTabId(): Promise<number> {
  return new Promise((resolve, reject) => chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const id = tabs[0]?.id;
    if (typeof id !== "number") reject(new Error("No active browser tab is available.")); else resolve(id);
  }));
}

function sendMessageOnce(tabId: number, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, { source: "patch-extension", method, params }, (response) => {
    const error = chrome.runtime.lastError?.message;
    if (error) { reject(new Error(error)); return; }
    const record = response && typeof response === "object" ? response as Readonly<Record<string, unknown>> : null;
    if (!record || record.ok !== true) { reject(new Error(typeof record?.error === "string" ? record.error : "PATCH content adapter did not return a valid response.")); return; }
    resolve(record.result);
  }));
}

function missingReceiver(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /receiving end does not exist|could not establish connection/i.test(message);
}

async function injectBundledContentAdapter(tabId: number): Promise<void> {
  await new Promise<void>((resolve, reject) => chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
    const error = chrome.runtime.lastError?.message;
    if (error) { reject(new Error(error)); return; }
    resolve();
  }));
}

async function sendToContent(method: string, params: unknown): Promise<unknown> {
  const tabId = await activeTabId();
  try {
    return await sendMessageOnce(tabId, method, params);
  } catch (error: unknown) {
    // MV3 content scripts are not retroactively injected into every already-open tab
    // after an unpacked extension is installed/reloaded. Recover by injecting PATCH's
    // prebuilt, restricted content adapter file. No model-provided JavaScript is run.
    if (!missingReceiver(error)) throw error;
    await injectBundledContentAdapter(tabId);
    return sendMessageOnce(tabId, method, params);
  }
}

async function browserStatus(): Promise<Readonly<Record<string, unknown>>> {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    activeTabAvailable: false,
    contentReachable: false,
    domContextAvailable: false,
    mutationCapabilityAvailable: false
  };
  let tabId: number;
  try {
    tabId = await activeTabId();
  } catch (error: unknown) {
    return { ...base, failureCode: "ACTIVE_TAB_NOT_AVAILABLE", failureMessage: error instanceof Error ? error.message : "No active browser tab is available." };
  }

  try {
    let ping: ContentPing;
    try {
      ping = await sendMessageOnce(tabId, "browser.ping", {}) as ContentPing;
    } catch (error: unknown) {
      if (!missingReceiver(error)) throw error;
      await injectBundledContentAdapter(tabId);
      ping = await sendMessageOnce(tabId, "browser.ping", {}) as ContentPing;
    }
    const protocolVersion = typeof ping.protocolVersion === "string" ? ping.protocolVersion : PROTOCOL_VERSION;
    return {
      protocolVersion,
      extensionVersion: chrome.runtime.getManifest().version,
      activeTabAvailable: true,
      contentReachable: true,
      domContextAvailable: ping.domReady === true,
      mutationCapabilityAvailable: ping.mutationCapable === true,
      ...(typeof ping.pageUrl === "string" ? { pageUrl: ping.pageUrl } : {}),
      ...(typeof ping.pageTitle === "string" ? { pageTitle: ping.pageTitle } : {})
    };
  } catch (error: unknown) {
    return {
      ...base,
      activeTabAvailable: true,
      failureCode: "BROWSER_CONTEXT_EMPTY",
      failureMessage: error instanceof Error ? error.message : "The active tab could not be reached by the PATCH content adapter."
    };
  }
}

async function storageGet(): Promise<SavedPatchRecord[]> {
  return new Promise((resolve) => chrome.storage.local.get(STORAGE_KEY, (items) => {
    const value = items[STORAGE_KEY];
    resolve(Array.isArray(value) ? value.filter((item): item is SavedPatchRecord => Boolean(item && typeof item === "object" && "id" in item)) : []);
  }));
}
async function storageSet(records: SavedPatchRecord[]): Promise<void> {
  await new Promise<void>((resolve) => chrome.storage.local.set({ [STORAGE_KEY]: records }, resolve));
}

function pathMatches(pattern: string, pathname: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(pathname);
}

async function handleNativeRequest(request: WireRequest): Promise<void> {
  try {
    let result: unknown;
    if (request.method === "browser.getStatus") {
      result = await browserStatus();
    } else if (request.method === "browser.listSavedPatches") {
      result = await storageGet();
    } else if (request.method === "browser.savePatch") {
      const compiled = await sendToContent("browser.compileSavedPatch", request.params) as SavedPatchRecord;
      const existing = (await storageGet()).filter((item) => item.id !== compiled.id);
      await storageSet([...existing, compiled]);
      result = compiled;
    } else if (request.method === "browser.deleteSavedPatch") {
      const params = request.params && typeof request.params === "object" ? request.params as Readonly<Record<string, unknown>> : {};
      const id = typeof params.id === "string" ? params.id : "";
      await storageSet((await storageGet()).filter((item) => item.id !== id));
      try { await sendToContent("browser.restorePatch", { patchId: id }); } catch { /* tab may have changed */ }
      result = { id, deleted: true };
    } else {
      result = await sendToContent(request.method, request.params ?? {});
    }
    respond({ requestId: request.requestId, kind: "response", ok: true, result });
  } catch (error) {
    respond({ requestId: request.requestId, kind: "response", ok: false, error: { code: "BROWSER_ADAPTER_ERROR", message: error instanceof Error ? error.message : "Browser adapter request failed." } });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const record = message && typeof message === "object" ? message as Readonly<Record<string, unknown>> : null;
  if (record?.source !== "patch-content" || record.method !== "savedPatches:get") return;
  void (async () => {
    const href = typeof record.href === "string" ? record.href : "";
    try {
      const url = new URL(href);
      const matches = (await storageGet()).filter((item) => item.enabled && item.domain === url.hostname && pathMatches(item.pathPattern, url.pathname));
      sendResponse({ ok: true, patches: matches });
    } catch { sendResponse({ ok: true, patches: [] }); }
  })();
  return true;
});

connect();
