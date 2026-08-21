import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "@patch/security";

export type LogLevel = "debug" | "info" | "warn" | "error";

export class PatchLogger {
  readonly #file: string;

  constructor(directory: string) {
    this.#file = path.join(directory, "patch.jsonl");
  }

  async log(level: LogLevel, event: string, metadata: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true });
    const safe = redactSecrets(metadata);
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, metadata: safe });
    await appendFile(this.#file, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  }

  info(event: string, metadata?: Readonly<Record<string, unknown>>): Promise<void> { return this.log("info", event, metadata); }
  warn(event: string, metadata?: Readonly<Record<string, unknown>>): Promise<void> { return this.log("warn", event, metadata); }
  error(event: string, metadata?: Readonly<Record<string, unknown>>): Promise<void> { return this.log("error", event, metadata); }
}
