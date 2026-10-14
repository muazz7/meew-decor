import { env as cloudflareEnv } from "cloudflare:workers";
import type { PlatformEnvironment, StoreDatabase } from "./database";

export const authProvider: "password" | "chatgpt" = "chatgpt";
// D1 has a larger API; commerce uses only the compatible minimal SQL surface.
export const env = cloudflareEnv as unknown as PlatformEnvironment;
export function getDatabase(): StoreDatabase | undefined { return env.DB; }
