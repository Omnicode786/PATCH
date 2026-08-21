import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { PhotoshopContextSchema, type PhotoshopContext } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import type { CredentialVault } from "./credential-vault";

const MAX_BODY = 1_000_000;
const TOKEN_KEY = "adapter:photoshop";

type Command = Readonly<{ requestId: string; method: string; params: Readonly<Record<string, unknown>> }>;
type Pending = Readonly<{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
type Waiter = Readonly<{ response: ServerResponse; timer: NodeJS.Timeout }>;

export class PhotoshopBridgeServer {
  readonly #vault: CredentialVault;
  readonly #port: number;
  #server: http.Server | null = null;
  #clientId: string | null = null;
  readonly #queue: Command[] = [];
  readonly #pending = new Map<string, Pending>();
  #waiter: Waiter | null = null;
  #lastSeen = 0;

  constructor(vault: CredentialVault, port = 49373) {
    this.#vault = vault;
    this.#port = port;
  }

  get connected(): boolean { return Boolean(this.#clientId && Date.now() - this.#lastSeen < 35_000); }
  get port(): number { return this.#port; }

  async getPairingCode(): Promise<string> {
    const existing = await this.#vault.read(TOKEN_KEY);
    if (existing) return existing;
    const token = crypto.randomUUID().replaceAll("-", "");
    await this.#vault.save(TOKEN_KEY, token);
    return token;
  }

  async rotatePairingCode(): Promise<string> {
    const token = crypto.randomUUID().replaceAll("-", "");
    await this.#vault.save(TOKEN_KEY, token);
    this.#clientId = null;
    this.#queue.length = 0;
    if (this.#waiter) {
      clearTimeout(this.#waiter.timer);
      this.#json(this.#waiter.response, 200, { ok: true, command: null });
      this.#waiter = null;
    }
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new PatchError("ADAPTER_DISCONNECTED", "Photoshop pairing code changed. Reconnect the PATCH Photoshop panel."));
    }
    this.#pending.clear();
    return token;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    await this.getPairingCode();
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.#server?.once("error", reject);
      this.#server?.listen(this.#port, "127.0.0.1", () => resolve());
    });
  }

  #headers(res: ServerResponse): void {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
  }

  #json(res: ServerResponse, status: number, payload: unknown): void {
    this.#headers(res);
    res.statusCode = status;
    res.end(JSON.stringify(payload));
  }

  async #body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > MAX_BODY) throw new Error("Request body too large.");
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) as unknown : {};
  }

  async #authenticated(req: IncomingMessage): Promise<boolean> {
    const expected = await this.#vault.read(TOKEN_KEY);
    const provided = req.headers["x-patch-adapter-token"];
    return typeof provided === "string" && Boolean(expected) && provided === expected;
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === "POST" && req.url === "/v1/pair") {
        if (!await this.#authenticated(req)) return this.#json(res, 401, { ok: false, error: "PAIRING_DENIED" });
        this.#clientId = crypto.randomUUID();
        this.#lastSeen = Date.now();
        return this.#json(res, 200, { ok: true, clientId: this.#clientId });
      }
      if (!await this.#authenticated(req)) return this.#json(res, 401, { ok: false, error: "AUTH_DENIED" });
      const clientId = req.headers["x-patch-client-id"];
      if (typeof clientId !== "string" || clientId !== this.#clientId) return this.#json(res, 401, { ok: false, error: "CLIENT_DENIED" });
      this.#lastSeen = Date.now();

      if (req.method === "GET" && req.url === "/v1/next") {
        const command = this.#queue.shift();
        if (command) return this.#json(res, 200, { ok: true, command });
        if (this.#waiter) {
          clearTimeout(this.#waiter.timer);
          this.#json(this.#waiter.response, 200, { ok: true, command: null });
          this.#waiter = null;
        }
        const timer = setTimeout(() => {
          if (this.#waiter?.response === res) this.#waiter = null;
          this.#json(res, 200, { ok: true, command: null });
        }, 25_000);
        this.#waiter = { response: res, timer };
        req.once("close", () => {
          if (this.#waiter?.response === res) { clearTimeout(timer); this.#waiter = null; }
        });
        return;
      }

      if (req.method === "POST" && req.url === "/v1/result") {
        const body = await this.#body(req);
        if (!body || typeof body !== "object" || !("requestId" in body) || typeof body.requestId !== "string") return this.#json(res, 400, { ok: false, error: "INVALID_RESULT" });
        const pending = this.#pending.get(body.requestId);
        if (!pending) return this.#json(res, 404, { ok: false, error: "UNKNOWN_REQUEST" });
        clearTimeout(pending.timer);
        this.#pending.delete(body.requestId);
        const ok = "ok" in body && body.ok === true;
        if (ok) pending.resolve("result" in body ? body.result : undefined);
        else pending.reject(new PatchError("ACTION_FAILED", "error" in body && typeof body.error === "string" ? body.error : "Photoshop action failed."));
        return this.#json(res, 200, { ok: true });
      }

      return this.#json(res, 404, { ok: false, error: "NOT_FOUND" });
    } catch (error: unknown) {
      this.#json(res, 500, { ok: false, error: error instanceof Error ? error.message : "Internal adapter error" });
    }
  }

  request(method: string, params: Readonly<Record<string, unknown>> = {}, timeoutMs = 15000): Promise<unknown> {
    if (!this.connected) return Promise.reject(new PatchError("ADAPTER_DISCONNECTED", "Photoshop UXP adapter is not connected. Open the PATCH panel in Photoshop."));
    const requestId = crypto.randomUUID();
    const command = { requestId, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new PatchError("ACTION_FAILED", `${method} timed out.`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
      if (this.#waiter) {
        const waiter = this.#waiter;
        this.#waiter = null;
        clearTimeout(waiter.timer);
        this.#json(waiter.response, 200, { ok: true, command });
      } else this.#queue.push(command);
    });
  }

  async getContext(): Promise<PhotoshopContext> {
    return PhotoshopContextSchema.parse(await this.request("photoshop.getDocument"));
  }

  async close(): Promise<void> {
    if (this.#waiter) { clearTimeout(this.#waiter.timer); this.#json(this.#waiter.response, 200, { ok: true, command: null }); this.#waiter = null; }
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new PatchError("ADAPTER_DISCONNECTED", "Photoshop bridge closed.")); }
    this.#pending.clear();
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()) ?? resolve());
    this.#server = null;
  }
}
