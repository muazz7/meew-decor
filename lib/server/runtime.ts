import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { StoreError } from "./validation";

export { env };
export function database(): D1Database { if (!env.DB) throw new StoreError("The store is being prepared. Please contact Meew Decor for help.", 503); return env.DB; }
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } }); }
export function errorResponse(error: unknown) { return json({ error: error instanceof StoreError ? error.message : "We couldn’t complete this request. Please try again or contact Meew Decor." }, error instanceof StoreError ? error.status : 500); }
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new StoreError("JSON request required.", 415);
  const declaredSize = Number(request.headers.get("content-length") || "0");
  if (declaredSize > 24000) throw new StoreError("Request too large.", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 24000) throw new StoreError("Request too large.", 413);
  try { return JSON.parse(raw); } catch { throw new StoreError("Invalid request."); }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new StoreError("Please submit this request from the store website.", 403);
}
export async function requireAdmin() {
  const user = await getChatGPTUser();
  if (!user) throw new StoreError("Sign in to manage the store.", 401);
  if (!env.STORE_ADMIN_EMAIL || user.email.toLowerCase() !== env.STORE_ADMIN_EMAIL.trim().toLowerCase()) throw new StoreError("This account does not have store management access.", 403);
  return user;
}
export async function sha256(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function rateLimit(request: Request, prefix: string, maximum: number) {
  const db = database();
  const window = Math.floor(Date.now() / 600000);
  const key = `${prefix}:${window}:${await sha256(request.headers.get("cf-connecting-ip") || "unknown")}`;
  const result = await db.prepare("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(key, (window + 1) * 600000).first<{ count: number }>();
  if (!result || result.count > maximum) throw new StoreError("Too many attempts. Please wait a few minutes before trying again.", 429);
  // Bounded cleanup prevents unbounded request-log growth; no raw IP is stored.
  await db.prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 100)").bind(Date.now()).run();
}
