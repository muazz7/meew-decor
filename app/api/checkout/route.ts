import { createOrder } from "@/lib/server/orders";
import { body, errorResponse, json, rateLimit, sameOrigin } from "@/lib/server/runtime";
import { parseCheckout } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { sameOrigin(request); const input = parseCheckout(await body(request)); await rateLimit(request, "checkout", 12); return json(await createOrder(input), 201); }
  catch (error) { return errorResponse(error); }
}
