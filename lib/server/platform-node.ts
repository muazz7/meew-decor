import type { PlatformEnvironment, StoreDatabase } from "./database";
import { createLibsqlDatabase } from "./libsql";

export const authProvider: "password" | "chatgpt" = "password";
let cached: { url: string; token: string; database: StoreDatabase } | undefined;

/** Lazy: importing/building the storefront never connects to or changes a database. */
export function getDatabase(): StoreDatabase | undefined {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) return undefined;
  const parsed = new URL(url);
  if (!["libsql:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("TURSO_DATABASE_URL must be a secure remote libSQL or HTTPS URL.");
  }
  if (!cached || cached.url !== url || cached.token !== token) cached = { url, token, database: createLibsqlDatabase({ url, authToken: token }) };
  return cached.database;
}

// Existing payment code receives env.DB. Preserve that shape without eagerly
// constructing a client, copying secrets into a bundle, or mutating process.env.
export const env = new Proxy(process.env, {
  get(target, property) { return property === "DB" ? getDatabase() : Reflect.get(target, property); },
}) as unknown as PlatformEnvironment;
