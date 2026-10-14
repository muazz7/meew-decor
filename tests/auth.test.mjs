import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pbkdf2Sync } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'meew-auth-'));
const harness = { env: {}, headers: new Headers(), db: null, headerAuthCalls: 0 };
globalThis.__ownerAuthHarness = harness;
const moduleUrl = name => pathToFileURL(join(temp, `${name}.mjs`)).href;
await writeFile(join(temp, 'platform.mjs'), 'export const env = globalThis.__ownerAuthHarness.env; export const authProvider = "password"; export function getDatabase() { return globalThis.__ownerAuthHarness.db; }');
await writeFile(join(temp, 'headers.mjs'), 'export async function headers() { return globalThis.__ownerAuthHarness.headers; }');
await writeFile(join(temp, 'chatgpt.mjs'), 'export async function getChatGPTUser() { globalThis.__ownerAuthHarness.headerAuthCalls++; throw new Error("Sites identity must never be read on Node"); }');
async function compile(name, path) {
  const source = await readFile(join(root, path), 'utf8');
  const code = stripTypeScriptTypes(source)
    .replace(/(["'])@meew\/platform\1/g, JSON.stringify(moduleUrl('platform')))
    .replace(/(["'])next\/headers\1/g, JSON.stringify(moduleUrl('headers')))
    .replace(/(["'])@\/app\/chatgpt-auth\1/g, JSON.stringify(moduleUrl('chatgpt')))
    .replace(/(["'])(?:@\/lib\/server\/|\.\/)(validation|runtime|owner-auth)\1/g, (_, _quote, module) => JSON.stringify(moduleUrl(module)));
  await writeFile(join(temp, `${name}.mjs`), code);
}
for (const name of ['validation', 'owner-auth', 'runtime']) await compile(name, `lib/server/${name}.ts`);
await compile('login', 'app/api/admin/auth/login/route.ts');
await compile('logout', 'app/api/admin/auth/logout/route.ts');
await compile('info', 'app/api/admin/auth/route.ts');
const auth = await import(moduleUrl('owner-auth'));
const runtime = await import(moduleUrl('runtime'));
const login = await import(moduleUrl('login'));
const logout = await import(moduleUrl('logout'));
const info = await import(moduleUrl('info'));
// Synthetic credentials exist only in this isolated test database/environment.
const password = 'A synthetic owner password for tests only';
const passwordHash = await auth.hashOwnerPassword(password);
let sqlite;
beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  harness.db = { prepare(sql) { let values = []; return { bind(...input) { values = input; return this; }, async first() { return sqlite.prepare(sql).get(...values) || null; }, async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; } }; } };
  for (const key of Object.keys(harness.env)) delete harness.env[key];
  Object.assign(harness.env, { STORE_ADMIN_EMAIL: 'owner@example.com', STORE_ADMIN_PASSWORD_HASH: passwordHash, STORE_SESSION_SECRET: 'synthetic-session-secret-for-isolated-tests-only', VERCEL: '1' });
  harness.headers = new Headers(); harness.headerAuthCalls = 0;
});
after(async () => { sqlite?.close(); delete globalThis.__ownerAuthHarness; await rm(temp, { recursive: true, force: true }); });
function request(path, value = {}, extra = {}) { return new Request(`https://store.example.com${path}`, { method: 'POST', headers: { origin: 'https://store.example.com', 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1', ...extra }, body: JSON.stringify(value) }); }

test('password hashes use PBKDF2-SHA256, random salt and match the Node setup helper format', async () => {
  const [algorithm, iterations, salt, digest] = passwordHash.split('$');
  assert.equal(algorithm, 'pbkdf2_sha256'); assert.equal(Number(iterations), 600000);
  assert.equal(Buffer.from(salt, 'base64url').length, 32);
  assert.equal(pbkdf2Sync(password, Buffer.from(salt, 'base64url'), 600000, 32, 'sha256').toString('base64url'), digest);
  assert.notEqual(await auth.hashOwnerPassword(password), passwordHash);
  assert.equal(await auth.verifyOwnerCredentials(' OWNER@example.com ', password, harness.env), true);
  assert.equal(await auth.verifyOwnerCredentials('someone@example.com', password, harness.env), false);
  assert.equal(await auth.verifyOwnerCredentials('owner@example.com', 'wrong password', harness.env), false);
});
test('password setup and verification fail closed for weak or malformed configuration', async () => {
  await assert.rejects(() => auth.hashOwnerPassword('short'));
  for (const field of ['STORE_ADMIN_EMAIL', 'STORE_ADMIN_PASSWORD_HASH', 'STORE_SESSION_SECRET']) {
    const broken = { ...harness.env, [field]: '' };
    assert.ok(auth.ownerAuthIssues(broken).length);
    assert.equal(await auth.verifyOwnerCredentials('owner@example.com', password, broken), false);
    await assert.rejects(() => auth.createOwnerSession(broken));
  }
  assert.ok(auth.ownerAuthIssues({ ...harness.env, STORE_ADMIN_PASSWORD_HASH: passwordHash.replace('$600000$', '$100000$') }).length);
});
test('signed owner sessions reject tampering, wrong secrets, expiry and future issuance', async () => {
  const now = 1900000000, token = await auth.createOwnerSession(harness.env, now);
  assert.deepEqual(await auth.verifyOwnerSession(token, harness.env, now), { email: 'owner@example.com' });
  assert.equal(await auth.verifyOwnerSession(token, harness.env, now + auth.OWNER_SESSION_SECONDS), null);
  assert.equal(await auth.verifyOwnerSession(token, harness.env, now - 60), null);
  const [payload, signature] = token.split('.');
  const edited = JSON.parse(Buffer.from(payload, 'base64url').toString()); edited.sub = 'intruder@example.com';
  assert.equal(await auth.verifyOwnerSession(`${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${signature}`, harness.env, now), null);
  assert.equal(await auth.verifyOwnerSession(`${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`, harness.env, now), null);
  assert.equal(await auth.verifyOwnerSession(token, { ...harness.env, STORE_SESSION_SECRET: 'a different synthetic secret with enough length' }, now), null);
  assert.equal(await auth.verifyOwnerSession(`${token}.extra`, harness.env, now), null);
});
test('owner email or password rotation invalidates existing sessions', async () => {
  const token = await auth.createOwnerSession(harness.env);
  assert.equal(await auth.verifyOwnerSession(token, { ...harness.env, STORE_ADMIN_EMAIL: 'new-owner@example.com' }), null);
  assert.equal(await auth.verifyOwnerSession(token, { ...harness.env, STORE_ADMIN_PASSWORD_HASH: await auth.hashOwnerPassword(password) }), null);
});
test('Node owner authorization never trusts spoofed Sites identity headers', async () => {
  harness.headers = new Headers({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com', 'oai-authenticated-user-full-name': 'Owner' });
  await assert.rejects(() => runtime.requireAdmin(), error => error.status === 401);
  assert.equal(harness.headerAuthCalls, 0);
  const token = await auth.createOwnerSession(harness.env);
  harness.headers.set('cookie', `${auth.OWNER_SESSION_COOKIE}=${token}`);
  harness.headers.set('oai-authenticated-user-email', 'intruder@example.com');
  assert.equal((await runtime.requireAdmin()).email, 'owner@example.com');
  assert.equal(harness.headerAuthCalls, 0);
  harness.headers.set('cookie', `${auth.OWNER_SESSION_COOKIE}=${token}; ${auth.OWNER_SESSION_COOKIE}=fake`);
  await assert.rejects(() => runtime.requireAdmin(), error => error.status === 401);
});
test('login checks the same origin and returns a secure private session only for valid credentials', async () => {
  const rejected = await login.POST(request('/api/admin/auth/login', { email: 'owner@example.com', password }, { origin: 'https://evil.example' }));
  assert.equal(rejected.status, 403); assert.equal(rejected.headers.get('set-cookie'), null);
  const accepted = await login.POST(request('/api/admin/auth/login', { email: 'owner@example.com', password }));
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get('set-cookie');
  assert.match(cookie, /^__Host-meew_admin=/); assert.match(cookie, /; HttpOnly;/); assert.match(cookie, /; Secure;/); assert.match(cookie, /; SameSite=Strict;/); assert.match(cookie, /; Path=\//); assert.match(cookie, /Max-Age=28800/);
  assert.equal(accepted.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await accepted.json(), { authenticated: true });
  harness.headers = new Headers({ cookie: cookie.split(';')[0] });
  assert.equal((await runtime.requireAdmin()).email, 'owner@example.com');
});
test('unknown email and wrong password have the same generic response', async () => {
  const wrongEmail = await login.POST(request('/api/admin/auth/login', { email: 'other@example.com', password }));
  const wrongPassword = await login.POST(request('/api/admin/auth/login', { email: 'owner@example.com', password: 'an incorrect test password' }));
  assert.equal(wrongEmail.status, 401); assert.equal(wrongPassword.status, 401);
  assert.deepEqual(await wrongEmail.json(), await wrongPassword.json());
  assert.equal(wrongEmail.headers.get('set-cookie'), null);
});
test('login rate limiting persists in the database and ignores spoofed Cloudflare IP headers on Node', async () => {
  for (let index = 0; index < 10; index++) assert.equal((await login.POST(request('/api/admin/auth/login', {}, { 'cf-connecting-ip': `198.51.100.${index}` }))).status, 401);
  assert.equal((await login.POST(request('/api/admin/auth/login', {}, { 'cf-connecting-ip': '198.51.100.200' }))).status, 429);
});
test('independent account limit also blocks attempts across different client IP addresses', async () => {
  for (let index = 0; index < 30; index++) assert.equal((await login.POST(request('/api/admin/auth/login', {}, { 'x-forwarded-for': `198.51.100.${index}` }))).status, 401);
  assert.equal((await login.POST(request('/api/admin/auth/login', {}, { 'x-forwarded-for': '198.51.100.200' }))).status, 429);
});
test('missing auth configuration or database prevents login without issuing a cookie', async () => {
  delete harness.env.STORE_SESSION_SECRET;
  const configFailure = await login.POST(request('/api/admin/auth/login', { email: 'owner@example.com', password }));
  assert.equal(configFailure.status, 503); assert.equal(configFailure.headers.get('set-cookie'), null);
  harness.env.STORE_SESSION_SECRET = 'synthetic-session-secret-for-isolated-tests-only'; harness.db = null;
  const dbFailure = await login.POST(request('/api/admin/auth/login', { email: 'owner@example.com', password }));
  assert.equal(dbFailure.status, 503); assert.equal(dbFailure.headers.get('set-cookie'), null);
});
test('auth information reveals the method and readiness without credentials; logout expires the cookie', async () => {
  const anonymous = await info.GET(), details = await anonymous.json();
  assert.deepEqual(details, { provider: 'password', configured: true, authenticated: false, issues: [] });
  assert.equal(JSON.stringify(details).includes(passwordHash), false);
  const denied = await logout.POST(request('/api/admin/auth/logout', {}, { origin: 'https://evil.example' }));
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('set-cookie'), null);
  const result = await logout.POST(request('/api/admin/auth/logout'));
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Max-Age=0/); assert.match(result.headers.get('set-cookie'), /; HttpOnly; Secure; SameSite=Strict/);
  assert.equal(auth.ownerSessionFromCookie(result.headers.get('set-cookie').split(';')[0]), '');
});
test('owner setup information remains available without a database connection', async () => {
  harness.db = null;
  const configured = await info.GET();
  assert.equal(configured.status, 200); assert.equal((await configured.json()).configured, true);
  delete harness.env.STORE_SESSION_SECRET;
  const incomplete = await info.GET(), details = await incomplete.json();
  assert.equal(incomplete.status, 200); assert.equal(details.provider, 'password'); assert.equal(details.configured, false); assert.equal(details.authenticated, false);
  assert.ok(details.issues.some(issue => issue.includes('STORE_SESSION_SECRET')));
  assert.equal(JSON.stringify(details).includes('owner@example.com'), false);
});
