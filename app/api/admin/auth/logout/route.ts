import { authProvider, errorResponse, json, sameOrigin } from "@/lib/server/runtime";
import { ownerSessionCookie } from "@/lib/server/owner-auth";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (authProvider !== "password") throw new StoreError("Use the hosted sign-out option for this store.", 404);
    const response = json({ authenticated: false });
    response.headers.set("set-cookie", ownerSessionCookie("", true));
    return response;
  } catch (error) { return errorResponse(error); }
}
