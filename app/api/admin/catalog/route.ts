import { readConfig, saveConfig } from "@/lib/server/config";
import { body, errorResponse, json, requireAdmin, sameOrigin } from "@/lib/server/runtime";
export const dynamic = "force-dynamic";
export async function GET() { try { await requireAdmin(); return json(await readConfig()); } catch (error) { return errorResponse(error); } }
export async function PUT(request: Request) { try { sameOrigin(request); await requireAdmin(); return json(await saveConfig(await body(request))); } catch (error) { return errorResponse(error); } }
