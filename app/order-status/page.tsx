"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Leaf, Loader2, LockKeyhole, PackageCheck, RefreshCw, ShoppingBag, Truck } from "lucide-react";
import "../admin/admin.css";

type Order = { id: string; status: string; fulfillmentStatus: string; paymentMode: "live" | "sandbox"; items: { id: string; name: string; quantity: number; unitPrice: number }[]; subtotal: number; deliveryCharge: number; total: number; transactionId?: string; createdAt: string; tracking?: string };
const money = (amount: number) => new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 2 }).format(amount);

function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object"; }
function isOrder(value: unknown): value is Order {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.status !== "string" || typeof value.fulfillmentStatus !== "string" || !["live", "sandbox"].includes(String(value.paymentMode)) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return false;
  if (![value.subtotal, value.deliveryCharge, value.total].every(amount => typeof amount === "number" && Number.isFinite(amount))) return false;
  if (!Array.isArray(value.items) || !value.items.every(item => isObject(item) && typeof item.id === "string" && typeof item.name === "string" && typeof item.quantity === "number" && typeof item.unitPrice === "number")) return false;
  return (value.tracking == null || typeof value.tracking === "string") && (value.transactionId == null || typeof value.transactionId === "string");
}

export default function OrderStatusPage() {
  return <Suspense fallback={<main className="md-admin"><div className="md-admin-state" role="status"><Loader2 size={32} className="md-spin" /><p>Loading your order…</p></div></main>}><OrderStatusContent /></Suspense>;
}

function OrderStatusContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("order");
  const token = searchParams.get("token");
  const missing = !id || !token;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!id || !token) return;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const body: unknown = await response.json().catch(() => ({}));
      const result = isObject(body) ? body : {};
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 || response.status === 404 ? "This private order link could not be verified. Please use the complete link from your checkout." : typeof result.error === "string" ? result.error : "We couldn’t load your order. Please try again shortly.");
      if (!isOrder(result.order)) throw new Error("Your order details couldn’t be loaded completely. Please refresh or contact Meew Decor.");
      setOrder(result.order); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "We couldn’t load your order. Please try again."); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id, token]);

  useEffect(() => { if (!missing) void Promise.resolve().then(refresh); }, [missing, refresh]);
  const paymentStatus = order?.status;
  useEffect(() => {
    if (!paymentStatus || !["pending", "creating", "verifying"].includes(paymentStatus)) return;
    let checks = 0;
    const interval = window.setInterval(() => { if (++checks >= 10) window.clearInterval(interval); if (document.visibilityState === "visible") void refresh(); }, 12000);
    return () => window.clearInterval(interval);
  }, [paymentStatus, refresh]);

  const sandbox = order?.paymentMode === "sandbox";
  const paid = order?.status === "paid";
  const unsuccessful = order && ["failed", "cancelled", "canceled", "expired"].includes(order.status);
  const refunded = order?.status === "refunded";
  const title = sandbox ? paid ? "Your test payment is complete." : "This is a test checkout." : paid ? "A lovely choice. It’s yours." : refunded ? "Your payment has been refunded." : unsuccessful ? "Your payment wasn’t completed." : order?.status === "review" ? "Your payment needs a closer look." : "We’re checking your payment.";
  const stages = ["unfulfilled", "processing", "shipped", "delivered"];
  const stage = order ? stages.indexOf(order.fulfillmentStatus) : -1;

  return <main className="md-status md-admin"><header className="md-admin-header"><Link className="md-admin-brand" href="/" aria-label="Meew Decor home"><Leaf size={28} strokeWidth={1.3} /><span>meew<span className="md-admin-brand-small">DECOR</span></span></Link><Link href="/" className="md-admin-store-link">Back to the collection <ArrowUpRight size={16} /></Link></header>
    <div className="md-status-shell">
      {loading && !missing ? <div className="md-admin-state" role="status"><Loader2 size={32} className="md-spin" /><h1>A little moment…</h1><p>We’re securely looking up your order.</p></div> : missing ? <div className="md-admin-state"><span className="md-admin-state-icon"><LockKeyhole size={30} strokeWidth={1.4} /></span><p className="md-admin-eyebrow">YOUR ORDER, KEPT PRIVATE</p><h1>Use your personal order link.</h1><p>Open the complete order-status link provided after checkout to view your payment and delivery updates.</p><Link className="md-admin-button" href="/">Return to Meew Decor <ArrowUpRight size={16} /></Link></div> : !order ? <div className="md-admin-state"><span className="md-admin-state-icon"><CircleAlert size={30} strokeWidth={1.4} /></span><h1>Let’s find your order.</h1><p role="alert">{error}</p><button className="md-admin-button" disabled={refreshing} onClick={() => { setRefreshing(true); void refresh(); }}><RefreshCw size={16} className={refreshing ? "md-spin" : ""} />{refreshing ? "Checking…" : "Try again"}</button><Link className="md-admin-text-button" href="/#contact">Contact Meew Decor <ArrowUpRight size={15} /></Link></div> : <>
        <div className="md-status-intro"><span className={`md-status-icon ${paid ? "md-status-icon-paid" : ""}`}>{paid ? <CheckCircle2 size={36} strokeWidth={1.3} /> : unsuccessful || refunded ? <CircleAlert size={36} strokeWidth={1.3} /> : <Clock3 size={36} strokeWidth={1.3} />}</span><p className="md-admin-eyebrow">{sandbox ? "BKASH SANDBOX · TEST ORDER" : paid ? "THANK YOU FOR CHOOSING MEEW" : "YOUR ORDER UPDATE"}</p><h1>{title}</h1><p>{sandbox ? "No real payment was collected. This order was created in test mode and will not be fulfilled." : paid ? "Your payment is confirmed. We’ll take care of the little details from here." : refunded ? "Please contact Meew Decor if you need help with your refund." : unsuccessful ? "This order has not been marked as paid. You can contact us for help or return to the collection." : order.status === "review" ? "Please contact Meew Decor with your order reference. Don’t pay again until we have checked your payment with bKash." : "Your payment is not yet confirmed. Check this page again before attempting another payment."}</p></div>
        {error && <div className="md-admin-message md-admin-message-error" role="alert"><CircleAlert size={18} />{error} The order details below show the last successful update.</div>}
        <section className="md-status-card"><div className="md-status-order-heading"><div><span className="md-admin-eyebrow">ORDER REFERENCE</span><h2>#{order.id}</h2><p>{new Date(order.createdAt).toLocaleString("en-BD", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Dhaka" })} (Bangladesh time)</p></div><span className={`md-admin-badge ${paid ? "md-admin-badge-green" : "md-admin-badge-amber"}`}>{paid ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}{order.status.replace(/[_-]/g, " ")}</span></div>
          {paid && !sandbox && <div className="md-status-progress" aria-label="Delivery progress">{[{ title: "Confirmed", icon: CheckCircle2 }, { title: "Preparing", icon: ShoppingBag }, { title: "On its way", icon: Truck }, { title: "Delivered", icon: PackageCheck }].map((step, index) => <div key={step.title} className={index <= Math.max(0, stage) ? "is-complete" : ""} aria-current={index === Math.max(0, stage) ? "step" : undefined}><span><step.icon size={19} strokeWidth={1.5} /></span><p>{step.title}</p></div>)}</div>}
          {order.tracking && <div className="md-status-tracking"><Truck size={20} /><div><strong>Delivery update</strong><p>{order.tracking}</p></div></div>}
          <div className="md-status-items"><h3>Your thoughtfully chosen pieces</h3>{order.items.map(item => <div key={item.id} className="md-status-item"><span className="md-status-item-icon"><Leaf size={24} strokeWidth={1.2} /></span><span><strong>{item.name}</strong><small>Quantity {item.quantity} · {money(item.unitPrice)} each</small></span><strong>{money(item.unitPrice * item.quantity)}</strong></div>)}</div>
          <dl className="md-status-totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div><div><dt>Delivery</dt><dd>{money(order.deliveryCharge)}</dd></div><div className="md-status-total"><dt>{sandbox ? "Test amount" : paid ? "Total paid" : "Total amount"}</dt><dd>{money(order.total)}</dd></div></dl>
          {order.transactionId && <p className="md-status-transaction">bKash transaction reference <strong>{order.transactionId}</strong></p>}
        </section>
        <div className="md-status-actions"><Link className="md-admin-button" href="/"><ArrowLeft size={16} />Back to the collection</Link><button className="md-admin-button md-admin-button-secondary" disabled={refreshing} onClick={() => { setRefreshing(true); void refresh(); }}><RefreshCw size={16} className={refreshing ? "md-spin" : ""} />{refreshing ? "Checking…" : "Refresh order status"}</button></div>
        <div className="md-status-help"><p>A little help with your order?</p><Link href="/#contact">Get in touch with Meew Decor <ArrowUpRight size={15} /></Link><small><LockKeyhole size={12} />Keep this private link somewhere safe. Anyone with the link can view these order details.</small></div>
      </>}
    </div>
    <footer className="md-status-footer">Thoughtfully chosen. Beautifully yours. <span>Meew Decor</span></footer>
  </main>;
}
