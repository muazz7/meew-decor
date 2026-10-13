import { getOrder, serializeOrder } from "@/lib/server/orders";
import { body, database, errorResponse, json, requireAdmin, sameOrigin } from "@/lib/server/runtime";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    sameOrigin(request); await requireAdmin();
    const { id } = await context.params, order = await getOrder(id);
    if (!order) throw new StoreError("Order not found.", 404);
    if (order.status !== "paid" || order.payment_mode !== "live") throw new StoreError("Only verified live payments can be fulfilled.", 409);
    const input = await body(request) as { fulfillmentStatus?: unknown; tracking?: unknown };
    if (!input || typeof input.fulfillmentStatus !== "string" || !["unfulfilled", "processing", "shipped", "delivered"].includes(input.fulfillmentStatus)) throw new StoreError("Choose a valid fulfillment status.");
    if (input.tracking !== undefined && (typeof input.tracking !== "string" || input.tracking.length > 300)) throw new StoreError("Tracking details must be at most 300 characters.");
    await database().prepare("UPDATE orders SET fulfillment_status=?,tracking=?,updated_at=? WHERE id=? AND status='paid' AND payment_mode='live'").bind(input.fulfillmentStatus, typeof input.tracking === "string" ? input.tracking.trim() : order.tracking, new Date().toISOString(), id).run();
    return json({ order: await serializeOrder((await getOrder(id))!, true) });
  } catch (error) { return errorResponse(error); }
}
