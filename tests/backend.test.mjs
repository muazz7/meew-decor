import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run the production services against SQLite using the actual deployment
// migrations. Only Cloudflare bindings, hosted identity and provider HTTP are mocked.
const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'meew-backend-'));
const harness = { env: {}, user: null };
globalThis.__backendHarness = harness;
await writeFile(join(temp, 'cloudflare.mjs'), 'export const env = globalThis.__backendHarness.env;');
await writeFile(join(temp, 'auth.mjs'), 'export async function getChatGPTUser() { return globalThis.__backendHarness.user; }');
const moduleUrl = (name) => pathToFileURL(join(temp, `${name}.mjs`)).href;
for (const name of ['validation', 'runtime', 'config', 'bkash', 'orders']) {
  const source = await readFile(join(root, 'lib/server', `${name}.ts`), 'utf8');
  const code = stripTypeScriptTypes(source).replace(/(["'])cloudflare:workers\1/g, JSON.stringify(moduleUrl('cloudflare'))).replace(/(["'])@\/app\/chatgpt-auth\1/g, JSON.stringify(moduleUrl('auth'))).replace(/(["'])@\/lib\/catalog\1/g, JSON.stringify(moduleUrl('catalog'))).replace(/(["'])\.\/(validation|runtime|config|bkash|orders)\1/g, (_, q, module) => JSON.stringify(moduleUrl(module)));
  await writeFile(join(temp, `${name}.mjs`), code);
}
await writeFile(join(temp, 'catalog.mjs'), stripTypeScriptTypes(await readFile(join(root, 'lib/catalog.ts'), 'utf8')));
const validation = await import(moduleUrl('validation'));
const runtime = await import(moduleUrl('runtime'));
const config = await import(moduleUrl('config'));
const orders = await import(moduleUrl('orders'));
const { products } = await import(moduleUrl('catalog'));
async function importRoute(name, path) {
  const source = await readFile(join(root, path), 'utf8');
  const code = stripTypeScriptTypes(source).replace(/(["'])@\/lib\/server\/(validation|runtime|config|bkash|orders)\1/g, (_, q, module) => JSON.stringify(moduleUrl(module)));
  await writeFile(join(temp, `${name}.mjs`), code); return import(moduleUrl(name));
}
const checkoutRoute = await importRoute('checkout-route', 'app/api/checkout/route.ts');
const statusRoute = await importRoute('status-route', 'app/api/orders/[id]/route.ts');
const fulfillmentRoute = await importRoute('fulfillment-route', 'app/api/admin/orders/[id]/route.ts');
const migrations = (await readdir(join(root, 'drizzle'))).filter((name) => name.endsWith('.sql')).sort();
assert.ok(migrations.length, 'Generate deployment migrations before running backend tests.');
const migrationSql = await Promise.all(migrations.map((name) => readFile(join(root, 'drizzle', name), 'utf8')));
let sqlite, provider, calls, originalFetch = globalThis.fetch;
class D1Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.sql, values); }
  execute() {
    const stmt = sqlite.prepare(this.sql);
    if (stmt.columns().length) { const results = stmt.all(...this.values); const changes = sqlite.prepare('SELECT changes() AS changes').get().changes; return { results, meta: { changes }, success: true }; }
    return { results: [], meta: { changes: Number(stmt.run(...this.values).changes) }, success: true };
  }
  async first() { return this.execute().results[0] || null; }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
}
const db = {
  prepare(sql) { return new D1Statement(sql); },
  async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map((stmt) => stmt.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } },
};
const customer = { name: 'Test Customer', phone: '01712345678', email: 'test@example.com', address: '10 Test Road, Mohammadpur', city: 'Dhaka', zone: 'dhaka' };
function checkout(quantity = 1, key = crypto.randomUUID()) { return validation.parseCheckout({ items: [{ id: products[0].id, quantity }], customer, idempotencyKey: key, expectedTotalMinor: 125050 * quantity + 8000 }); }
async function setupStore(stock = 5) {
  const initial = await config.readConfig();
  return config.saveConfig({ ...initial, products: initial.products.map((p, i) => ({ ...p, enabled: i === 0, stock: i === 0 ? stock : null, price: i === 0 ? 1250.5 : null })), delivery: { dhaka: 80, outsideDhaka: 140 }, policies: { delivery: 'Owner-approved test delivery policy.', returns: 'Owner-approved test return policy.' }, checkoutEnabled: true });
}
function stock() { return sqlite.prepare('SELECT stock FROM product_settings WHERE id=?').get(products[0].id).stock; }
function completed(order, overrides = {}) { return { statusCode: '0000', paymentID: order.payment_id, transactionStatus: 'Completed', amount: (order.total_minor / 100).toFixed(2), currency: 'BDT', trxID: `TRX-${order.id}`, merchantInvoiceNumber: order.id, ...overrides }; }
beforeEach(async () => {
  sqlite?.close(); sqlite = new DatabaseSync(':memory:');
  for (const sql of migrationSql) sqlite.exec(sql);
  for (const key of Object.keys(harness.env)) delete harness.env[key];
  Object.assign(harness.env, { DB: db, STORE_ADMIN_EMAIL: 'owner@example.com', COMMERCE_ENABLED: 'true', SITE_PUBLIC_URL: 'https://store.example.com', BKASH_ENV: 'sandbox', BKASH_API_VERSION: 'v1.2.0-beta', BKASH_USERNAME: 'test-user', BKASH_PASSWORD: 'test-password', BKASH_APP_KEY: 'test-app-key', BKASH_APP_SECRET: 'test-app-secret' });
  harness.user = null; calls = []; provider = { execute: null, query: null, createFailure: false };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body), path = new URL(url).pathname;
    calls.push({ path, body, headers: options.headers });
    if (path.endsWith('/token/grant')) return Response.json({ statusCode: '0000', id_token: 'test-token' });
    if (path.endsWith('/create')) {
      if (provider.createFailure) throw new Error('Simulated provider timeout');
      if (provider.createGate) await provider.createGate;
      return Response.json({ statusCode: '0000', paymentID: `PAY-${calls.length}`, bkashURL: `https://sandbox.payment.bkash.com/?paymentID=PAY-${calls.length}`, amount: body.amount, currency: 'BDT' });
    }
    const response = path.endsWith('/execute') ? provider.execute : provider.query;
    if (response instanceof Error) throw response;
    return Response.json(response || { statusCode: '0000', paymentID: body.paymentID, transactionStatus: 'Initiated' });
  };
});
after(async () => { sqlite?.close(); globalThis.fetch = originalFetch; delete globalThis.__backendHarness; await rm(temp, { recursive: true, force: true }); });

