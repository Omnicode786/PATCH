import net, { type Server, type Socket } from "node:net";
import { BrowserContextSchema, type BrowserContext } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import { z } from "zod";

const MAX_BUFFER = 8 * 1024 * 1024;
const PROTOCOL_VERSION = "1";

const MessageSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["request", "response", "event"]),
  method: z.string().optional(),
  params: z.unknown().optional(),
  ok: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional()
}).strict();

const BrowserAgentStatusSchema = z.object({
  protocolVersion: z.string(),
  extensionVersion: z.string().optional(),
  activeTabAvailable: z.boolean(),
  contentReachable: z.boolean(),
  domContextAvailable: z.boolean(),
  mutationCapabilityAvailable: z.boolean(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  failureCode: z.string().optional(),
  failureMessage: z.string().optional()
}).passthrough();

export type BrowserAgentStatus = Readonly<{
  nativeBridgeConnected: boolean;
  protocolCompatible: boolean;
  protocolVersion: string | null;
  extensionVersion?: string;
  activeTabAvailable: boolean;
  contentReachable: boolean;
  domContextAvailable: boolean;
  mutationCapabilityAvailable: boolean;
  pageUrl?: string;
  pageTitle?: string;
  failureCode?: string;
  failureMessage?: string;
}>;

export type BrowserReadinessProbe = Readonly<{
  status: BrowserAgentStatus;
  contextVerified: boolean;
  observedDomNodeCount: number;
}>;

type Pending = Readonly<{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;

const disconnectedStatus = (): BrowserAgentStatus => ({
  nativeBridgeConnected: false,
  protocolCompatible: false,
  protocolVersion: null,
  activeTabAvailable: false,
  contentReachable: false,
  domContextAvailable: false,
  mutationCapabilityAvailable: false,
  failureCode: "BROWSER_ADAPTER_NOT_CONNECTED",
  failureMessage: "PATCH Chrome native bridge is not connected."
});

export class BrowserBridgeServer {
  readonly #pipeName = "patch-browser-bridge-v1";
  #server: Server | null = null;
  #socket: Socket | null = null;
  #buffer = "";
  readonly #pending = new Map<string, Pending>();

  get connected(): boolean { return Boolean(this.#socket && !this.#socket.destroyed); }
  get pipeName(): string { return this.#pipeName; }

  async start(): Promise<void> {
    if (process.platform !== "win32" || this.#server) return;
    const pipe = `\\\\.\\pipe\\${this.#pipeName}`;
    this.#server = net.createServer((socket) => {
      if (this.#socket && this.#socket !== socket) {
        this.#rejectPending(new PatchError("ADAPTER_DISCONNECTED", "Chrome companion reconnected; retry the request against the new page context."));
        this.#socket.destroy();
      }
      this.#buffer = "";
      this.#socket = socket;
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => this.#onData(socket, chunk));
      const disconnected = () => {
        if (this.#socket !== socket) return;
        this.#socket = null;
        this.#buffer = "";
        this.#rejectPending(new PatchError("ADAPTER_DISCONNECTED", "Chrome companion extension disconnected."));
      };
      socket.on("close", disconnected);
      socket.on("error", disconnected);
    });
    await new Promise<void>((resolve, reject) => {
      this.#server?.once("error", reject);
      this.#server?.listen(pipe, () => resolve());
    });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }

  #onData(socket: Socket, chunk: string): void {
    if (this.#socket !== socket) return;
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_BUFFER) {
      this.#buffer = "";
      socket.destroy(new Error("PATCH browser bridge message exceeded the maximum size."));
      return;
    }
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      newline = this.#buffer.indexOf("\n");
      if (!line.trim()) continue;
      let message: z.infer<typeof MessageSchema>;
      try { message = MessageSchema.parse(JSON.parse(line)); } catch { continue; }
      if (message.kind !== "response") continue;
      const pending = this.#pending.get(message.requestId);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else {
        const code = message.error?.code;
        const known = new Set([
          "BROWSER_ADAPTER_NOT_CONNECTED", "ACTIVE_TAB_NOT_AVAILABLE", "BROWSER_CONTEXT_EMPTY",
          "PROTOCOL_MISMATCH", "NATIVE_MESSAGE_FAILED", "PATCH_EXECUTION_FAILED", "VERIFICATION_FAILED"
        ]);
        pending.reject(new PatchError(known.has(code ?? "") ? code as never : "ACTION_FAILED", message.error?.message ?? "Browser adapter request failed.", { nativeCode: code ?? "BROWSER_ADAPTER_ERROR" }));
      }
    }
  }

  request(method: string, params: Readonly<Record<string, unknown>> = {}, timeoutMs = 10000): Promise<unknown> {
    const socket = this.#socket;
    if (!socket || socket.destroyed) return Promise.reject(new PatchError("BROWSER_ADAPTER_NOT_CONNECTED", "PATCH can see the browser integration, but the native browser bridge is not connected."));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new PatchError("NATIVE_MESSAGE_FAILED", `${method} timed out while waiting for the PATCH browser adapter.`, { method }));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ requestId, kind: "request", method, params })}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.#pending.delete(requestId);
          reject(new PatchError("NATIVE_MESSAGE_FAILED", error.message, { method }));
        }
      });
    });
  }

  async getStatus(): Promise<BrowserAgentStatus> {
    if (!this.connected) return disconnectedStatus();
    try {
      const remote = BrowserAgentStatusSchema.parse(await this.request("browser.getStatus", {}, 5000));
      const compatible = remote.protocolVersion === PROTOCOL_VERSION;
      return {
        nativeBridgeConnected: true,
        protocolCompatible: compatible,
        protocolVersion: remote.protocolVersion,
        ...(remote.extensionVersion ? { extensionVersion: remote.extensionVersion } : {}),
        activeTabAvailable: remote.activeTabAvailable,
        contentReachable: remote.contentReachable,
        domContextAvailable: remote.domContextAvailable,
        mutationCapabilityAvailable: compatible && remote.mutationCapabilityAvailable,
        ...(remote.pageUrl ? { pageUrl: remote.pageUrl } : {}),
        ...(remote.pageTitle ? { pageTitle: remote.pageTitle } : {}),
        ...(!compatible ? { failureCode: "PROTOCOL_MISMATCH", failureMessage: `PATCH desktop expects browser protocol ${PROTOCOL_VERSION}, but the extension reported ${remote.protocolVersion}. Reload/update the PATCH extension.` } : {}),
        ...(compatible && remote.failureCode ? { failureCode: remote.failureCode } : {}),
        ...(compatible && remote.failureMessage ? { failureMessage: remote.failureMessage } : {})
      };
    } catch (error: unknown) {
      return {
        nativeBridgeConnected: true,
        protocolCompatible: false,
        protocolVersion: null,
        activeTabAvailable: false,
        contentReachable: false,
        domContextAvailable: false,
        mutationCapabilityAvailable: false,
        failureCode: error instanceof PatchError ? error.code : "NATIVE_MESSAGE_FAILED",
        failureMessage: error instanceof Error ? error.message : "PATCH could not query the browser adapter."
      };
    }
  }

  async getContext(): Promise<BrowserContext> {
    return BrowserContextSchema.parse(await this.request("browser.getContext"));
  }

  /**
   * Settings/readiness must validate the same semantic context path used by an
   * actual invocation. A lightweight content-script ping alone can say "ready"
   * while BrowserContext schema acquisition is failing. This probe is read-only.
   */
  async probeReadiness(): Promise<BrowserReadinessProbe> {
    const status = await this.getStatus();
    if (!(
      status.nativeBridgeConnected &&
      status.protocolCompatible &&
      status.activeTabAvailable &&
      status.contentReachable &&
      status.domContextAvailable
    )) {
      return { status, contextVerified: false, observedDomNodeCount: 0 };
    }

    try {
      const context = await this.getContext();
      if (context.elements.length === 0) {
        return {
          status: {
            ...status,
            domContextAvailable: false,
            mutationCapabilityAvailable: false,
            failureCode: "BROWSER_CONTEXT_EMPTY",
            failureMessage: "PATCH reached the content adapter, but the semantic DOM observation was empty."
          },
          contextVerified: false,
          observedDomNodeCount: 0
        };
      }
      return { status, contextVerified: true, observedDomNodeCount: context.elements.length };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "PATCH could not acquire semantic browser context.";
      return {
        status: {
          ...status,
          domContextAvailable: false,
          mutationCapabilityAvailable: false,
          failureCode: error instanceof PatchError ? error.code : "BROWSER_CONTEXT_EMPTY",
          failureMessage: message
        },
        contextVerified: false,
        observedDomNodeCount: 0
      };
    }
  }

  async close(): Promise<void> {
    this.#socket?.destroy();
    this.#socket = null;
    this.#buffer = "";
    this.#rejectPending(new PatchError("ADAPTER_DISCONNECTED", "Browser bridge closed."));
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()) ?? resolve());
    this.#server = null;
  }
}
