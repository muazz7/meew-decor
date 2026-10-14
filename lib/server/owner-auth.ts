// Portable Web Crypto primitives: this module is safe to bundle for either host.
// Password authentication is selected only by the Node platform adapter.
export const OWNER_SESSION_COOKIE = "__Host-meew_admin";
export const OWNER_SESSION_SECONDS = 8 * 60 * 60;
export const OWNER_HASH_ITERATIONS = 600000;
type AuthEnvironment = { STORE_ADMIN_EMAIL?: string; STORE_ADMIN_PASSWORD_HASH?: string; STORE_SESSION_SECRET?: string };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding.");
  const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error("Invalid encoding.");
  return bytes;
}
function equalBytes(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index++) difference |= first[index] ^ second[index];
  return difference === 0;
}
function parseHash(value: string) {
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256" || !/^\d{6,7}$/.test(parts[1])) throw new Error("Invalid password hash.");
  const iterations = Number(parts[1]), salt = decode(parts[2]), digest = decode(parts[3]);
  if (iterations < OWNER_HASH_ITERATIONS || iterations > 2000000 || salt.length !== 32 || digest.length !== 32) throw new Error("Invalid password hash.");
  return { iterations, salt, digest };
}
export function ownerAuthIssues(env: AuthEnvironment): string[] {
  const issues: string[] = [];
  if (!env.STORE_ADMIN_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.STORE_ADMIN_EMAIL.trim())) issues.push("Configure STORE_ADMIN_EMAIL with the owner's email address.");
  try { parseHash(env.STORE_ADMIN_PASSWORD_HASH || ""); } catch { issues.push("Configure STORE_ADMIN_PASSWORD_HASH using the password setup command."); }
  if (!env.STORE_SESSION_SECRET || encoder.encode(env.STORE_SESSION_SECRET).length < 32) issues.push("Configure STORE_SESSION_SECRET with a random secret of at least 32 bytes.");
  return issues;
}
async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}
export async function hashOwnerPassword(password: string): Promise<string> {
  if (password.length < 16 || encoder.encode(password).length > 1024) throw new Error("Use a password of at least 16 characters and at most 1024 bytes.");
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return `pbkdf2_sha256$${OWNER_HASH_ITERATIONS}$${encode(salt)}$${encode(await derive(password, salt, OWNER_HASH_ITERATIONS))}`;
}
export async function verifyOwnerCredentials(email: string, password: string, env: AuthEnvironment): Promise<boolean> {
  if (ownerAuthIssues(env).length || email.length > 254 || encoder.encode(password).length > 1024) return false;
  const stored = parseHash(env.STORE_ADMIN_PASSWORD_HASH!);
  // Always perform the expensive password derivation, even for the wrong email.
  const actual = await derive(password, stored.salt, stored.iterations);
  const [candidateEmail, ownerEmail] = await Promise.all([email, env.STORE_ADMIN_EMAIL!].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value.trim().toLowerCase()))));
  const passwordMatches = equalBytes(actual, stored.digest);
  const emailMatches = equalBytes(new Uint8Array(candidateEmail), new Uint8Array(ownerEmail));
  return passwordMatches && emailMatches;
}
async function signingKey(secret: string) { return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }
async function credentialVersion(env: AuthEnvironment) { return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(env.STORE_ADMIN_PASSWORD_HASH!)))); }
export async function createOwnerSession(env: AuthEnvironment, now = Math.floor(Date.now() / 1000)): Promise<string> {
  if (ownerAuthIssues(env).length) throw new Error("Owner authentication is not configured.");
  const payload = { v: 1, sub: env.STORE_ADMIN_EMAIL!.trim().toLowerCase(), iat: now, exp: now + OWNER_SESSION_SECONDS, credentialVersion: await credentialVersion(env), nonce: encode(crypto.getRandomValues(new Uint8Array(16))) };
  const encoded = encode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env.STORE_SESSION_SECRET!), encoder.encode(`meew-owner.v1.${encoded}`)));
  return `${encoded}.${encode(signature)}`;
}
export async function verifyOwnerSession(token: string, env: AuthEnvironment, now = Math.floor(Date.now() / 1000)): Promise<{ email: string } | null> {
  try {
    if (token.length > 2048 || ownerAuthIssues(env).length) return null;
    const [encoded, encodedSignature, extra] = token.split(".");
    if (!encoded || !encodedSignature || extra !== undefined) return null;
    const signature = decode(encodedSignature);
    if (signature.length !== 32 || !await crypto.subtle.verify("HMAC", await signingKey(env.STORE_SESSION_SECRET!), signature, encoder.encode(`meew-owner.v1.${encoded}`))) return null;
    const payload: unknown = JSON.parse(decoder.decode(decode(encoded)));
    if (!payload || typeof payload !== "object") return null;
    const value = payload as Record<string, unknown>;
    if (value.v !== 1 || value.sub !== env.STORE_ADMIN_EMAIL!.trim().toLowerCase() || !Number.isInteger(value.iat) || !Number.isInteger(value.exp) || typeof value.iat !== "number" || typeof value.exp !== "number" || value.iat > now + 30 || value.exp <= now || value.exp - value.iat !== OWNER_SESSION_SECONDS || value.credentialVersion !== await credentialVersion(env) || typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value.nonce)) return null;
    return { email: value.sub as string };
  } catch { return null; }
}
export function ownerSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader || cookieHeader.length > 16000) return null;
  const matches = cookieHeader.split(";").map(item => item.trim()).filter(item => item.startsWith(`${OWNER_SESSION_COOKIE}=`));
  // Reject ambiguous cookie names instead of accepting a shadowed credential.
  return matches.length === 1 ? matches[0].slice(OWNER_SESSION_COOKIE.length + 1) : null;
}
export function ownerSessionCookie(token: string, expires = false): string {
  return `${OWNER_SESSION_COOKIE}=${expires ? "" : token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${expires ? 0 : OWNER_SESSION_SECONDS}${expires ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : ""}`;
}
