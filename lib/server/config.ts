import { products } from "@/lib/catalog";
import { database, env, sha256 } from "./runtime";
import { StoreError, toMinor } from "./validation";

type ProductRow = { id: string; price_minor: number | null; stock: number | null; enabled: number };
export type StoreSettings = { delivery: { dhaka: number | null; outsideDhaka: number | null }; policies: { delivery: string; returns: string }; checkoutEnabled: boolean };
const defaults: StoreSettings = { delivery: { dhaka: null, outsideDhaka: null }, policies: { delivery: "", returns: "" }, checkoutEnabled: false };
const productSignatureSql = "COALESCE((SELECT group_concat(signature,'|') FROM (SELECT id || ':' || COALESCE(price_minor,'null') || ':' || COALESCE(stock,'null') || ':' || enabled || ':' || updated_at AS signature FROM product_settings ORDER BY id)), '')";
async function readSnapshot() {
  const row = await database().prepare(`SELECT ${productSignatureSql} AS signature, (SELECT value FROM store_settings WHERE id='store') AS value`).first<{ signature: string; value: string | null }>();
  const snapshot = row || { signature: "", value: null };
  return { ...snapshot, revision: await sha256(JSON.stringify(snapshot)) };
}
export async function readConfig() {
  const db = database();
  const [productResult, settingResult, snapshotResult] = await db.batch([
    db.prepare("SELECT id,price_minor,stock,enabled FROM product_settings"),
    db.prepare("SELECT value FROM store_settings WHERE id='store'"),
    db.prepare(`SELECT ${productSignatureSql} AS signature, (SELECT value FROM store_settings WHERE id='store') AS value`),
  ]);
  const result = { results: productResult.results as ProductRow[] };
  const stored = settingResult.results[0] as { value: string } | undefined;
  const snapshot = snapshotResult.results[0] as { signature: string; value: string | null };
  const settings: StoreSettings = stored ? { ...defaults, ...JSON.parse(stored.value) } : defaults;
  const catalog = products.map((product) => { const row = result.results.find((item) => item.id === product.id); return { id: product.id, name: product.name, price: row?.price_minor != null ? row.price_minor / 100 : null, stock: row?.stock ?? null, enabled: Boolean(row?.enabled) }; });
  const mode = env.BKASH_ENV === "live" || env.BKASH_ENV === "sandbox" ? env.BKASH_ENV : "unconfigured";
  const issues: string[] = [];
  if (!env.STORE_ADMIN_EMAIL) issues.push("Set the owner’s store administrator email.");
  if (env.COMMERCE_ENABLED !== "true") issues.push("Enable commerce in the hosted runtime after launch checks.");
  if (mode === "unconfigured" || !env.BKASH_APP_KEY || !env.BKASH_APP_SECRET || !env.BKASH_USERNAME || !env.BKASH_PASSWORD) issues.push("Configure the bKash gateway credentials and environment.");
  if (env.BKASH_API_VERSION !== "v1.2.0-beta") issues.push("Confirm merchant compatibility with the supported bKash v1.2.0-beta API before enabling it. v2 is not implemented.");
  if (!publicOrigin()) issues.push("Set the canonical public HTTPS store URL and allow its callback with bKash.");
  if (!settings.checkoutEnabled) issues.push("The owner has not enabled checkout.");
  if (settings.delivery.dhaka == null || settings.delivery.outsideDhaka == null) issues.push("Confirm both delivery rates.");
  if (!settings.policies.delivery.trim() || !settings.policies.returns.trim()) issues.push("Publish the owner-approved delivery and return policies.");
  if (!catalog.some((p) => p.enabled && p.price != null && p.stock != null && p.stock > 0)) issues.push("Set a price and available stock for at least one product.");
  if (catalog.some((p) => p.enabled && (p.price == null || p.stock == null))) issues.push("Every enabled product needs a confirmed price and stock quantity.");
  return { products: catalog, ...settings, revision: await sha256(JSON.stringify(snapshot)), readiness: { ready: issues.length === 0, mode, issues } };
}
export function publicOrigin(): string | null {
  try { const url = new URL(env.SITE_PUBLIC_URL || ""); return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash && !["localhost", "127.0.0.1"].includes(url.hostname) ? url.origin : null; } catch { return null; }
}
export async function saveConfig(value: unknown) {
  if (!value || typeof value !== "object") throw new StoreError("Invalid store settings.");
  const input = value as Record<string, unknown>;
  const snapshot = await readSnapshot();
  if (typeof input.revision !== "string" || input.revision !== snapshot.revision) throw new StoreError("Stock or store settings changed. Refresh the dashboard before saving.", 409);
  if (!Array.isArray(input.products) || input.products.length !== products.length) throw new StoreError("Save settings for the complete catalog.");
  const seen = new Set<string>();
  const rows = input.products.map((v: Record<string, unknown>) => {
    if (!v || typeof v.id !== "string" || !products.some((p) => p.id === v.id) || seen.has(v.id)) throw new StoreError("Unknown or duplicate product.");
    seen.add(v.id);
    const price = v.price === null ? null : toMinor(v.price);
    const stock = v.stock === null ? null : v.stock;
    if (stock !== null && (typeof stock !== "number" || !Number.isInteger(stock) || stock < 0 || stock > 100000)) throw new StoreError("Stock must be a whole number from 0 to 100,000.");
    if (typeof v.enabled !== "boolean") throw new StoreError("Select whether each product can be purchased.");
    if (v.enabled && (price === null || stock === null)) throw new StoreError("Enabled products require a price and stock.");
    return { id: v.id, price, stock, enabled: v.enabled };
  });
  const delivery = input.delivery as Record<string, unknown> | undefined;
  const policies = input.policies as Record<string, unknown> | undefined;
  if (!delivery || !policies || typeof policies.delivery !== "string" || typeof policies.returns !== "string" || policies.delivery.length > 6000 || policies.returns.length > 6000 || typeof input.checkoutEnabled !== "boolean") throw new StoreError("Please check delivery and policy settings.");
  const settings: StoreSettings = { delivery: { dhaka: delivery.dhaka === null ? null : toMinor(delivery.dhaka, true) / 100, outsideDhaka: delivery.outsideDhaka === null ? null : toMinor(delivery.outsideDhaka, true) / 100 }, policies: { delivery: policies.delivery.trim(), returns: policies.returns.trim() }, checkoutEnabled: input.checkoutEnabled };
  if (settings.checkoutEnabled && (settings.delivery.dhaka == null || settings.delivery.outsideDhaka == null || !settings.policies.delivery || !settings.policies.returns)) throw new StoreError("Confirm delivery rates and policies before enabling checkout.");
  const db = database(), now = new Date().toISOString(), guard = crypto.randomUUID();
  // Optimistic concurrency is checked inside the D1 transaction, so an open admin
  // form cannot overwrite stock deducted by a newer customer checkout.
  const result = await db.batch([
    db.prepare(`INSERT INTO store_settings (id,value,updated_at) SELECT 'catalog-write-guard',?,? WHERE ${productSignatureSql}=? AND (SELECT value FROM store_settings WHERE id='store') IS ?`).bind(guard, now, snapshot.signature, snapshot.value),
    ...rows.map((row) => db.prepare("INSERT INTO product_settings (id,price_minor,stock,enabled,updated_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM store_settings WHERE id='catalog-write-guard' AND value=?) ON CONFLICT(id) DO UPDATE SET price_minor=excluded.price_minor,stock=excluded.stock,enabled=excluded.enabled,updated_at=excluded.updated_at").bind(row.id, row.price, row.stock, row.enabled ? 1 : 0, now, guard)),
    db.prepare("INSERT INTO store_settings (id,value,updated_at) SELECT 'store',?,? WHERE EXISTS (SELECT 1 FROM store_settings WHERE id='catalog-write-guard' AND value=?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(settings), now, guard),
    db.prepare("DELETE FROM store_settings WHERE id='catalog-write-guard' AND value=?").bind(guard),
  ]);
  if (result[0].meta.changes !== 1) throw new StoreError("Stock or store settings changed. Refresh the dashboard before saving.", 409);
  return readConfig();
}
