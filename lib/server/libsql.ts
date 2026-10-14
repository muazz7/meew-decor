import { createClient, type Client, type Config, type InValue, type ResultSet } from "@libsql/client/web";
import type { StoreDatabase, StoreResult, StoreStatement } from "./database";

type SqlClient = Pick<Client, "execute" | "batch">;

function argument(value: unknown): InValue {
  if (value === null || typeof value === "string" || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value as InValue;
  throw new TypeError("SQL parameters must be strings, finite numbers, booleans, byte buffers, or null.");
}

function safeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError("SQL integer exceeds JavaScript's safe integer range.");
  return number;
}

function result<T>(set: ResultSet): StoreResult<T> {
  // libSQL rows also expose numeric indexes. Return only column names, matching D1.
  const rows = set.rows.map((row) => Object.fromEntries(set.columns.map((column, index) => {
    const value = row[index];
    return [column, typeof value === "bigint" ? safeNumber(value) : value];
  })) as T);
  return {
    success: true,
    results: rows,
    meta: { changes: set.rowsAffected, ...(set.lastInsertRowid === undefined ? {} : { last_row_id: safeNumber(set.lastInsertRowid) }) },
  };
}

type InputStatement = { sql: string; args: InValue[] };
async function transactionalResults<T>(client: SqlClient, statements: InputStatement[]): Promise<StoreResult<T>[]> {
  // The local libSQL driver reports rowsAffected=0 for INSERT/UPDATE RETURNING.
  // Sample SQLite's own counters on the same transaction/connection instead.
  // total_changes distinguishes a read/no-op from stale changes() on that connection.
  const inputs = statements.flatMap((statement) => [
    { sql: "SELECT total_changes() AS total_before", args: [] },
    statement,
    { sql: "SELECT total_changes() AS total_after, changes() AS changed, last_insert_rowid() AS inserted", args: [] },
  ]);
  const sets = await client.batch(inputs, "write");
  return statements.map((_, index) => {
    const before = Number(sets[index * 3].rows[0].total_before);
    const after = sets[index * 3 + 2].rows[0];
    const converted = result<T>(sets[index * 3 + 1]);
    const changed = Number(after.total_after) > before;
    converted.meta.changes = changed ? Number(after.changed) : 0;
    if (changed && converted.meta.last_row_id === undefined) {
      const inserted = after.inserted;
      converted.meta.last_row_id = typeof inserted === "bigint" ? safeNumber(inserted) : Number(inserted);
    }
    return converted;
  });
}

class LibsqlStatement implements StoreStatement {
  constructor(readonly owner: symbol, readonly client: SqlClient, readonly sql: string, readonly args: InValue[] = []) {}

  bind(...values: unknown[]): StoreStatement {
    return new LibsqlStatement(this.owner, this.client, this.sql, values.map(argument));
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const row = (await this.all<Record<string, unknown>>()).results[0];
    if (!row) return null;
    if (columnName === undefined) return row as T;
    if (!Object.prototype.hasOwnProperty.call(row, columnName)) throw new Error("Requested SQL result column does not exist.");
    return row[columnName] as T;
  }

  async all<T = Record<string, unknown>>(): Promise<StoreResult<T>> {
    // Plain SELECT is read-only in SQLite and its affected-row count is always 0.
    if (/^\s*SELECT\b/i.test(this.sql)) return result<T>(await this.client.execute({ sql: this.sql, args: this.args }));
    return (await transactionalResults<T>(this.client, [{ sql: this.sql, args: this.args }]))[0];
  }

  run<T = Record<string, unknown>>(): Promise<StoreResult<T>> { return this.all<T>(); }
}

/** Accepts an existing client so local-file tests use the same production adapter. */
export function wrapLibsqlClient(client: SqlClient): StoreDatabase {
  const owner = Symbol("libsql database");
  return {
    prepare(sql: string) {
      if (!sql.trim()) throw new TypeError("SQL statement must not be empty.");
      return new LibsqlStatement(owner, client, sql);
    },
    async batch<T = Record<string, unknown>>(statements: StoreStatement[]): Promise<StoreResult<T>[]> {
      if (statements.length === 0) return [];
      const inputs = statements.map((statement) => {
        if (!(statement instanceof LibsqlStatement) || statement.owner !== owner) throw new TypeError("Every batch statement must belong to the same database.");
        return { sql: statement.sql, args: statement.args };
      });
      // Never substitute Promise.all(execute): stock reservation and catalog
      // revision guards rely on sequential statements and whole-batch rollback.
      return transactionalResults<T>(client, inputs);
    },
  };
}

export function createLibsqlDatabase(options: Config): StoreDatabase {
  return wrapLibsqlClient(createClient({ ...options, intMode: "number" }));
}
