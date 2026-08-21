import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";
import { AccessibilityNodeSchema, ActiveApplicationSchema, type AccessibilityNode, type ActiveApplication } from "@patch/schemas";
import { PatchError, type PatchErrorCode } from "@patch/shared";

const BridgeReplySchema = z.object({ requestId: z.string().uuid(), ok: z.boolean(), result: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() }).strict();

type Pending = Readonly<{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;

export class WindowsBridgeClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  readonly #pending = new Map<string, Pending>();
  #starting: Promise<void> | null = null;
  #lastError: string | null = null;

  get connected(): boolean {
    return Boolean(this.#child && !this.#child.killed && this.#child.exitCode === null);
  }

  get lastError(): string | null { return this.#lastError; }

  async #resolveExecutable(): Promise<string> {
    const configured = process.env.PATCH_WINDOWS_BRIDGE_PATH;
    const candidates = configured
      ? [configured]
      : app.isPackaged
        ? [path.join(process.resourcesPath, "windows-bridge", "Patch.WindowsBridge.exe")]
        : [
            // Prefer self-contained publishes so development never depends on a
            // machine-wide .NET 8 x64 runtime. scripts/dev.mjs creates the Debug
            // self-contained publish before Electron starts.
            path.resolve(app.getAppPath(), "../windows-bridge/bin/Debug/net8.0-windows/win-x64/publish/Patch.WindowsBridge.exe"),
            path.resolve(app.getAppPath(), "../windows-bridge/bin/Release/net8.0-windows/win-x64/publish/Patch.WindowsBridge.exe")
          ];
    for (const candidate of candidates) {
      try { await access(candidate); return candidate; } catch { /* try the next supported build location */ }
    }
    throw new PatchError("TOOL_UNAVAILABLE", "Windows UI Automation bridge is not available. Development must use the self-contained win-x64 publish created by `pnpm --filter @patch/desktop dev`; packaged builds bundle the same self-contained bridge.", { candidates });
  }

  async getExecutablePath(): Promise<string> { return this.#resolveExecutable(); }

  async start(): Promise<void> {
    if (process.platform !== "win32") throw new PatchError("TOOL_UNAVAILABLE", "Windows UI Automation is available only on Windows.");
    if (this.connected) return;
    if (this.#starting) return this.#starting;

    this.#starting = (async () => {
      const executable = await this.#resolveExecutable();
      const child = spawn(executable, ["--jsonl"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.#child = child;
      let stderr = "";
      const lines = readline.createInterface({ input: child.stdout });
      lines.on("line", (line) => this.#onLine(line));
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2000);
      });
      child.once("exit", (code, signal) => {
        const detail = stderr.trim();
        const suffix = detail ? ` ${detail}` : code !== null ? ` Exit code ${code}.` : signal ? ` Signal ${signal}.` : "";
        this.#disconnect(new PatchError("ADAPTER_DISCONNECTED", `Windows bridge exited.${suffix}`), child);
      });
      child.once("error", (error) => this.#disconnect(error, child));

      try {
        await this.request("ping", {}, 5000);
        this.#lastError = null;
      } catch (error: unknown) {
        child.kill();
        if (this.#child === child) this.#disconnect(error instanceof Error ? error : new PatchError("ADAPTER_DISCONNECTED", "Windows bridge failed to start."), child);
        throw error;
      }
    })().catch((error: unknown) => {
      this.#lastError = error instanceof Error ? error.message : "Windows bridge failed to start.";
      throw error;
    }).finally(() => { this.#starting = null; });

    return this.#starting;
  }

  #onLine(line: string): void {
    let parsed: z.infer<typeof BridgeReplySchema>;
    try { parsed = BridgeReplySchema.parse(JSON.parse(line)); } catch { return; }
    const pending = this.#pending.get(parsed.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(parsed.requestId);
    if (parsed.ok) pending.resolve(parsed.result);
    else {
      const bridgeCode = parsed.error?.code;
      const supported = new Set<PatchErrorCode>(["TARGET_NOT_FOUND", "TOOL_UNAVAILABLE", "ACTION_DENIED", "VALIDATION_FAILED", "ACTION_FAILED"]);
      const code: PatchErrorCode = bridgeCode && supported.has(bridgeCode as PatchErrorCode) ? bridgeCode as PatchErrorCode : "ACTION_FAILED";
      pending.reject(new PatchError(code, parsed.error?.message ?? "Windows bridge request failed.", { bridgeCode }));
    }
  }

  #disconnect(error: Error, child: ChildProcessWithoutNullStreams | null = this.#child): void {
    if (child && this.#child && this.#child !== child) return;
    this.#child = null;
    this.#lastError = error.message;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }

  async request(method: string, params: Readonly<Record<string, unknown>>, timeoutMs = 10000): Promise<unknown> {
    await this.start();
    const child = this.#child;
    if (!child || child.killed || child.exitCode !== null) throw new PatchError("ADAPTER_DISCONNECTED", "Windows bridge is not connected.");
    const requestId = crypto.randomUUID();
    const payload = JSON.stringify({ requestId, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new PatchError("ACTION_FAILED", `${method} timed out.`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      child.stdin.write(`${payload}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          this.#pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    try {
      await this.request("ping", {}, 2500);
      return true;
    } catch {
      return false;
    }
  }

  async getActiveWindow(): Promise<ActiveApplication> {
    return ActiveApplicationSchema.parse(await this.request("windows.getActiveWindow", {}));
  }

  async getAccessibilityTree(maxDepth = 7, maxNodes = 1200, nativeWindowHandle?: string): Promise<AccessibilityNode[]> {
    return z.array(AccessibilityNodeSchema).parse(await this.request("windows.getAccessibilityTree", { maxDepth, maxNodes, ...(nativeWindowHandle ? { nativeWindowHandle } : {}) }, 15000));
  }

  async execute(method: string, targetId: string | null, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    return this.request(method, { targetId, ...args });
  }

  stop(): void {
    const child = this.#child;
    if (child) child.kill();
    this.#disconnect(new PatchError("ADAPTER_DISCONNECTED", "Windows bridge stopped."), child);
  }
}
