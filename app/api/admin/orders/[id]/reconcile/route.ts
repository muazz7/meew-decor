import { getOrder, reconcileOrder, serializeOrder } from "@/lib/server/orders";
import { errorResponse, json, requireAdmin, sameOrigin } from "@/lib/server/runtime";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { sameOrigin(request); await requireAdmin(); const { id } = await context.params; const order = await getOrder(id); if (!order) throw new StoreError("Order not found.", 404); return json({ order: await serializeOrder(await reconcileOrder(order), true) }); }
  catch (error) { return errorResponse(error); }
}
