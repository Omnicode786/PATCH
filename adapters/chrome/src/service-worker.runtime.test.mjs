import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PATCH Chrome service-worker runtime health", () => {
  it("recovers an already-open tab with the static bundled content adapter and reports mutation readiness", async () => {
    let nativeListener = null;
    const posted = [];
    let sendCount = 0;
    let injections = 0;
    const runtimeState = {};

    const port = {
      postMessage: (message) => posted.push(message),
      disconnect: vi.fn(),
      onMessage: { addListener: (listener) => { nativeListener = listener; } },
      onDisconnect: { addListener: vi.fn() }
    };

    vi.stubGlobal("chrome", {
      runtime: {
        connectNative: vi.fn((name) => {
          expect(name).toBe("com.patch.browser");
          return port;
        }),
        onMessage: { addListener: vi.fn() },
        get lastError() { return runtimeState.lastError; },
        getManifest: () => ({ version: "0.1.0" })
      },
      tabs: {
        query: vi.fn((query, callback) => {
          expect(query).toMatchObject({ active: true, lastFocusedWindow: true });
          callback([{ id: 42 }]);
        }),
        sendMessage: vi.fn((_tabId, message, callback) => {
          sendCount += 1;
          if (sendCount === 1) {
            runtimeState.lastError = { message: "Could not establish connection. Receiving end does not exist." };
            callback(undefined);
            delete runtimeState.lastError;
            return;
          }
          expect(message.method).toBe("browser.ping");
          callback({ ok: true, result: { protocolVersion: "1", pageUrl: "https://example.test/", pageTitle: "Example", domReady: true, mutationCapable: true } });
        })
      },
      scripting: {
        executeScript: vi.fn((options, callback) => {
          injections += 1;
          expect(options).toEqual({ target: { tabId: 42 }, files: ["content.js"] });
          callback();
        })
      },
      storage: { local: { get: vi.fn((_key, callback) => callback({})), set: vi.fn((_value, callback) => callback?.()) } }
    });

    await import("./service-worker");
    expect(nativeListener).not.toBeNull();
    nativeListener({ requestId: "request-1", kind: "request", method: "browser.getStatus", params: {} });
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(injections).toBe(1);
    expect(posted[0]).toEqual(expect.objectContaining({
      requestId: "request-1",
      kind: "response",
      ok: true,
      result: expect.objectContaining({
        activeTabAvailable: true,
        contentReachable: true,
        domContextAvailable: true,
        mutationCapabilityAvailable: true,
        protocolVersion: "1"
      })
    }));
  });
});
