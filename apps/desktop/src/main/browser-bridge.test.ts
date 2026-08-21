import { describe, expect, it, vi } from "vitest";
import { BrowserBridgeServer, type BrowserAgentStatus } from "./browser-bridge";

const readyStatus: BrowserAgentStatus = {
  nativeBridgeConnected: true,
  protocolCompatible: true,
  protocolVersion: "1",
  extensionVersion: "0.1.0",
  activeTabAvailable: true,
  contentReachable: true,
  domContextAvailable: true,
  mutationCapabilityAvailable: true,
  pageUrl: "https://example.test/watch",
  pageTitle: "Example"
};

const element = {
  id: "dom-1",
  tag: "aside",
  text: "Recommendations",
  interactive: false,
  bounds: { x: 900, y: 0, width: 300, height: 700 },
  attributes: {}
} as const;

describe("browser readiness probe", () => {
  it("marks readiness verified only after the real BrowserContext path succeeds", async () => {
    const bridge = new BrowserBridgeServer();
    vi.spyOn(bridge, "getStatus").mockResolvedValue(readyStatus);
    vi.spyOn(bridge, "getContext").mockResolvedValue({
      url: "https://example.test/watch",
      title: "Example",
      elements: [element],
      patchIds: []
    });

    await expect(bridge.probeReadiness()).resolves.toMatchObject({
      contextVerified: true,
      observedDomNodeCount: 1,
      status: { domContextAvailable: true, mutationCapabilityAvailable: true }
    });
  });

  it("does not report Ready when the content ping succeeds but semantic DOM is empty", async () => {
    const bridge = new BrowserBridgeServer();
    vi.spyOn(bridge, "getStatus").mockResolvedValue(readyStatus);
    vi.spyOn(bridge, "getContext").mockResolvedValue({
      url: "https://example.test/watch",
      title: "Example",
      elements: [],
      patchIds: []
    });

    await expect(bridge.probeReadiness()).resolves.toMatchObject({
      contextVerified: false,
      observedDomNodeCount: 0,
      status: {
        domContextAvailable: false,
        mutationCapabilityAvailable: false,
        failureCode: "BROWSER_CONTEXT_EMPTY"
      }
    });
  });

  it("surfaces a failed BrowserContext acquisition instead of leaving a false green status", async () => {
    const bridge = new BrowserBridgeServer();
    vi.spyOn(bridge, "getStatus").mockResolvedValue(readyStatus);
    vi.spyOn(bridge, "getContext").mockRejectedValue(new Error("semantic context failed"));

    await expect(bridge.probeReadiness()).resolves.toMatchObject({
      contextVerified: false,
      observedDomNodeCount: 0,
      status: {
        domContextAvailable: false,
        mutationCapabilityAvailable: false,
        failureCode: "BROWSER_CONTEXT_EMPTY",
        failureMessage: "semantic context failed"
      }
    });
  });
});
