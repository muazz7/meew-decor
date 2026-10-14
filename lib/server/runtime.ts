import { env, getDatabase, authProvider } from "@meew/platform";
import type { StoreDatabase } from "./database";
import { headers } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ownerAuthIssues, ownerSessionFromCookie, verifyOwnerSession } from "./owner-auth";
import { StoreError } from "./validation";

export { env, authProvider };
export function database(): StoreDatabase { const db = getDatabase(); if (!db) throw new StoreError("The store is being prepared. Please contact Meew Decor for help.", 503); return db; }
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
  if (authProvider === "password") {
    if (ownerAuthIssues(env).length) throw new StoreError("Owner sign-in is not configured. Complete the owner setup in the hosting environment.", 503);
    const token = ownerSessionFromCookie((await headers()).get("cookie"));
    const session = token ? await verifyOwnerSession(token, env) : null;
    if (!session) throw new StoreError("Sign in to manage the store.", 401);
    return { userId: "store-owner", displayName: session.email, email: session.email, fullName: null };
  }
  // The platform adapter is a build-time choice, never a request-header choice.
  // Only Sites/Cloudflare's authenticated dispatch may supply OAI identity headers.
  if (authProvider !== "chatgpt") throw new StoreError("Owner sign-in is unavailable.", 503);
  const user = await getChatGPTUser();
  if (!user) throw new StoreError("Sign in to manage the store.", 401);
  if (!env.STORE_ADMIN_EMAIL || user.email.toLowerCase() !== env.STORE_ADMIN_EMAIL.trim().toLowerCase()) throw new StoreError("This account does not have store management access.", 403);
  return user;
}
export async function sha256(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
export async function rateLimit(request: Request, prefix: string, maximum: number, scope?: "global") {
  const db = database();
  const window = Math.floor(Date.now() / 600000);
  // Vercel overwrites x-forwarded-for at its edge. Never use caller-controlled
  // Cloudflare headers on the Node deployment. Local Node traffic shares a bucket.
  const client = authProvider === "chatgpt" ? request.headers.get("cf-connecting-ip") : env.VERCEL === "1" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  const key = `${prefix}:${window}:${await sha256(scope === "global" ? "all-clients" : client || "unknown")}`;
  const result = await db.prepare("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind(key, (window + 1) * 600000).first<{ count: number }>();
  if (!result || result.count > maximum) throw new StoreError("Too many attempts. Please wait a few minutes before trying again.", 429);
  // Bounded cleanup prevents unbounded request-log growth; no raw IP is stored.
  await db.prepare("DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at < ? LIMIT 100)").bind(Date.now()).run();
}
