import "server-only";

import { hqClient } from "@/lib/hq/db";
import { isOneOf, STAFF_ROLES } from "@/lib/hq/constants";
import { DEFAULT_TIMEZONE } from "@/lib/hq/format";
import type { McpPrincipal } from "./auth";
import type { ToolContext } from "./types";

/*
 * Who is calling /mcp, as the DATABASE sees them.
 *
 * The verified token is handed to a Supabase client (publishable key + that token, no
 * session store, no secret key), so every query and RPC a tool makes runs as the person
 * under row level security. `hq.my_access()` then says whether they are active staff,
 * whether their session satisfies multi-factor sign-in, and which capabilities they hold.
 *
 * Refused (no tools at all): not staff, deactivated, a session that still owes the second
 * step while the organisation requires it, or no `ai.use` (read_only has none).
 */

type MyAccess = {
  staff_id: string;
  full_name: string;
  role: string;
  timezone: string | null;
  mfa_required: boolean;
  aal: string;
  capabilities: string[] | null;
} | null;

export type McpAccess =
  | { ok: true; ctx: ToolContext }
  | { ok: false; reason: "not_staff" | "mfa_required" | "no_ai_use" | "error" };

export async function resolveAccess(principal: McpPrincipal, baseUrl: string): Promise<McpAccess> {
  const db = hqClient(principal.accessToken);
  const { data, error } = await db.rpc("my_access");
  if (error) {
    console.error("[hq mcp] my_access failed:", error.code ?? "unknown");
    return { ok: false, reason: "error" };
  }
  const access = data as MyAccess;
  if (!access || !access.staff_id || !isOneOf(STAFF_ROLES, access.role)) return { ok: false, reason: "not_staff" };
  if (access.mfa_required && access.aal !== "aal2") return { ok: false, reason: "mfa_required" };
  const capabilities = access.capabilities ?? [];
  if (!capabilities.includes("ai.use")) return { ok: false, reason: "no_ai_use" };

  return {
    ok: true,
    ctx: {
      db,
      staff: {
        id: access.staff_id,
        fullName: access.full_name,
        role: access.role,
        capabilities,
        timezone: access.timezone || DEFAULT_TIMEZONE,
      },
      clientId: principal.clientId,
      baseUrl: baseUrl.replace(/\/+$/, ""),
    },
  };
}
