"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleAlert, CreditCard, Leaf, Loader2, LockKeyhole, LogOut, Package, RefreshCw, Save, Settings2, ShoppingBag, Truck } from "lucide-react";
import "./admin.css";

type Product = { id: string; name: string; price: number | null; stock: number | null; enabled: boolean };
type Catalog = {
  revision: string;
  products: Product[];
  delivery: { dhaka: number | null; outsideDhaka: number | null };
  policies: { delivery: string; returns: string };
  checkoutEnabled: boolean;
  readiness: { ready: boolean; issues: string[]; mode: string };
};
type Fulfillment = "unfulfilled" | "processing" | "shipped" | "delivered";
type Order = {
  id: string; status: string; fulfillmentStatus: Fulfillment; paymentMode: "live" | "sandbox";
  customer: { name: string; phone: string; email?: string; address: string; city: string; zone: string };
  items: { id: string; name: string; quantity: number; unitPrice: number }[];
  subtotal: number; deliveryCharge: number; total: number; transactionId?: string; createdAt: string; tracking?: string;
};
type PageError = { message: string; status: number };
type Tab = "catalog" | "orders" | "settings";
type OrdersResponse = { orders: Order[]; nextCursor?: string | null };
type AuthInfo = { provider: "password" | "chatgpt"; configured: boolean; authenticated: boolean; issues: string[] };