test('checkout validation rejects malformed quantities, duplicate IDs and addresses; normalizes Bangladesh phone', () => {
  const base = checkout(); assert.equal(base.customer.phone, '01712345678');
  assert.equal(validation.parseCheckout({ ...base, customer: { ...customer, phone: '+8801712345678' } }).customer.phone, '01712345678');
  for (const quantity of [0, -1, 1.5, 11, '2']) assert.throws(() => validation.parseCheckout({ ...base, items: [{ id: products[0].id, quantity }] }));
  assert.throws(() => validation.parseCheckout({ ...base, items: [...base.items, ...base.items] }));
  assert.throws(() => validation.parseCheckout({ ...base, customer: { ...customer, phone: '12345678901' } }));
  assert.throws(() => validation.parseCheckout({ ...base, idempotencyKey: 'guessable' }));
});
test('exact integer money and payment destination allowlist reject malformed values', () => {
  assert.equal(validation.toMinor(19.99), 1999); assert.equal(validation.providerMinor('19.99'), 1999);
  for (const amount of [NaN, Infinity, -1, 0, 1.001, '100']) assert.throws(() => validation.toMinor(amount));
  for (const url of ['https://payment.bkash.com.attacker.test/', 'javascript:alert(1)', 'http://payment.bkash.com/', 'https://user:pass@payment.bkash.com/']) assert.equal(validation.safePaymentUrl(url), null);
});
test('checkout fails closed without runtime enablement and confirmed inventory', async () => {
  assert.equal((await config.readConfig()).readiness.ready, false);
  await assert.rejects(orders.createOrder(checkout()), { status: 503 });
  await setupStore(); harness.env.COMMERCE_ENABLED = 'false';
  await assert.rejects(orders.createOrder(checkout()), { status: 503 });
  assert.equal(calls.length, 0); assert.equal(stock(), 5);
});
test('checkout requires explicit supported merchant API version', async () => {
  await setupStore(); delete harness.env.BKASH_API_VERSION;
  assert.equal((await config.readConfig()).readiness.ready, false);
  await assert.rejects(orders.createOrder(checkout()), { status: 503 });
  harness.env.BKASH_API_VERSION = 'v2'; await assert.rejects(orders.createOrder(checkout()), { status: 503 });
  assert.equal(calls.length, 0); assert.equal(stock(), 5);
});
test('stale product price or delivery charge is rejected before stock reservation or payment creation', async () => {
  let current = await setupStore(); const staleCheckout = checkout();
  current = await config.saveConfig({ ...current, products: current.products.map((p, i) => i === 0 ? { ...p, price: 1400 } : p) });
  await assert.rejects(orders.createOrder(staleCheckout), { status: 409 });
  current = await config.saveConfig({ ...current, products: current.products.map((p, i) => i === 0 ? { ...p, price: 1250.5 } : p), delivery: { ...current.delivery, dhaka: 100 } });
  await assert.rejects(orders.createOrder(staleCheckout), { status: 409 });
  assert.equal(calls.length, 0); assert.equal(stock(), 5); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  await orders.createOrder({ ...staleCheckout, expectedTotalMinor: 135050 }); assert.equal(stock(), 4);
});
test('server computes amount, persists item snapshots and reuses an idempotency key exactly once', async () => {
  await setupStore(); const input = checkout(2), first = await orders.createOrder(input), second = await orders.createOrder(input);
  assert.equal(first.orderId, second.orderId); assert.equal(first.token, second.token); assert.equal(stock(), 3);
  assert.equal(calls.filter((c) => c.path.endsWith('/create')).length, 1);
  const create = calls.find((c) => c.path.endsWith('/create'));
  assert.equal(create.body.amount, '2581.00'); assert.equal(create.body.mode, '0011');
  assert.equal(new URL(create.body.callbackURL).origin, 'https://store.example.com');
  const order = await orders.getOrder(first.orderId), publicOrder = await orders.serializeOrder(order);
  assert.equal(publicOrder.total, 2581); assert.equal(publicOrder.customer, undefined); assert.equal(publicOrder.access_token, undefined);
  await assert.rejects(orders.createOrder({ ...input, items: [{ ...input.items[0], quantity: 3 }] }), { status: 409 });
});
test('duplicate checkout during provider creation returns retryable 425 and preserves the original reservation', async () => {
  await setupStore(); let release;
  provider.createGate = new Promise((resolve) => { release = resolve; });
  const input = checkout(), original = orders.createOrder(input);
  while (!calls.some((call) => call.path.endsWith('/create'))) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(orders.createOrder(input), { status: 425 }); assert.equal(stock(), 4);
  release(); const created = await original;
  assert.equal((await orders.createOrder(input)).orderId, created.orderId);
  assert.equal(calls.filter((call) => call.path.endsWith('/create')).length, 1);
});
test('concurrent buyers cannot oversell the final item', async () => {
  await setupStore(1);
  const attempts = await Promise.allSettled([orders.createOrder(checkout()), orders.createOrder(checkout())]);
  assert.equal(attempts.filter((v) => v.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((v) => v.status === 'rejected').length, 1);
  assert.equal(stock(), 0); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 1);
});
test('stale administrator config cannot replace stock consumed by checkout', async () => {
  const stale = await setupStore(3); await orders.createOrder(checkout());
  await assert.rejects(config.saveConfig(stale), { status: 409 }); assert.equal(stock(), 2);
  const current = await config.readConfig(); await config.saveConfig({ ...current, policies: { ...current.policies, returns: 'Updated approved policy.' } }); assert.equal(stock(), 2);
});
test('successful callback executes once; repeated callback remains paid and does not decrement twice', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  provider.execute = completed(order);
  const result = await orders.handleCallback(order, order.payment_id, order.callback_token, 'success');
  assert.equal(result.status, 'paid'); assert.equal(stock(), 4);
  const repeat = await orders.handleCallback(result, result.payment_id, result.callback_token, 'success');
  assert.equal(repeat.status, 'paid'); assert.equal(calls.filter((c) => c.path.endsWith('/execute')).length, 1);
  assert.equal(calls.filter((c) => c.path.endsWith('/token/grant')).length, 1);
  await orders.releaseReservation(order.id, 'cancelled'); assert.equal(stock(), 4); assert.equal((await orders.getOrder(order.id)).status, 'paid');
});
test('merchant token is reused across requests but credential changes invalidate the cache', async () => {
  await setupStore(); await orders.createOrder(checkout()); await orders.createOrder(checkout());
  assert.equal(calls.filter((call) => call.path.endsWith('/token/grant')).length, 1);
  harness.env.BKASH_APP_SECRET = 'rotated-test-secret'; await orders.createOrder(checkout());
  assert.equal(calls.filter((call) => call.path.endsWith('/token/grant')).length, 2);
  const publicConfiguration = JSON.stringify(await config.readConfig());
  assert.equal(publicConfiguration.includes('test-token'), false); assert.equal(publicConfiguration.includes('rotated-test-secret'), false);
});
test('owner reconciliation before customer authorization preserves the one-time successful execute callback', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  const pending = await orders.reconcileOrder(order); assert.equal(pending.status, 'pending');
  provider.execute = completed(order);
  const paid = await orders.handleCallback(pending, pending.payment_id, pending.callback_token, 'success'); assert.equal(paid.status, 'paid');
  await orders.handleCallback(paid, paid.payment_id, paid.callback_token, 'success');
  assert.equal(calls.filter((call) => call.path.endsWith('/execute')).length, 1); assert.equal(stock(), 4);
});
test('callback query strings cannot manufacture success; wrong state and wrong payment ID are rejected', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  await assert.rejects(orders.handleCallback(order, order.payment_id, '0'.repeat(64), 'success'), { status: 403 });
  await assert.rejects(orders.handleCallback(order, 'wrong-payment', order.callback_token, 'success'), { status: 403 });
  provider.execute = completed(order, { amount: '1.00' }); provider.query = provider.execute;
  assert.equal((await orders.handleCallback(order, order.payment_id, order.callback_token, 'success')).status, 'review');
  assert.equal(stock(), 4);
});
test('currency, invoice, transaction ID and provider payment ID mismatches cannot be paid', () => {
  const expected = { paymentId: 'PAY1', totalMinor: 10000, id: 'MD1' };
  const valid = { statusCode: '0000', transactionStatus: 'Completed', paymentID: 'PAY1', currency: 'BDT', amount: '100.00', trxID: 'TRX1', merchantInvoiceNumber: 'MD1' };
  assert.equal(validation.paymentMatches(valid, expected), true);
  for (const mismatch of [{ currency: 'USD' }, { merchantInvoiceNumber: 'MD2' }, { paymentID: 'PAY2' }, { trxID: '' }, { transactionStatus: 'Initiated' }, { statusCode: '200' }]) assert.equal(validation.paymentMatches({ ...valid, ...mismatch }, expected), false);
});
test('execute timeout queries bKash and accepts only verified successful query', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  provider.execute = new Error('timeout'); provider.query = completed(order);
  assert.equal((await orders.handleCallback(order, order.payment_id, order.callback_token, 'success')).status, 'paid');
  assert.equal(calls.filter((c) => c.path.endsWith('/payment/status')).length, 1);
});
test('cancelled provider payment restores stock once; callback status alone cannot cancel', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  assert.equal((await orders.handleCallback(order, order.payment_id, order.callback_token, 'cancel')).status, 'pending'); assert.equal(stock(), 4);
  provider.query = { statusCode: '0000', paymentID: order.payment_id, transactionStatus: 'Cancelled' };
  const cancelled = await orders.reconcileOrder(await orders.getOrder(order.id)); assert.equal(cancelled.status, 'cancelled'); assert.equal(stock(), 5);
  await orders.reconcileOrder(cancelled); assert.equal(stock(), 5);
});
test('provider outage preserves uncertain reservation and creation failure returns unexposed stock', async () => {
  await setupStore(); provider.createFailure = true;
  await assert.rejects(orders.createOrder(checkout())); assert.equal(stock(), 5);
  provider.createFailure = false; const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  provider.execute = new Error('timeout'); provider.query = new Error('timeout');
  assert.equal((await orders.handleCallback(order, order.payment_id, order.callback_token, 'success')).status, 'review'); assert.equal(stock(), 4);
});
test('interrupted creation without a payment URL can be recovered only after the safe timeout', async () => {
  await setupStore(); const created = await orders.createOrder(checkout());
  sqlite.prepare("UPDATE orders SET status='creating',payment_id=NULL,payment_url=NULL WHERE id=?").run(created.orderId);
  await assert.rejects(orders.reconcileOrder(await orders.getOrder(created.orderId)), { status: 409 }); assert.equal(stock(), 4);
  sqlite.prepare('UPDATE orders SET created_at=? WHERE id=?').run(new Date(Date.now() - 31 * 60000).toISOString(), created.orderId);
  assert.equal((await orders.reconcileOrder(await orders.getOrder(created.orderId))).status, 'failed'); assert.equal(stock(), 5);
  await orders.reconcileOrder(await orders.getOrder(created.orderId)); assert.equal(stock(), 5);
});
test('late completed payment after released stock requires review instead of fulfillment', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId);
  await orders.releaseReservation(order.id, 'cancelled'); provider.query = completed(order);
  assert.equal((await orders.reconcileOrder(await orders.getOrder(order.id))).status, 'review'); assert.equal(stock(), 5);
});
test('store owner allowlist, same-origin mutations and private order access fail closed', async () => {
  await assert.rejects(runtime.requireAdmin(), { status: 401 });
  harness.user = { userId: 'u1', email: 'attacker@example.com' }; await assert.rejects(runtime.requireAdmin(), { status: 403 });
  harness.user.email = 'OWNER@example.com'; assert.equal((await runtime.requireAdmin()).userId, 'u1');
  delete harness.env.STORE_ADMIN_EMAIL; await assert.rejects(runtime.requireAdmin(), { status: 403 });
  assert.throws(() => runtime.sameOrigin(new Request('https://store.example.com/api/checkout', { headers: { origin: 'https://attacker.test' } })), { status: 403 });
  runtime.sameOrigin(new Request('https://store.example.com/api/checkout', { headers: { origin: 'https://store.example.com' } }));
  assert.equal(orders.customerCanRead({ access_token: 'a'.repeat(64) }, 'b'.repeat(64)), false);
  assert.equal(orders.customerCanRead({ access_token: 'a'.repeat(64) }, 'a'.repeat(64)), true);
});
test('HTTP checkout ignores client totals, rejects cross-origin writes and rate-limits attempts', async () => {
  await setupStore();
  const request = (input, origin = 'https://store.example.com') => new Request('https://store.example.com/api/checkout', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(input) });
  assert.equal((await checkoutRoute.POST(request(checkout(), 'https://attacker.test'))).status, 403);
  const input = { ...checkout(), total: 0.01, amount: '0.01', delivery: 0 };
  const response = await checkoutRoute.POST(request(input)); assert.equal(response.status, 201);
  const result = await response.json(), order = await orders.getOrder(result.orderId);
  assert.equal(order.total_minor, 133050); assert.equal(response.headers.get('cache-control'), 'no-store');
  for (let i = 0; i < 11; i++) assert.equal((await checkoutRoute.POST(request(input))).status, 201);
  assert.equal((await checkoutRoute.POST(request(input))).status, 429);
});
test('HTTP order status needs its secret token and never returns address or private provider fields', async () => {
  await setupStore(); const created = await orders.createOrder(checkout()), context = { params: Promise.resolve({ id: created.orderId }) };
  assert.equal((await statusRoute.GET(new Request(`https://store.example.com/api/orders/${created.orderId}`), context)).status, 404);
  const response = await statusRoute.GET(new Request(`https://store.example.com/api/orders/${created.orderId}?token=${created.token}`), context);
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.order.customer, undefined); assert.equal(result.order.customer_json, undefined); assert.equal(result.order.callback_token, undefined); assert.equal(result.order.access_token, undefined);
});
test('HTTP fulfillment rejects unverified and sandbox payments; accepts only paid live orders for the owner', async () => {
  await setupStore(); harness.user = { userId: 'owner', email: 'owner@example.com' };
  const created = await orders.createOrder(checkout()), order = await orders.getOrder(created.orderId), context = { params: Promise.resolve({ id: created.orderId }) };
  const request = () => new Request(`https://store.example.com/api/admin/orders/${order.id}`, { method: 'PATCH', headers: { origin: 'https://store.example.com', 'content-type': 'application/json' }, body: JSON.stringify({ fulfillmentStatus: 'shipped', tracking: 'Courier reference 123' }) });
  assert.equal((await fulfillmentRoute.PATCH(request(), context)).status, 409);
  provider.execute = completed(order); await orders.handleCallback(order, order.payment_id, order.callback_token, 'success');
  assert.equal((await fulfillmentRoute.PATCH(request(), context)).status, 409);
  sqlite.prepare("UPDATE orders SET payment_mode='live' WHERE id=?").run(order.id);
  assert.equal((await fulfillmentRoute.PATCH(request(), context)).status, 200);
  assert.equal((await orders.getOrder(order.id)).fulfillment_status, 'shipped');
  harness.user.email = 'attacker@example.com'; assert.equal((await fulfillmentRoute.PATCH(request(), context)).status, 403);
});
