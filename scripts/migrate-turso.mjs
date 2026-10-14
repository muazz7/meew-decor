#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = "__meew_migrations";

/** Load the immutable Drizzle journal; never infer ordering from directory names. */
export async function loadMigrations(directory = resolve(projectRoot, "drizzle")) {
  const journal = JSON.parse(await readFile(resolve(directory, "meta/_journal.json"), "utf8"));
  if (journal.dialect !== "sqlite" || !Array.isArray(journal.entries)) throw new Error("Expected a SQLite Drizzle migration journal.");
  const tags = new Set();
  const migrations = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (!entry || entry.idx !== index || typeof entry.tag !== "string" || !/^\d{4,}_[a-zA-Z0-9_-]+$/.test(entry.tag) || tags.has(entry.tag)) throw new Error("Migration journal has an invalid order or tag.");
    tags.add(entry.tag);
    const sql = await readFile(resolve(directory, `${entry.tag}.sql`), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
    if (statements.length === 0) throw new Error(`Migration ${entry.tag} is empty.`);
    migrations.push({ ordinal: index, tag: entry.tag, checksum: createHash("sha256").update(sql).digest("hex"), statements });
  }
  return migrations;
}

function verifyLedger(rows, migrations) {
  if (rows.length > migrations.length) throw new Error("The database contains migrations missing from this checkout. Use the current source before migrating.");
  for (const [index, row] of rows.entries()) {
    const expected = migrations[index];
    if (Number(row.ordinal) !== index || row.tag !== expected.tag) throw new Error("Applied migrations are not a prefix of this checkout's journal. Refusing to modify the database.");
    if (row.checksum !== expected.checksum) throw new Error(`Applied migration ${expected.tag} was edited. Restore the original file and add a new migration instead.`);
  }
}

function isBusy(error) {
  return error && typeof error === "object" && typeof error.code === "string" && (error.code.startsWith("SQLITE_BUSY") || error.code.startsWith("SQLITE_LOCKED"));
}

async function writeTransaction(client, operation) {
  for (let attempt = 0; ; attempt++) {
    let transaction;
    try {
      transaction = await client.transaction("write");
      const value = await operation(transaction);
      await transaction.commit();
      return value;
    } catch (error) {
      if (transaction && !transaction.closed) {
        try { await transaction.rollback(); } catch { /* Preserve the original error. */ }
      }
      if (!isBusy(error) || attempt >= 5) throw error;
      // Some local driver versions retain a failed BEGIN/COMMIT statement on a
      // pooled connection after SQLITE_BUSY. This command owns its client, so
      // discard that connection before retrying the verified migration ledger.
      if (typeof client.reconnect === "function") await client.reconnect();
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, 100 * 2 ** attempt)));
    } finally {
      transaction?.close();
    }
  }
}

/** Explicit deployment operation. Never imported or invoked by build/runtime code. */
export async function migrateTurso(client, migrations) {
  const applied = [];
  for (;;) {
    const tag = await writeTransaction(client, async (transaction) => {
      // BEGIN IMMEDIATE serializes ledger inspection and schema updates, including
      // two administrators launching this command at the same time.
      await transaction.execute(`CREATE TABLE IF NOT EXISTS ${ledger} (ordinal INTEGER PRIMARY KEY NOT NULL, tag TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
      const current = await transaction.execute(`SELECT ordinal,tag,checksum FROM ${ledger} ORDER BY ordinal`);
      verifyLedger(current.rows, migrations);
      const next = migrations[current.rows.length];
      if (!next) return null;
      await transaction.batch([
        ...next.statements.map((sql) => ({ sql, args: [] })),
        { sql: `INSERT INTO ${ledger} (ordinal,tag,checksum,applied_at) VALUES (?,?,?,?)`, args: [next.ordinal, next.tag, next.checksum, new Date().toISOString()] },
      ]);
      return next.tag;
    });
    if (tag === null) return { applied, total: migrations.length };
    applied.push(tag);
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("Set TURSO_DATABASE_URL before running this explicit migration command.");
  const parsed = new URL(url);
  if (!["libsql:", "https:", "file:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Use a secure remote libSQL/HTTPS URL, or a local file URL for development.");
  if (parsed.protocol !== "file:" && !authToken) throw new Error("Set TURSO_AUTH_TOKEN for the remote database.");
  const migrations = await loadMigrations();
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken, intMode: "number" });
  try {
    const result = await migrateTurso(client, migrations);
    console.log(result.applied.length ? `Applied ${result.applied.length} migration(s): ${result.applied.join(", ")}` : `Database is current (${result.total} migration(s)).`);
  } finally { client.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    // Do not print client config, database URLs, auth tokens, or transport traces.
    let message = error instanceof Error ? error.message : "Migration failed.";
    if (process.env.TURSO_AUTH_TOKEN) message = message.replaceAll(process.env.TURSO_AUTH_TOKEN, "[redacted]");
    console.error(`Migration failed: ${message.replace(/(?:libsql|https?):\/\/[^\s]+/g, "[database endpoint]")}`);
    process.exitCode = 1;
  });
}
