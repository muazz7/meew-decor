import { customerCanRead, getOrder, serializeOrder } from "@/lib/server/orders";
import { errorResponse, json, rateLimit } from "@/lib/server/runtime";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^MD-[A-F0-9]{20}$/.test(id)) throw new StoreError("Order not found.", 404);
    await rateLimit(request, "order-status", 120);
    const order = await getOrder(id);
    if (!order || !customerCanRead(order, new URL(request.url).searchParams.get("token") || "")) throw new StoreError("Order not found or this private order link is invalid.", 404);
    return json({ order: await serializeOrder(order) });
  } catch (error) { return errorResponse(error); }
}
