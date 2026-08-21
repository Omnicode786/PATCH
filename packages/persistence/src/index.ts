import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const providerMetadata = sqliteTable("provider_metadata", {
  providerId: text("provider_id").primaryKey(),
  configured: integer("configured", { mode: "boolean" }).notNull().default(false),
  defaultModel: text("default_model"),
  visionModel: text("vision_model"),
  reasoningModel: text("reasoning_model"),
  updatedAt: text("updated_at").notNull()
});

export const permissions = sqliteTable("permissions", {
  capability: text("capability").notNull(),
  scope: text("scope").notNull().default("global"),
  allowed: integer("allowed", { mode: "boolean" }).notNull(),
  updatedAt: text("updated_at").notNull()
});

export const savedPatches = sqliteTable("saved_patches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  pathPattern: text("path_pattern").notNull(),
  dslJson: text("dsl_json").notNull(),
  createdAt: text("created_at").notNull(),
  lastAppliedAt: text("last_applied_at"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true)
});

export type ProviderMetadataRecord = typeof providerMetadata.$inferSelect;
export type SavedPatchRecord = typeof savedPatches.$inferSelect;

export class PatchDatabase {
  readonly #sqlite: Database.Database;
  readonly db: BetterSQLite3Database;

  constructor(filePath: string) {
    this.#sqlite = new Database(filePath);
    this.#sqlite.pragma("journal_mode = WAL");
    this.#sqlite.pragma("foreign_keys = ON");
    this.#migrate();
    this.db = drizzle(this.#sqlite);
  }

  #migrate(): void {
    this.#sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_metadata (
        provider_id TEXT PRIMARY KEY,
        configured INTEGER NOT NULL DEFAULT 0,
        default_model TEXT,
        vision_model TEXT,
        reasoning_model TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permissions (
        capability TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        allowed INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (capability, scope)
      );
      CREATE TABLE IF NOT EXISTS saved_patches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        path_pattern TEXT NOT NULL,
        dsl_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_applied_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) return fallback;
    try { return JSON.parse(row.valueJson) as T; } catch { return fallback; }
  }

  setSetting(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db.insert(settings).values({ key, valueJson: JSON.stringify(value), updatedAt: now }).onConflictDoUpdate({
      target: settings.key,
      set: { valueJson: JSON.stringify(value), updatedAt: now }
    }).run();
  }

  listProviders(): ProviderMetadataRecord[] {
    return this.db.select().from(providerMetadata).all();
  }

  getProvider(providerId: string): ProviderMetadataRecord | null {
    return this.db.select().from(providerMetadata).where(eq(providerMetadata.providerId, providerId)).get() ?? null;
  }

  saveProvider(record: Omit<ProviderMetadataRecord, "updatedAt">): void {
    const updatedAt = new Date().toISOString();
    this.db.insert(providerMetadata).values({ ...record, updatedAt }).onConflictDoUpdate({
      target: providerMetadata.providerId,
      set: { ...record, updatedAt }
    }).run();
  }

  setPermission(capability: string, allowed: boolean, scope = "global"): void {
    const updatedAt = new Date().toISOString();
    this.db.insert(permissions).values({ capability, scope, allowed, updatedAt }).onConflictDoUpdate({
      target: [permissions.capability, permissions.scope],
      set: { allowed, updatedAt }
    }).run();
  }

  getPermission(capability: string, scope = "global"): boolean | null {
    return this.db.select().from(permissions).where(and(eq(permissions.capability, capability), eq(permissions.scope, scope))).get()?.allowed ?? null;
  }

  listSavedPatches(): SavedPatchRecord[] {
    return this.db.select().from(savedPatches).all();
  }

  upsertSavedPatch(record: SavedPatchRecord): void {
    this.db.insert(savedPatches).values(record).onConflictDoUpdate({
      target: savedPatches.id,
      set: record
    }).run();
  }

  deleteSavedPatch(id: string): void {
    this.db.delete(savedPatches).where(eq(savedPatches.id, id)).run();
  }

  close(): void {
    this.#sqlite.close();
  }
}
