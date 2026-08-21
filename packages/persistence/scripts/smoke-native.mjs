import Database from "better-sqlite3";

const db = new Database(":memory:");
try {
  const row = db.prepare("select 1 as ok").get();
  if (!row || row.ok !== 1) throw new Error("SQLite readback failed.");
  console.log("PATCH_BETTER_SQLITE3_SMOKE_OK");
} finally {
  db.close();
}
