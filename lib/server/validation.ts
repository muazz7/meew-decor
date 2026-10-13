export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export type Customer = { name: string; phone: string; email: string; address: string; city: string; zone: "dhaka" | "outsideDhaka" };
export type CheckoutInput = { items: { id: string; quantity: number }[]; customer: Customer; idempotencyKey: string; expectedTotalMinor: number };
function clean(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== "string") throw new StoreError(`Please enter ${field}.`);
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  if (text.length < min || text.length > max) throw new StoreError(`Please check ${field}.`);
  return text;
}
export function parseCheckout(value: unknown): CheckoutInput {
  if (!value || typeof value !== "object") throw new StoreError("Invalid checkout request.");
  const v = value as Record<string, unknown>;
  if (typeof v.expectedTotalMinor !== "number" || !Number.isSafeInteger(v.expectedTotalMinor) || v.expectedTotalMinor < 100 || v.expectedTotalMinor > 50000000) throw new StoreError("Please review the latest order total before paying.");
  if (typeof v.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.idempotencyKey)) throw new StoreError("Please refresh checkout and try again.");
  if (!Array.isArray(v.items) || v.items.length < 1 || v.items.length > 20) throw new StoreError("Choose between 1 and 20 products.");
  const seen = new Set<string>();
  const items = v.items.map((item) => {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10 || seen.has(item.id)) throw new StoreError("Please check the quantities in your bag.");
    seen.add(item.id); return { id: item.id, quantity: item.quantity as number };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (!v.customer || typeof v.customer !== "object") throw new StoreError("Delivery details are required.");
  const c = v.customer as Record<string, unknown>;
  const phone = clean(c.phone, 11, 18, "a Bangladesh mobile number").replace(/[\s-]/g, "").replace(/^\+?88/, "");
  if (!/^01[3-9]\d{8}$/.test(phone)) throw new StoreError("Enter a valid Bangladesh mobile number, e.g. 01712345678.");
  const email = c.email ? clean(c.email, 3, 254, "your email") : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new StoreError("Please check your email address.");
  if (c.zone !== "dhaka" && c.zone !== "outsideDhaka") throw new StoreError("Choose a delivery area.");
  return { items, idempotencyKey: v.idempotencyKey, expectedTotalMinor: v.expectedTotalMinor, customer: { name: clean(c.name, 2, 100, "your name"), phone, email, address: clean(c.address, 10, 500, "a complete delivery address"), city: clean(c.city, 2, 100, "your city or district"), zone: c.zone } };
}
export function toMinor(value: unknown, allowZero = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < (allowZero ? 0 : 1) || value > 500000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new StoreError("Prices must be valid BDT amounts with at most two decimals.");
  return Math.round(value * 100);
}
export function providerMinor(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}
export function paymentMatches(result: Record<string, unknown>, expected: { paymentId: string; totalMinor: number; id: string }) {
  return result.statusCode === "0000" && result.transactionStatus === "Completed" && result.paymentID === expected.paymentId && result.currency === "BDT" && providerMinor(result.amount) === expected.totalMinor && typeof result.trxID === "string" && result.trxID.length > 0 && (result.merchantInvoiceNumber === undefined || result.merchantInvoiceNumber === expected.id);
}
export function safePaymentUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && ["payment.bkash.com", "sandbox.payment.bkash.com"].includes(url.hostname) ? url.toString() : null; } catch { return null; }
}
export function secretEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
