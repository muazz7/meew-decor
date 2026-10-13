import { type OrderRow, serializeOrder } from "@/lib/server/orders";
import { database, errorResponse, json, requireAdmin } from "@/lib/server/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const cursor = new URL(request.url).searchParams.get("before") || "9999";
    const result = await database().prepare("SELECT * FROM orders WHERE created_at < ? ORDER BY created_at DESC LIMIT 51").bind(cursor).all<OrderRow>();
    const rows = result.results.slice(0, 50);
    return json({ orders: await Promise.all(rows.map((row) => serializeOrder(row, true))), nextCursor: result.results.length > 50 ? rows.at(-1)?.created_at : null });
  } catch (error) { return errorResponse(error); }
}
