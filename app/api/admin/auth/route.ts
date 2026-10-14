import { authProvider, env, json, requireAdmin } from "@/lib/server/runtime";
import { ownerAuthIssues } from "@/lib/server/owner-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const issues = authProvider === "password" ? ownerAuthIssues(env) : env.STORE_ADMIN_EMAIL ? [] : ["Configure STORE_ADMIN_EMAIL with the owner's ChatGPT account email."];
  let authenticated = false;
  try { await requireAdmin(); authenticated = true; } catch { /* Anonymous requests may inspect their sign-in method. */ }
  return json({ provider: authProvider, configured: issues.length === 0, authenticated, issues });
}
