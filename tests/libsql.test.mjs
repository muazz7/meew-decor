import { test, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { loadMigrations, migrateTurso } from "../scripts/migrate-turso.mjs";

const root = resolve(import.meta.dirname, "..");
const workspace = await mkdtemp(join(tmpdir(), "meew-libsql-"));
const source = await readFile(join(root, "lib/server/libsql.ts"), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" }).replace(/(["'])@libsql\/client\/web\1/g, JSON.stringify(import.meta.resolve("@libsql/client/web")));
await writeFile(join(workspace, "adapter.mjs"), compiled);
const { wrapLibsqlClient } = await import(pathToFileURL(join(workspace, "adapter.mjs")).href);
const serviceUrl = (name) => pathToFileURL(join(workspace, `${name}.mjs`)).href;
globalThis.__libsqlServices = { env: {} };
await writeFile(join(workspace, "runtime.mjs"), `
  export const env = globalThis.__libsqlServices.env;
  export const authProvider = 'password';
  export function database() { return env.DB; }
  export async function sha256(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join(''); }
  export function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte=>byte.toString(16).padStart(2,'0')).join(''); }
`);
for (const name of ["validation", "config", "orders", "bkash", "owner-auth"]) {
  const original = await readFile(join(root, "lib/server", `${name}.ts`), "utf8");
  const source = stripTypeScriptTypes(original).replace(/(["'])\.\/(validation|runtime|config|orders|bkash|owner-auth)\1/g, (_, quote, module) => JSON.stringify(serviceUrl(module))).replace(/(["'])@\/lib\/catalog\1/g, JSON.stringify(serviceUrl("catalog")));
  await writeFile(join(workspace, `${name}.mjs`), source);
}
await writeFile(join(workspace, "catalog.mjs"), stripTypeScriptTypes(await readFile(join(root, "lib/catalog.ts"), "utf8")));
const commerceConfig = await import(serviceUrl("config")), commerceOrders = await import(serviceUrl("orders"));
const migrations = await loadMigrations();
let directory, client, db, clients;

beforeEach(async () => {
  directory = await mkdtemp(join(workspace, "db-"));
  client = createClient({ url: pathToFileURL(join(directory, "store.db")).href, intMode: "number" });
  clients = [client]; db = wrapLibsqlClient(client);
});
afterEach(async () => { for (const item of clients) item.close(); await rm(directory, { recursive: true, force: true }); });
after(async () => { delete globalThis.__libsqlServices; await rm(workspace, { recursive: true, force: true }); });

function secondClient() {
  const other = createClient({ url: pathToFileURL(join(directory, "store.db")).href, intMode: "number" });
  clients.push(other); return other;
}
async function seedProduct(quantity = 5) {
  await migrateTurso(client, migrations);
  await db.prepare("INSERT INTO product_settings (id,price_minor,stock,enabled,updated_at) VALUES (?,?,?,?,?)").bind("lamp", 125050, quantity, true, new Date().toISOString()).run();
}

test("actual Drizzle SQL migrates a libSQL file once and its ledger makes reruns idempotent", async () => {
  const first = await migrateTurso(client, migrations), second = await migrateTurso(client, migrations);
  assert.deepEqual(first.applied, migrations.map((migration) => migration.tag)); assert.deepEqual(second.applied, []);
  const count = await client.execute("SELECT COUNT(*) AS count FROM __meew_migrations"); assert.equal(count.rows[0].count, migrations.length);
  for (const name of ["orders", "order_items", "product_settings", "store_settings", "payment_events", "rate_limits"]) {
    const exists = await client.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: [name] }); assert.equal(exists.rows[0].name, name);
  }
});

test("adapter returns D1-shaped named rows and accurate write metadata, including RETURNING", async () => {
  await seedProduct();
  const row = await db.prepare("SELECT id,price_minor,stock,enabled FROM product_settings WHERE id=?").bind("lamp").first();
  assert.deepEqual(row, { id: "lamp", price_minor: 125050, stock: 5, enabled: 1 }); assert.equal(Object.keys(row).includes("0"), false);
  assert.equal(await db.prepare("SELECT stock FROM product_settings WHERE id=?").bind("lamp").first("stock"), 5);
  assert.equal(await db.prepare("SELECT stock FROM product_settings WHERE id=?").bind("missing").first(), null);
  const increment = await db.prepare("UPDATE product_settings SET stock=stock+1 WHERE id=? RETURNING stock").bind("lamp").all();
  assert.equal(increment.success, true); assert.equal(increment.meta.changes, 1); assert.deepEqual(increment.results, [{ stock: 6 }]);
  const noChange = await db.prepare("UPDATE product_settings SET stock=0 WHERE id=?").bind("missing").run(); assert.equal(noChange.meta.changes, 0);
  const rate = await db.prepare("INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count").bind("bucket", Date.now() + 1000).first(); assert.deepEqual(rate, { count: 1 });
});

test("a failed batch rolls back every preceding write in the batch", async () => {
  await seedProduct(5);
  await assert.rejects(db.batch([
    db.prepare("UPDATE product_settings SET stock=stock-2 WHERE id=?").bind("lamp"),
    db.prepare("INSERT INTO product_settings (id,updated_at) VALUES (?,?)").bind("lamp", new Date().toISOString()),
  ]));
  assert.equal((await db.prepare("SELECT stock FROM product_settings WHERE id='lamp'").first()).stock, 5);
});

test("successful batches execute sequentially and return each statement's result", async () => {
  await seedProduct(5);
  const results = await db.batch([
    db.prepare("UPDATE product_settings SET stock=stock-2 WHERE id=?").bind("lamp"),
    db.prepare("SELECT stock FROM product_settings WHERE id=?").bind("lamp"),
  ]);
  assert.equal(results[0].meta.changes, 1); assert.deepEqual(results[1].results, [{ stock: 3 }]);
  assert.deepEqual(await db.batch([]), []);
});

test("competing transactions cannot both reserve the same final item", async () => {
  await seedProduct(1);
  await client.execute("CREATE TABLE test_reservations (id TEXT PRIMARY KEY)");
  const other = wrapLibsqlClient(secondClient());
  const reserve = (database, id) => database.batch([
    database.prepare("INSERT INTO test_reservations (id) SELECT ? WHERE EXISTS (SELECT 1 FROM product_settings WHERE id='lamp' AND stock>=1)").bind(id),
    database.prepare("UPDATE product_settings SET stock=stock-1 WHERE id='lamp' AND EXISTS (SELECT 1 FROM test_reservations WHERE id=?)").bind(id),
  ]);
  const results = await Promise.allSettled([reserve(db, "buyer-a"), reserve(other, "buyer-b")]);
  for (const result of results) if (result.status === "rejected") assert.match(String(result.reason.code), /^SQLITE_(BUSY|LOCKED)/);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM test_reservations").first();
  assert.equal(count.count, 1); assert.equal((await db.prepare("SELECT stock FROM product_settings WHERE id='lamp'").first()).stock, 0);
  assert.equal(results.filter((result) => result.status === "fulfilled").reduce((sum, result) => sum + result.value[0].meta.changes, 0), 1);
});

test("a batch containing another database's statement rejects before running any writes", async () => {
  await seedProduct(); const other = wrapLibsqlClient(secondClient());
  await assert.rejects(db.batch([db.prepare("UPDATE product_settings SET stock=0"), other.prepare("SELECT stock FROM product_settings")]), /same database/);
  assert.equal((await db.prepare("SELECT stock FROM product_settings WHERE id='lamp'").first()).stock, 5);
});

test("two migration processes serialize schema creation and record each migration only once", async () => {
  const other = secondClient();
  const results = await Promise.all([migrateTurso(client, migrations), migrateTurso(other, migrations)]);
  assert.equal(results.reduce((sum, result) => sum + result.applied.length, 0), migrations.length);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __meew_migrations")).rows[0].count, migrations.length);
});

test("editing an applied migration checksum fails closed", async () => {
  await migrateTurso(client, migrations);
  const edited = migrations.map((migration, index) => index === 0 ? { ...migration, checksum: "0".repeat(64) } : migration);
  await assert.rejects(migrateTurso(client, edited), /was edited/);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __meew_migrations")).rows[0].count, migrations.length);
});

test("a failed new migration rolls back its schema changes and its ledger entry", async () => {
  await migrateTurso(client, migrations);
  const broken = [...migrations, { ordinal: migrations.length, tag: "9999_broken_test", checksum: "b".repeat(64), statements: ["CREATE TABLE rolled_back_test (id TEXT PRIMARY KEY)", "INSERT INTO nonexistent_table VALUES (1)"] }];
  await assert.rejects(migrateTurso(client, broken));
  assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='rolled_back_test'")).rows.length, 0);
  assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __meew_migrations")).rows[0].count, migrations.length);
});

test("SQL binding is immutable and invalid values are rejected without executing", async () => {
  await seedProduct(); const statement = db.prepare("SELECT ? AS value");
  assert.deepEqual(await statement.bind("first").first(), { value: "first" });
  assert.deepEqual(await statement.bind("second").first(), { value: "second" });
  for (const invalid of [undefined, {}, NaN, Infinity, () => {}]) assert.throws(() => statement.bind(invalid), TypeError);
});

test("production config, stock reservation and verified payment work together on the libSQL adapter", async () => {
  await migrateTurso(client, migrations);
  const environment = globalThis.__libsqlServices.env;
  Object.assign(environment, {
    DB: db, STORE_ADMIN_EMAIL: "owner@example.com", COMMERCE_ENABLED: "true", SITE_PUBLIC_URL: "https://store.example.com", BKASH_ENV: "sandbox", BKASH_API_VERSION: "v1.2.0-beta", BKASH_USERNAME: "test-user", BKASH_PASSWORD: "test-password", BKASH_APP_KEY: "test-key", BKASH_APP_SECRET: "test-secret",
    STORE_ADMIN_PASSWORD_HASH: `pbkdf2_sha256$600000$${Buffer.alloc(32).toString("base64url")}$${Buffer.alloc(32).toString("base64url")}`,
    STORE_SESSION_SECRET: "a-test-only-session-secret-at-least-32-bytes",
  });
  const initial = await commerceConfig.readConfig();
  const saved = await commerceConfig.saveConfig({ ...initial, products: initial.products.map((product, index) => ({ ...product, enabled: index === 0, price: index === 0 ? 100 : null, stock: index === 0 ? 1 : null })), delivery: { dhaka: 20, outsideDhaka: 40 }, policies: { delivery: "Test approved delivery policy.", returns: "Test approved returns policy." }, checkoutEnabled: true });
  assert.equal(saved.readiness.ready, true);
  const originalFetch = globalThis.fetch;
  let providerOrderId, chargedAmount, executeCalls = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body), path = new URL(url).pathname;
    if (path.endsWith("/token/grant")) return Response.json({ statusCode: "0000", id_token: "test-token", expires_in: 3600 });
    if (path.endsWith("/create")) { providerOrderId = body.merchantInvoiceNumber; chargedAmount = body.amount; return Response.json({ statusCode: "0000", paymentID: "PAY-1", amount: body.amount, currency: "BDT", bkashURL: "https://sandbox.payment.bkash.com/?paymentID=PAY-1" }); }
    if (path.endsWith("/execute")) { executeCalls++; return Response.json({ statusCode: "0000", paymentID: "PAY-1", amount: chargedAmount, currency: "BDT", transactionStatus: "Completed", trxID: "TRX-1", merchantInvoiceNumber: providerOrderId }); }
    throw new Error("Unexpected provider request in adapter integration test.");
  };
  try {
    const input = { items: [{ id: saved.products[0].id, quantity: 1 }], customer: { name: "Test Buyer", phone: "01712345678", email: "", address: "10 Test Road, Dhaka", city: "Dhaka", zone: "dhaka" }, idempotencyKey: crypto.randomUUID(), expectedTotalMinor: 12000 };
    const created = await commerceOrders.createOrder(input), repeated = await commerceOrders.createOrder(input);
    assert.equal(created.orderId, repeated.orderId); assert.equal(chargedAmount, "120.00");
    await assert.rejects(commerceConfig.saveConfig(saved), { status: 409 });
    const order = await commerceOrders.getOrder(created.orderId), paid = await commerceOrders.handleCallback(order, order.payment_id, order.callback_token, "success");
    assert.equal(paid.status, "paid"); assert.equal(executeCalls, 1);
    assert.equal((await db.prepare("SELECT stock FROM product_settings WHERE id=?").bind(saved.products[0].id).first()).stock, 0);
    assert.equal((await commerceOrders.serializeOrder(paid)).total, 120);
  } finally { globalThis.fetch = originalFetch; }
});
