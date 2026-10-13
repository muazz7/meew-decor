import { products } from "@/lib/catalog";
import { readConfig } from "@/lib/server/config";
import { json } from "@/lib/server/runtime";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const config = await readConfig();
    return json({ checkoutEnabled: config.readiness.ready, mode: config.readiness.mode, products: config.products.map((p) => ({ id: p.id, price: p.price, stock: p.stock, available: p.enabled && p.price !== null && p.stock !== null && p.stock > 0 })), delivery: config.delivery, policies: config.policies, message: config.readiness.ready ? null : "Online checkout is being prepared. Contact Meew Decor for prices and availability." });
  } catch {
    return json({ checkoutEnabled: false, mode: "unconfigured", products: products.map((p) => ({ id: p.id, price: null, stock: null, available: false })), delivery: { dhaka: null, outsideDhaka: null }, policies: { delivery: "", returns: "" }, message: "Online checkout is being prepared. Contact Meew Decor for prices and availability." });
  }
}
