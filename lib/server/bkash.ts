import { StoreError } from "./validation";
import type { StoreDatabase } from "./database";

export type BkashSettings = { DB?: StoreDatabase; BKASH_ENV?: string; BKASH_API_VERSION?: string; BKASH_USERNAME?: string; BKASH_PASSWORD?: string; BKASH_APP_KEY?: string; BKASH_APP_SECRET?: string };
export type ProviderResult = Record<string, unknown>;

// bKash Tokenized Checkout v1.2.0-beta, checkout-only mode (no stored wallet).
// https://developer.bka.sh/docs/create-payment-2
// https://developer.bka.sh/docs/execute-payment-2
// https://developer.bka.sh/docs/query-payment-1
export class BkashClient {
  private settings: BkashSettings;
  private request: typeof fetch;
  private token: string | null = null;
  private base: string;
  constructor(settings: BkashSettings, request: typeof fetch = fetch) {
    this.settings = settings; this.request = request;
    if (settings.BKASH_API_VERSION !== "v1.2.0-beta") throw new StoreError("This merchant’s bKash API compatibility has not been confirmed.", 503);
    if (!["sandbox", "live"].includes(settings.BKASH_ENV || "") || !settings.BKASH_USERNAME || !settings.BKASH_PASSWORD || !settings.BKASH_APP_KEY || !settings.BKASH_APP_SECRET) throw new StoreError("Online payment is not available yet.", 503);
    this.base = settings.BKASH_ENV === "live" ? "https://tokenized.pay.bka.sh/v1.2.0-beta" : "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
  }
  private async post(path: string, body: object, headers: Record<string, string>) {
    const response = await this.request(`${this.base}/tokenized/checkout/${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000), redirect: "error" });
    if (!response.ok) throw new StoreError("The payment service is temporarily unavailable. Please check your order status before trying again.", 502);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("Unexpected payment service response.", 502);
    return value as ProviderResult;
  }
  private async auth() {
    if (this.token) return this.token;
    const db = this.settings.DB;
    if (!db) throw new StoreError("Payment token storage is unavailable.", 503);
    const credentialHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([this.settings.BKASH_API_VERSION, this.settings.BKASH_APP_KEY, this.settings.BKASH_APP_SECRET, this.settings.BKASH_USERNAME, this.settings.BKASH_PASSWORD]))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `bkash-token:${this.settings.BKASH_ENV}`;
    const cached = async () => {
      const row = await db.prepare("SELECT value FROM store_settings WHERE id=?").bind(key).first<{ value: string }>();
      if (!row) return null;
      try { const value = JSON.parse(row.value); return value.credentialHash === credentialHash && typeof value.token === "string" && value.expiresAt > Date.now() ? value.token as string : null; } catch { return null; }
    };
    this.token = await cached(); if (this.token) return this.token;
    // Reuse the merchant token across worker instances. A short D1 lease avoids
    // simultaneous grant calls; tokens are never exposed through store settings APIs.
    const lockId = crypto.randomUUID(), lockKey = `${key}:lock`, now = new Date().toISOString();
    const lock = await db.prepare("INSERT INTO store_settings (id,value,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE store_settings.updated_at < ?").bind(lockKey, lockId, new Date(Date.now() + 30000).toISOString(), now).run();
    if (lock.meta.changes !== 1) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        this.token = await cached(); if (this.token) return this.token;
      }
      throw new StoreError("The payment service is preparing a connection. Please retry shortly.", 503);
    }
    try {
      this.token = await cached(); if (this.token) return this.token;
      const data = await this.post("token/grant", { app_key: this.settings.BKASH_APP_KEY, app_secret: this.settings.BKASH_APP_SECRET }, { username: this.settings.BKASH_USERNAME!, password: this.settings.BKASH_PASSWORD! });
      if (data.statusCode !== "0000" || typeof data.id_token !== "string") throw new StoreError("Online payment is temporarily unavailable.", 502);
      const expiresAt = Date.now() + Math.max(0, Math.min(3600, Number(data.expires_in) || 3600) - 60) * 1000;
      await db.prepare("INSERT INTO store_settings (id,value,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key, JSON.stringify({ token: data.id_token, expiresAt, credentialHash }), new Date().toISOString()).run();
      this.token = data.id_token; return this.token;
    } finally {
      await db.prepare("DELETE FROM store_settings WHERE id=? AND value=?").bind(lockKey, lockId).run();
    }
  }
  private async call(path: string, body: object) { return this.post(path, body, { authorization: await this.auth(), "x-app-key": this.settings.BKASH_APP_KEY! }); }
  create(input: { orderId: string; phone: string; amountMinor: number; callbackURL: string }) {
    return this.call("create", { mode: "0011", payerReference: input.phone, callbackURL: input.callbackURL, amount: (input.amountMinor / 100).toFixed(2), currency: "BDT", intent: "sale", merchantInvoiceNumber: input.orderId });
  }
  execute(paymentId: string) { return this.call("execute", { paymentID: paymentId }); }
  query(paymentId: string) { return this.call("payment/status", { paymentID: paymentId }); }
}