const money = (amount: number) => new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 2 }).format(amount);
const readable = (value: string) => value.replace(/[_-]/g, " ");
const date = (value: string) => new Date(value).toLocaleString("en-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" });

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const result: unknown = await response.json().catch(() => ({}));
  const body = result !== null && typeof result === "object" ? result as Record<string, unknown> : {};
  if (!response.ok) throw { message: typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "We couldn’t complete this request. Please try again.", status: response.status };
  return body as T;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("catalog");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PageError | null>(null);
  const [orderError, setOrderError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const [filter, setFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [auth, setAuth] = useState<AuthInfo | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const load = useCallback(async () => {
    let identity: AuthInfo;
    try { identity = await api<AuthInfo>("/api/admin/auth"); setAuth(identity); }
    catch (cause) { setError(cause as PageError); setCatalog(null); setOrders([]); setLoading(false); return; }
    if (!identity.authenticated) {
      setCatalog(null); setOrders([]); setError({ status: identity.configured ? 401 : 503, message: identity.configured ? "Sign in to manage the store." : "Owner sign-in needs to be configured in the hosting environment." }); setLoading(false); return false;
    }
    const results = await Promise.allSettled([api<Catalog>("/api/admin/catalog"), api<OrdersResponse>("/api/admin/orders")]);
    if (results[0].status === "fulfilled") { setCatalog(results[0].value); setError(null); }
    else setError(results[0].reason as PageError);
    if (results[1].status === "fulfilled") { setOrders(results[1].value.orders); setNextCursor(results[1].value.nextCursor || null); setOrderError(""); }
    else setOrderError((results[1].reason as PageError).message || "Orders could not be loaded.");
    setLoading(false);
    return true;
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setLoginError("");
    try {
      await api("/api/admin/auth/login", { method: "POST", body: JSON.stringify({ email: loginEmail, password: loginPassword }) });
      setLoginPassword(""); setLoading(true); setError(null);
      if (await load() === false) setLoginError("Your browser did not keep the secure session. Use HTTPS or localhost and allow cookies, then try again.");
    } catch (cause) { setLoginError((cause as PageError).message || "Sign-in could not be completed. Please try again."); }
    finally { setAuthBusy(false); }
  }

  async function signOut() {
    if (dirty && !window.confirm("Sign out and discard your unsaved changes?")) return;
    setAuthBusy(true);
    try {
      await api("/api/admin/auth/logout", { method: "POST", body: "{}" });
      setDirty(false); setNotice(""); setSaveError(""); setLoginPassword(""); setLoading(true); await load();
    } catch (cause) { setSaveError((cause as PageError).message || "Sign-out failed. Please try again."); }
    finally { setAuthBusy(false); }
  }

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function updateCatalog(change: Partial<Catalog>) {
    setCatalog(current => current ? { ...current, ...change } : current);
    setDirty(true); setNotice(""); setSaveError("");
  }

  function updateProduct(id: string, change: Partial<Product>) {
    if (!catalog) return;
    updateCatalog({ products: catalog.products.map(product => product.id === id ? { ...product, ...change } : product) });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!catalog) return;
    setSaving(true); setNotice(""); setSaveError(""); setSaveConflict(false);
    try {
      const result = await api<Catalog | { catalog: Catalog }>("/api/admin/catalog", { method: "PUT", body: JSON.stringify(catalog) });
      const updated = "catalog" in result ? result.catalog : result;
      setCatalog(updated); setDirty(false); setNotice("Your store settings have been saved.");
    } catch (cause) { setSaveError((cause as PageError).message || "Settings could not be saved. Your changes are still here."); setSaveConflict((cause as PageError).status === 409); }
    finally { setSaving(false); }
  }

  async function reloadSettings() {
    setSaving(true);
    try { setCatalog(await api<Catalog>("/api/admin/catalog")); setDirty(false); setSaveConflict(false); setSaveError(""); setNotice("The latest saved settings are loaded. Review them before making further changes."); }
    catch (cause) { setSaveError((cause as PageError).message || "Settings could not be reloaded."); }
    finally { setSaving(false); }
  }

  async function refreshOrders(more = false) {
    setRefreshing(true); setOrderError("");
    try { const result = await api<OrdersResponse>(`/api/admin/orders${more && nextCursor ? `?before=${encodeURIComponent(nextCursor)}` : ""}`); setOrders(current => more ? [...current, ...result.orders.filter(order => !current.some(item => item.id === order.id))] : result.orders); setNextCursor(result.nextCursor || null); }
    catch (cause) { setOrderError((cause as PageError).message || "Orders could not be refreshed."); }
    finally { setRefreshing(false); }
  }

  return <main className="md-admin">
    <header className="md-admin-header">
      <Link className="md-admin-brand" href="/" aria-label="Meew Decor home"><Leaf size={28} strokeWidth={1.3} /><span>meew<span className="md-admin-brand-small">DECOR</span></span></Link>
      <span className="md-admin-header-label"><LockKeyhole size={14} /> Owner studio</span>
      <Link href="/" className="md-admin-store-link">Visit store <ArrowUpRight size={16} /></Link>
      {auth?.authenticated && (auth.provider === "password" ? <button className="md-admin-signout" disabled={authBusy} onClick={() => void signOut()}><LogOut size={15} />{authBusy ? "Signing out…" : "Sign out"}</button> : <a className="md-admin-signout" href="/signout-with-chatgpt?return_to=/admin" target="_top"><LogOut size={15} />Sign out</a>)}
    </header>
    <div className="md-admin-shell">
      {loading ? <div className="md-admin-state" role="status"><Loader2 className="md-spin" size={28} /><h1>Opening your studio</h1><p>Loading your store and orders.</p></div> : error ? <div className="md-admin-state md-admin-auth">
        <span className="md-admin-state-icon"><LockKeyhole size={30} strokeWidth={1.4} /></span>
        <p className="md-admin-eyebrow">A SPACE FOR THE OWNER</p>
        <h1>{error.status === 403 ? "This account doesn’t have access" : error.status === 401 ? "Welcome to your studio" : "Your studio needs a little setup"}</h1>
        <p>{error.status === 401 ? "Sign in with the account approved for Meew Decor to manage products, delivery and orders." : error.status === 403 ? "Use the email address configured as the store owner to open this private area." : error.message}</p>
        {auth?.provider === "password" && auth.configured ? <form className="md-admin-login-form" onSubmit={signIn}><fieldset disabled={authBusy}><label className="md-admin-field"><span>Owner email</span><input type="email" name="email" autoComplete="username" required maxLength={254} value={loginEmail} onChange={event => setLoginEmail(event.target.value)} /></label><label className="md-admin-field"><span>Password</span><input type="password" name="password" autoComplete="current-password" required maxLength={1024} value={loginPassword} onChange={event => setLoginPassword(event.target.value)} /></label>{loginError && <p className="md-admin-error-text" role="alert">{loginError}</p>}<button className="md-admin-button" type="submit">{authBusy ? <Loader2 size={16} className="md-spin" /> : <LockKeyhole size={16} />}{authBusy ? "Signing in…" : "Sign in to your studio"}</button><p className="md-admin-login-note">Use the owner password configured for this website. To reset it, contact the person managing your hosting.</p></fieldset></form> : auth?.provider === "chatgpt" ? <a className="md-admin-button" href="/signin-with-chatgpt?return_to=/admin" target="_top">Sign in with ChatGPT <ArrowUpRight size={16} /></a> : null}
        <details className="md-admin-setup-details"><summary>Owner setup information <ChevronDown size={16} /></summary>{auth?.provider === "password" ? <><p>Your developer must set <code>STORE_ADMIN_EMAIL</code>, a generated <code>STORE_ADMIN_PASSWORD_HASH</code>, and a random <code>STORE_SESSION_SECRET</code> in the hosting environment.</p><p>The password setup command is <code>npm run admin:password</code>. The command asks for the password privately and produces configuration values. Changing the password hash or session secret signs out existing sessions.</p></> : <p>Set <code>STORE_ADMIN_EMAIL</code> in the hosting environment to the email address of the authorized owner. Hosted ChatGPT sign-in must be enabled.</p>}{auth?.issues?.length ? <ul>{auth.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}<p>Merchant passwords and payment keys belong only in secure hosting configuration.</p></details>
        <button className="md-admin-text-button" onClick={() => { setLoading(true); setError(null); void load(); }}><RefreshCw size={15} /> Check access again</button>
      </div> : catalog && <>
        <div className="md-admin-intro"><div><p className="md-admin-eyebrow">MEEW DECOR / OWNER STUDIO</p><h1>A little care, behind the scenes.</h1><p>Keep your collection current and every order moving.</p></div><span className={`md-admin-badge ${catalog.readiness.ready && catalog.checkoutEnabled ? "md-admin-badge-green" : "md-admin-badge-amber"}`}><span />{catalog.readiness.ready && catalog.checkoutEnabled ? catalog.readiness.mode === "sandbox" ? "Test checkout enabled" : "Checkout enabled" : "Checkout paused"}</span></div>
        <div className="md-admin-stats"><div><Package size={21} /><span><strong>{catalog.products.length}</strong><small>Collection pieces</small></span></div><div><ShoppingBag size={21} /><span><strong>{orders.filter(order => order.status === "paid" && order.paymentMode === "live").length}</strong><small>{nextCursor ? "Paid in loaded orders" : "Paid orders"}</small></span></div><div><Truck size={21} /><span><strong>{orders.filter(order => order.status === "paid" && order.paymentMode === "live" && order.fulfillmentStatus !== "delivered").length}</strong><small>{nextCursor ? "To fulfill in loaded orders" : "Orders to fulfill"}</small></span></div></div>
        <nav className="md-admin-tabs" aria-label="Studio sections">{([{ id: "catalog", name: "Collection", icon: Package }, { id: "orders", name: "Orders", icon: ShoppingBag }, { id: "settings", name: "Store settings", icon: Settings2 }] as const).map(item => <button type="button" key={item.id} className={tab === item.id ? "is-active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}><item.icon size={17} />{item.name}</button>)}</nav>
        {notice && <div className="md-admin-message md-admin-message-success" role="status"><CheckCircle2 size={18} />{notice}</div>}
        {saveError && <div className="md-admin-message md-admin-message-error" role="alert"><CircleAlert size={18} /><div>{saveError}{saveConflict && <button type="button" className="md-admin-conflict-button" disabled={saving} onClick={() => void reloadSettings()}>Reload saved settings and discard these edits</button>}</div></div>}
        {tab === "orders" ? <section className="md-admin-orders">
          <div className="md-admin-section-heading"><div><h2>Every order, thoughtfully handled.</h2><p>Payment status is verified by the payment gateway.</p></div><button className="md-admin-button md-admin-button-secondary" disabled={refreshing} onClick={() => void refreshOrders()}><RefreshCw size={15} className={refreshing ? "md-spin" : ""} />Refresh</button></div>
          <div className="md-admin-order-filter"><label htmlFor="order-filter">Show orders</label><select id="order-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All orders</option><option value="paid">Paid</option><option value="pending">Awaiting payment</option><option value="unfulfilled">To fulfill</option><option value="delivered">Delivered</option></select></div>
          {orderError && <div className="md-admin-message md-admin-message-error" role="alert"><CircleAlert size={18} />{orderError}</div>}
          {!orders.length && !orderError ? <div className="md-admin-empty"><ShoppingBag size={36} strokeWidth={1.2} /><h3>Your next chapter starts here.</h3><p>Orders will appear here when a customer begins checkout.</p></div> : <div className="md-admin-order-list">{orders.filter(order => matchesFilter(order, filter)).map(order => <OrderCard key={order.id} order={order} onUpdate={updated => setOrders(current => current.map(item => item.id === updated.id ? updated : item))} />)}{orders.length > 0 && !orders.some(order => matchesFilter(order, filter)) && <div className="md-admin-empty"><p>No loaded orders match this view.</p></div>}</div>}
          {nextCursor && <div className="md-admin-load-more"><button className="md-admin-button md-admin-button-secondary" disabled={refreshing} onClick={() => void refreshOrders(true)}>{refreshing ? <Loader2 size={16} className="md-spin" /> : <ChevronDown size={16} />}Load earlier orders</button><p>Counts and filters apply to the orders currently loaded.</p></div>}
        </section> : <form onSubmit={save}><fieldset className="md-admin-form-fields" disabled={saving}>
          {tab === "catalog" ? <section className="md-admin-panel">
            <div className="md-admin-section-heading"><div><h2>Your collection</h2><p>Add confirmed prices and available quantities. Amounts are in Bangladeshi taka (BDT).</p></div></div>
            <div className="md-admin-catalog-heading" aria-hidden="true"><span>Piece</span><span>Price (৳)</span><span>Stock</span><span>Available for sale</span></div>
            <div className="md-admin-product-list">{catalog.products.map(product => <div className="md-admin-product-row" key={product.id}>
              <div className="md-admin-product-name"><span className="md-admin-product-mark"><Leaf size={20} strokeWidth={1.2} /></span><div><h3>{product.name}</h3><small>{product.id}</small></div></div>
              <label className="md-admin-field"><span className="md-admin-mobile-label">Price (৳)</span><span className="md-sr-only">Price for {product.name}, in taka</span><input type="number" min="1" max="500000" step="0.01" inputMode="decimal" placeholder="Set price" value={product.price ?? ""} onChange={event => updateProduct(product.id, { price: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="md-admin-field"><span className="md-admin-mobile-label">Stock</span><span className="md-sr-only">Available quantity of {product.name}</span><input type="number" min="0" max="100000" step="1" inputMode="numeric" placeholder="Set stock" value={product.stock ?? ""} onChange={event => updateProduct(product.id, { stock: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label className="md-admin-toggle-label"><input type="checkbox" checked={product.enabled} onChange={event => updateProduct(product.id, { enabled: event.target.checked })} /><span className="md-admin-switch" aria-hidden="true" /><span>{product.enabled ? "Enabled" : "Disabled"}<span className="md-sr-only"> for {product.name}</span></span></label>
            </div>)}</div>
            <p className="md-admin-footnote"><CircleAlert size={15} />A piece needs a confirmed price and stock before it can be purchased.</p>
          </section> : <div className="md-admin-settings-grid">
            <section className="md-admin-panel"><div className="md-admin-section-heading"><div><span className="md-admin-section-icon"><Truck size={22} strokeWidth={1.4} /></span><h2>Delivery & returns</h2><p>Set the charges and policies customers see before paying.</p></div></div>
              <div className="md-admin-two-columns"><label className="md-admin-field"><span>Inside Dhaka (৳)</span><input type="number" min="0" max="500000" step="0.01" inputMode="decimal" placeholder="Delivery charge" value={catalog.delivery.dhaka ?? ""} onChange={event => updateCatalog({ delivery: { ...catalog.delivery, dhaka: event.target.value === "" ? null : Number(event.target.value) } })} /></label><label className="md-admin-field"><span>Outside Dhaka (৳)</span><input type="number" min="0" max="500000" step="0.01" inputMode="decimal" placeholder="Delivery charge" value={catalog.delivery.outsideDhaka ?? ""} onChange={event => updateCatalog({ delivery: { ...catalog.delivery, outsideDhaka: event.target.value === "" ? null : Number(event.target.value) } })} /></label></div>
              <label className="md-admin-field"><span>Delivery policy</span><textarea rows={4} maxLength={6000} placeholder="Confirm delivery coverage, estimated timing and how customers will receive updates." value={catalog.policies.delivery} onChange={event => updateCatalog({ policies: { ...catalog.policies, delivery: event.target.value } })} /></label>
              <label className="md-admin-field"><span>Returns & refund policy</span><textarea rows={5} maxLength={6000} placeholder="Confirm eligibility, time limits, damaged-item reporting and the refund process." value={catalog.policies.returns} onChange={event => updateCatalog({ policies: { ...catalog.policies, returns: event.target.value } })} /></label>
            </section>
            <div className="md-admin-settings-side"><section className="md-admin-panel"><span className="md-admin-section-icon"><CreditCard size={22} strokeWidth={1.4} /></span><h2>Payment readiness</h2><p className="md-admin-muted">bKash online payment</p><span className={`md-admin-badge ${catalog.readiness.ready ? "md-admin-badge-green" : "md-admin-badge-amber"}`}><span />{catalog.readiness.ready ? "Configuration ready" : "Configuration needed"}</span>{catalog.readiness.mode && <p className="md-admin-footnote">Gateway mode: <strong>{catalog.readiness.mode}</strong></p>}
              {catalog.readiness.issues.length > 0 ? <ul className="md-admin-readiness">{catalog.readiness.issues.map((issue, index) => <li key={`${index}-${issue}`}><CircleAlert size={15} /><span>{issue}</span></li>)}</ul> : <p className="md-admin-message-success md-admin-inline-message"><CheckCircle2 size={17} />The required store configuration is complete.</p>}
              <label className="md-admin-toggle-label md-admin-checkout-toggle"><input type="checkbox" checked={catalog.checkoutEnabled} onChange={event => updateCatalog({ checkoutEnabled: event.target.checked })} /><span className="md-admin-switch" aria-hidden="true" /><span>Enable online checkout</span></label><p className="md-admin-footnote">Save after editing. Checkout stays unavailable until the server confirms all required settings are ready.</p>
            </section><section className="md-admin-panel md-admin-setup-card"><LockKeyhole size={21} strokeWidth={1.4} /><h3>Merchant account setup</h3><p>Your developer must configure your existing bKash gateway credentials securely in the hosting environment. Use the project handover guide for the required configuration.</p><p>Keep secret keys and passwords out of product descriptions and policy fields.</p></section></div>
          </div>}
          <div className="md-admin-save-bar"><span>{dirty ? "You have unsaved changes" : "Your collection, kept up to date."}</span><button className="md-admin-button" type="submit" disabled={saving || !dirty}>{saving ? <Loader2 size={17} className="md-spin" /> : <Save size={17} />}{saving ? "Saving…" : "Save changes"}</button></div>
        </fieldset></form>}
        <footer className="md-admin-footer"><span>Meew Decor · Made with care</span><Link href="/"><ArrowLeft size={14} />Back to the store</Link></footer>
      </>}
    </div>
  </main>;
}

function OrderCard({ order, onUpdate }: { order: Order; onUpdate: (order: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [fulfillmentDraft, setFulfillment] = useState<Fulfillment | null>(null);
  const [trackingDraft, setTracking] = useState<string | null>(null);
  const fulfillment = fulfillmentDraft ?? order.fulfillmentStatus ?? "unfulfilled";
  const tracking = trackingDraft ?? order.tracking ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const canFulfill = order.status === "paid" && order.paymentMode === "live";
  const canReconcile = ["creating", "pending", "verifying", "review"].includes(order.status);

  async function saveOrder(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSaved(false);
    try {
      const result = await api<{ order?: Order }>(`/api/admin/orders/${encodeURIComponent(order.id)}`, { method: "PATCH", body: JSON.stringify({ fulfillmentStatus: fulfillment, tracking }) });
      onUpdate(result.order ? { ...order, ...result.order } : { ...order, fulfillmentStatus: fulfillment, tracking });
      setFulfillment(null); setTracking(null); setSaved(true);
    } catch (cause) { setError((cause as PageError).message || "Order could not be updated."); }
    finally { setSaving(false); }
  }

  async function reconcile() {
    setReconciling(true); setError(""); setSaved(false);
    try {
      const result = await api<{ order: Order }>(`/api/admin/orders/${encodeURIComponent(order.id)}/reconcile`, { method: "POST", body: "{}" });
      if (result.order) onUpdate({ ...order, ...result.order });
    } catch (cause) { setError((cause as PageError).message || "Payment could not be checked. Try again shortly."); }
    finally { setReconciling(false); }
  }

  return <article className="md-admin-order-card"><button className="md-admin-order-summary" aria-expanded={open} aria-controls={`order-details-${order.id}`} onClick={() => setOpen(!open)}><span><strong>{order.customer.name}</strong><small>{date(order.createdAt)}{order.paymentMode === "sandbox" ? " · Test order" : ""}</small></span><span className="md-admin-order-id">#{order.id}</span><span className={`md-admin-badge ${order.status === "paid" ? "md-admin-badge-green" : "md-admin-badge-neutral"}`}>{readable(order.status)}</span><strong className="md-admin-order-total">{money(order.total)}</strong><ChevronDown size={18} className={open ? "md-admin-chevron-open" : ""} /></button>
    {open && <div className="md-admin-order-details" id={`order-details-${order.id}`}><div className="md-admin-order-detail-grid"><div><h3>Deliver to</h3><p><strong>{order.customer.name}</strong><br />{order.customer.address}<br />{order.customer.city} · {order.customer.zone === "dhaka" ? "Inside Dhaka" : order.customer.zone === "outsideDhaka" ? "Outside Dhaka" : readable(order.customer.zone)}</p><p><a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>{order.customer.email && <><br /><a href={`mailto:${order.customer.email}`}>{order.customer.email}</a></>}</p></div><div><h3>Order items</h3><ul className="md-admin-order-items">{order.items.map(item => <li key={item.id}><span>{item.quantity} × {item.name}</span><strong>{money(item.unitPrice * item.quantity)}</strong></li>)}</ul><div className="md-admin-order-totals"><span>Subtotal</span><span>{money(order.subtotal)}</span><span>Delivery</span><span>{money(order.deliveryCharge)}</span><strong>Total</strong><strong>{money(order.total)}</strong></div>{order.transactionId && <p className="md-admin-transaction">bKash transaction: {order.transactionId}</p>}</div></div>
      {canReconcile && <div className="md-admin-reconcile"><div><h3>Verify payment with bKash</h3><p>Check uncertain or pending payments before asking the customer to pay again.</p></div><button className="md-admin-button md-admin-button-secondary" type="button" disabled={reconciling} onClick={() => void reconcile()}><RefreshCw size={15} className={reconciling ? "md-spin" : ""} />{reconciling ? "Checking payment…" : "Check payment"}</button></div>}
      <form className="md-admin-fulfillment" onSubmit={saveOrder}><h3>Fulfillment</h3>{!canFulfill && <p className="md-admin-footnote">{order.paymentMode === "sandbox" ? "This is a test order. No real payment was collected and fulfillment is unavailable." : "Fulfillment is available after a verified, successful live payment."}</p>}<div className="md-admin-fulfillment-fields"><label className="md-admin-field"><span>Order progress</span><select disabled={!canFulfill} value={fulfillment} onChange={event => { setFulfillment(event.target.value as Fulfillment); setSaved(false); }}><option value="unfulfilled">Unfulfilled</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option></select></label><label className="md-admin-field"><span>Courier / tracking details</span><input disabled={!canFulfill} type="text" value={tracking} maxLength={300} placeholder="Courier name and tracking number" onChange={event => { setTracking(event.target.value); setSaved(false); }} /></label><button className="md-admin-button" disabled={saving || !canFulfill} type="submit">{saving ? <Loader2 size={16} className="md-spin" /> : <Check size={16} />}{saving ? "Updating…" : "Update order"}</button></div>{error && <p className="md-admin-error-text" role="alert">{error}</p>}{saved && <p className="md-admin-success-text" role="status">Order updated.</p>}</form>
    </div>}
  </article>;
}

function matchesFilter(order: Order, filter: string) {
  if (filter === "all") return true;
  if (filter === "unfulfilled") return order.status === "paid" && order.paymentMode === "live" && order.fulfillmentStatus !== "delivered";
  if (filter === "delivered") return order.fulfillmentStatus === "delivered";
  if (filter === "pending") return ["creating", "pending", "verifying", "review"].includes(order.status);
  return order.status === filter;
}
