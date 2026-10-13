import { getOrder, handleCallback } from "@/lib/server/orders";
import { errorResponse } from "@/lib/server/runtime";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("order") || "";
    const state = url.searchParams.get("state") || "";
    const paymentId = url.searchParams.get("paymentID") || "";
    if (!/^MD-[A-F0-9]{20}$/.test(id) || !/^[a-f0-9]{64}$/.test(state) || paymentId.length > 150) throw new StoreError("Invalid payment callback.", 400);
    const order = await getOrder(id);
    if (!order) throw new StoreError("Order not found.", 404);
    const updated = await handleCallback(order, paymentId, state, url.searchParams.get("status") || "");
    const destination = new URL("/order-status", url.origin);
    destination.searchParams.set("order", updated.id); destination.searchParams.set("token", updated.access_token);
    return new Response(null, { status: 303, headers: { location: destination.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (error) { return errorResponse(error); }
}
