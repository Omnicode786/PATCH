import { safeStorage } from "electron";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PatchError } from "@patch/shared";

type VaultFile = Readonly<{ version: 1; entries: Readonly<Record<string, string>> }>;

export class CredentialVault {
  readonly #filePath: string;

  constructor(userDataDirectory: string) {
    this.#filePath = path.join(userDataDirectory, "credentials.v1.json");
  }

  async #read(): Promise<VaultFile> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || !("entries" in parsed)) return { version: 1, entries: {} };
      const candidate = parsed as { entries: unknown };
      if (!candidate.entries || typeof candidate.entries !== "object" || Array.isArray(candidate.entries)) return { version: 1, entries: {} };
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(candidate.entries)) if (typeof value === "string") entries[key] = value;
      return { version: 1, entries };
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1, entries: {} };
      throw error;
    }
  }

  async #write(data: VaultFile): Promise<void> {
    const temporary = `${this.#filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#filePath);
  }

  async #assertAvailable(): Promise<void> {
    const asyncAvailable = await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
    if (!asyncAvailable) {
      throw new PatchError("ACTION_DENIED", "Secure OS credential protection is unavailable. PATCH will not persist API keys without it.");
    }
  }

  async save(name: string, secret: string): Promise<void> {
    await this.#assertAvailable();
    const current = await this.#read();
    const encrypted = await safeStorage.encryptStringAsync(secret);
    await this.#write({ version: 1, entries: { ...current.entries, [name]: encrypted.toString("base64") } });
  }

  async read(name: string): Promise<string | null> {
    await this.#assertAvailable();
    const current = await this.#read();
    const encoded = current.entries[name];
    if (!encoded) return null;
    const encrypted = Buffer.from(encoded, "base64");
    try {
      let decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) {
        // Electron may rotate the OS-backed key asynchronously. A second decrypt receives the
        // value under the refreshed key before we persist a newly encrypted vault entry.
        decrypted = await safeStorage.decryptStringAsync(encrypted);
        const refreshed = await safeStorage.encryptStringAsync(decrypted.result);
        await this.#write({ version: 1, entries: { ...current.entries, [name]: refreshed.toString("base64") } });
      }
      return decrypted.result;
    } catch {
      // Compatibility path for credentials written by older PATCH builds that used Electron's synchronous safeStorage format.
      try {
        const legacy = safeStorage.decryptString(encrypted);
        const refreshed = await safeStorage.encryptStringAsync(legacy);
        await this.#write({ version: 1, entries: { ...current.entries, [name]: refreshed.toString("base64") } });
        return legacy;
      } catch {
        throw new PatchError("AI_PROVIDER_AUTH_FAILED", "Stored credential could not be decrypted on this Windows user profile.");
      }
    }
  }

  async has(name: string): Promise<boolean> {
    const current = await this.#read();
    return Boolean(current.entries[name]);
  }

  async delete(name: string): Promise<void> {
    const current = await this.#read();
    const entries = { ...current.entries };
    delete entries[name];
    await this.#write({ version: 1, entries });
  }

  async deleteAll(): Promise<void> {
    try { await unlink(this.#filePath); } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
}
