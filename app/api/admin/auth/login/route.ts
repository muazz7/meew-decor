import { authProvider, body, env, errorResponse, json, rateLimit, sameOrigin } from "@/lib/server/runtime";
import { createOwnerSession, ownerAuthIssues, ownerSessionCookie, verifyOwnerCredentials } from "@/lib/server/owner-auth";
import { StoreError } from "@/lib/server/validation";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (authProvider !== "password") throw new StoreError("Use the hosted sign-in option for this store.", 404);
    if (ownerAuthIssues(env).length) throw new StoreError("Owner sign-in is not configured. Complete the owner setup in the hosting environment.", 503);
    await rateLimit(request, "owner-login", 10);
    // The shared owner account also has an independent limit, so rotating client
    // addresses or spoofing headers cannot allow unlimited credential attempts.
    await rateLimit(request, "owner-login-account", 30, "global");
    const value = await body(request);
    if (!value || typeof value !== "object") throw new StoreError("Email or password is incorrect.", 401);
    const input = value as Record<string, unknown>;
    if (typeof input.email !== "string" || typeof input.password !== "string" || !await verifyOwnerCredentials(input.email, input.password, env)) throw new StoreError("Email or password is incorrect.", 401);
    const response = json({ authenticated: true });
    response.headers.set("set-cookie", ownerSessionCookie(await createOwnerSession(env)));
    return response;
  } catch (error) { return errorResponse(error); }
}
