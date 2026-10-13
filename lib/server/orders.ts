import { products } from "@/lib/catalog";
import { BkashClient, type ProviderResult } from "./bkash";
import { publicOrigin, readConfig } from "./config";
import { database, env, randomToken, sha256 } from "./runtime";
import { type CheckoutInput, paymentMatches, providerMinor, safePaymentUrl, secretEqual, StoreError } from "./validation";

export type OrderRow = { id: string; idempotency_key: string; request_hash: string; access_token: string; callback_token: string; status: string; fulfillment_status: string; customer_json: string; subtotal_minor: number; delivery_minor: number; total_minor: number; payment_id: string | null; payment_url: string | null; transaction_id: string | null; payment_mode: string; tracking: string | null; reservation_released: number; created_at: string; updated_at: string };
type ItemRow = { product_id: string; name: string; quantity: number; unit_price_minor: number };
export async function getOrder(id: string) { return database().prepare("SELECT * FROM orders WHERE id=?").bind(id).first<OrderRow>(); }
export async function serializeOrder(order: OrderRow, admin = false) {
  const items = await database().prepare("SELECT product_id,name,quantity,unit_price_minor FROM order_items WHERE order_id=? ORDER BY product_id").bind(order.id).all<ItemRow>();
  return { id: order.id, status: order.status, fulfillmentStatus: order.fulfillment_status, items: items.results.map((i) => ({ id: i.product_id, name: i.name, quantity: i.quantity, unitPrice: i.unit_price_minor / 100 })), subtotal: order.subtotal_minor / 100, deliveryCharge: order.delivery_minor / 100, total: order.total_minor / 100, transactionId: order.transaction_id, paymentMode: order.payment_mode, createdAt: order.created_at, tracking: order.tracking, ...(admin ? { customer: JSON.parse(order.customer_json) } : {}) };
}
export function customerCanRead(order: OrderRow, token: string) { return /^[a-f0-9]{64}$/.test(token) && secretEqual(order.access_token, token); }
async function recordEvent(id: string, event: string, code: unknown = null) { await database().prepare("INSERT INTO payment_events (id,order_id,event,provider_code,created_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), id, event, typeof code === "string" ? code.slice(0, 80) : null, new Date().toISOString()).run(); }
function checkoutResponse(order: OrderRow) {
  if (order.status === "creating") throw new StoreError("Payment is being prepared. Please retry shortly without changing your checkout.", 425);
  return { orderId: order.id, token: order.access_token, status: order.status, paymentUrl: order.status === "pending" ? order.payment_url : null, statusUrl: `/order-status?order=${encodeURIComponent(order.id)}&token=${order.access_token}` };
}

export async function createOrder(input: CheckoutInput) {
  const db = database();
  const requestHash = await sha256(JSON.stringify({ items: input.items, customer: input.customer, expectedTotalMinor: input.expectedTotalMinor }));
  const existing = await db.prepare("SELECT * FROM orders WHERE idempotency_key=?").bind(input.idempotencyKey).first<OrderRow>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new StoreError("This checkout was already used with different details. Please refresh checkout.", 409);
    return checkoutResponse(existing);
  }
  const config = await readConfig();
  if (!config.readiness.ready) throw new StoreError("Online checkout is being prepared. Please contact Meew Decor to confirm prices and availability.", 503);
  const lineItems = input.items.map((item) => {
    const configured = config.products.find((p) => p.id === item.id);
    const catalog = products.find((p) => p.id === item.id);
    if (!catalog || !configured?.enabled || configured.price === null || configured.stock === null || configured.stock < item.quantity) throw new StoreError("An item in your bag is unavailable or its stock has changed. Please refresh your bag.", 409);
    return { ...item, name: catalog.name, priceMinor: Math.round(configured.price * 100) };
  });
  const subtotal = lineItems.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);
  const delivery = Math.round(config.delivery[input.customer.zone]! * 100);
  const total = subtotal + delivery;
  if (!Number.isSafeInteger(total) || total < 100 || total > 50000000) throw new StoreError("This order is outside the supported online payment amount. Please contact Meew Decor.");
  if (input.expectedTotalMinor !== total) throw new StoreError("The price or delivery charge changed. Please review the updated order total before paying.", 409);
  const orderId = `MD-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
  const accessToken = randomToken(), callbackToken = randomToken(), now = new Date().toISOString();
  // D1 batch is transactional. Its first conditional INSERT checks every product's
  // price and stock inside the same transaction that deducts the reservation.
  const stockChecks = lineItems.map(() => "EXISTS (SELECT 1 FROM product_settings WHERE id=? AND enabled=1 AND price_minor=? AND stock>=?)").join(" AND ");
  const settingsSnapshot = JSON.stringify({ delivery: config.delivery, policies: config.policies, checkoutEnabled: config.checkoutEnabled });
  const insert = db.prepare(`INSERT INTO orders (id,idempotency_key,request_hash,access_token,callback_token,status,fulfillment_status,customer_json,subtotal_minor,delivery_minor,total_minor,payment_mode,reservation_released,created_at,updated_at) SELECT ?,?,?,?,?,'creating','unfulfilled',?,?,?,?,?,0,?,? WHERE ${stockChecks} AND EXISTS (SELECT 1 FROM store_settings WHERE id='store' AND value=?)`).bind(orderId, input.idempotencyKey, requestHash, accessToken, callbackToken, JSON.stringify(input.customer), subtotal, delivery, total, config.readiness.mode, now, now, ...lineItems.flatMap((i) => [i.id, i.priceMinor, i.quantity]), settingsSnapshot);
  try {
    await db.batch([insert, ...lineItems.flatMap((item) => [
      db.prepare("INSERT INTO order_items (id,order_id,product_id,name,quantity,unit_price_minor) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=?)").bind(crypto.randomUUID(), orderId, item.id, item.name, item.quantity, item.priceMinor, orderId),
      db.prepare("UPDATE product_settings SET stock=stock-?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM orders WHERE id=?)").bind(item.quantity, now, item.id, orderId),
    ])]);
  } catch (error) {
    const raced = await db.prepare("SELECT * FROM orders WHERE idempotency_key=?").bind(input.idempotencyKey).first<OrderRow>();
    if (raced && raced.request_hash === requestHash) return checkoutResponse(raced);
    throw error;
  }
  let order = await getOrder(orderId);
  if (!order) throw new StoreError("Prices or availability changed. Please refresh your bag and try again.", 409);
  const callback = new URL("/api/payment/callback", publicOrigin()!);
  callback.searchParams.set("order", orderId); callback.searchParams.set("state", callbackToken);
  try {
    const result = await new BkashClient(env).create({ orderId, phone: input.customer.phone, amountMinor: total, callbackURL: callback.toString() });
    const paymentUrl = safePaymentUrl(result.bkashURL);
    if (result.statusCode !== "0000" || typeof result.paymentID !== "string" || result.paymentID.length > 150 || !paymentUrl || providerMinor(result.amount) !== total || result.currency !== "BDT") {
      await recordEvent(orderId, "create_rejected", result.statusCode);
      await releaseReservation(orderId, "failed");
      throw new StoreError("bKash could not start this payment. No payment has been confirmed. Please try again with a new checkout.", 502);
    }
    await db.prepare("UPDATE orders SET status='pending',payment_id=?,payment_url=?,updated_at=? WHERE id=? AND status='creating'").bind(result.paymentID, paymentUrl, new Date().toISOString(), orderId).run();
    await recordEvent(orderId, "payment_created", result.statusCode);
  } catch (error) {
    order = (await getOrder(orderId))!;
    if (order.status === "creating") await releaseReservation(orderId, "failed");
    throw error;
  }
  return checkoutResponse((await getOrder(orderId))!);
}

// Release happens only after a provider-confirmed terminal failure/cancel, or
// before a payment URL has ever been returned. The reservation flag makes repeats safe.
export async function releaseReservation(id: string, status: "failed" | "cancelled") {
  const db = database(), now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE product_settings SET stock=stock+(SELECT quantity FROM order_items WHERE order_id=? AND product_id=product_settings.id),updated_at=? WHERE id IN (SELECT product_id FROM order_items WHERE order_id=?) AND EXISTS (SELECT 1 FROM orders WHERE id=? AND reservation_released=0 AND status!='paid')").bind(id, now, id, id),
    db.prepare("UPDATE orders SET status=?,reservation_released=1,updated_at=? WHERE id=? AND status!='paid' AND reservation_released=0").bind(status, now, id),
  ]);
}

async function applyProviderResult(order: OrderRow, result: ProviderResult) {
  const db = database();
  if (result.statusCode === "0000" && result.paymentID === order.payment_id && result.transactionStatus === "Initiated") {
    const current = (await getOrder(order.id))!;
    // An owner checking status while the customer is still on bKash must not
    // consume the future callback's pending -> verifying execution transition.
    if (current.status === "pending") return current;
  }
  if (paymentMatches(result, { paymentId: order.payment_id!, totalMinor: order.total_minor, id: order.id })) {
    // An order with a released reservation must be reviewed, never silently fulfilled.
    await db.prepare("UPDATE orders SET status=CASE WHEN reservation_released=0 THEN 'paid' ELSE 'review' END,transaction_id=?,updated_at=? WHERE id=? AND status!='paid'").bind(result.trxID as string, new Date().toISOString(), order.id).run();
    await recordEvent(order.id, "payment_verified", result.statusCode);
  } else if (result.statusCode === "0000" && result.paymentID === order.payment_id && ["Cancelled", "Failed", "Expired"].includes(String(result.transactionStatus))) {
    await releaseReservation(order.id, result.transactionStatus === "Cancelled" ? "cancelled" : "failed");
    await recordEvent(order.id, "payment_terminal", result.transactionStatus);
  } else {
    await db.prepare("UPDATE orders SET status='review',updated_at=? WHERE id=? AND status!='paid'").bind(new Date().toISOString(), order.id).run();
    await recordEvent(order.id, "verification_required", result.statusCode);
  }
  return (await getOrder(order.id))!;
}

export async function reconcileOrder(order: OrderRow) {
  if (order.status === "paid") return order;
  if (!order.payment_id) {
    if (order.status === "failed" || order.status === "cancelled") return order;
    // A worker interruption before payment creation cannot have exposed a payment
    // URL. Allow the owner to recover its reservation after a generous timeout.
    if (order.status === "creating" && Date.now() - Date.parse(order.created_at) > 30 * 60 * 1000) {
      await releaseReservation(order.id, "failed");
      await recordEvent(order.id, "abandoned_creation_released");
      return (await getOrder(order.id))!;
    }
    throw new StoreError("Payment creation is not yet complete. Recheck after 30 minutes if it remains interrupted.", 409);
  }
  if (order.payment_mode !== env.BKASH_ENV) throw new StoreError("Switch to this order’s payment environment before reconciliation.", 409);
  return applyProviderResult(order, await new BkashClient(env).query(order.payment_id));
}

export async function handleCallback(order: OrderRow, paymentId: string, state: string, status: string) {
  if (!secretEqual(order.callback_token, state) || order.payment_id !== paymentId) throw new StoreError("Invalid payment callback.", 403);
  if (order.status === "paid") return order;
  if (order.payment_mode !== env.BKASH_ENV) throw new StoreError("Payment environment changed. Contact Meew Decor to verify your order.", 409);
  const provider = new BkashClient(env);
  // Compare-and-set permits exactly one execution even if bKash repeats its redirect.
  if (status === "success") {
    const lock = await database().prepare("UPDATE orders SET status='verifying',updated_at=? WHERE id=? AND status='pending' RETURNING id").bind(new Date().toISOString(), order.id).first();
    if (lock) {
      try {
        const executed = await provider.execute(paymentId);
        if (paymentMatches(executed, { paymentId, totalMinor: order.total_minor, id: order.id })) return applyProviderResult(order, executed);
      } catch { /* Execute timeout is not failure: query before deciding. */ }
    }
  }
  try { return await applyProviderResult(order, await provider.query(paymentId)); }
  catch {
    await database().prepare("UPDATE orders SET status='review',updated_at=? WHERE id=? AND status!='paid'").bind(new Date().toISOString(), order.id).run();
    await recordEvent(order.id, "provider_unavailable");
    return (await getOrder(order.id))!;
  }
}
