import "server-only";

import { cache } from "react";
import { requireRole, type Authorised } from "@/lib/auth";
import { createReadClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/roles";

/*
 * Data loaders for Server Components. The pattern every loader follows:
 *
 *   1. `await requireRole(role)` first: verified claims, live memberships,
 *      MFA for managers. The layout guard only protects the shell (layouts do
 *      not re-render on client-side navigation), so the loader is the real
 *      gate; a revoked membership loses data on the next request.
 *   2. Query through `createReadClient(session.accessToken)`: RLS runs as the
 *      person, and this client can never refresh (so never loses a cookie).
 *   3. Return plain data; pages render it. Writes are Server Actions in
 *      `app/app/** /actions.ts`, each starting the same way.
 *
 * Phase 0 ships one real loader to prove the shape. Later phases add one loader
 * per screen here (`ownerDashboard`, `crewJobs`, `managerToday`, ...), replacing
 * the demo data the screens still render.
 */

export type Profile = {
  id: string;
  full_name: string;
  first_name: string;
  initials: string;
  timezone: string | null;
};

/** The signed-in person's own profile row (select: own row or manager). Null if absent. */
export const loadProfile = cache(async (role: AppRole): Promise<{ auth: Authorised; profile: Profile | null }> => {
  const auth = await requireRole(role);
  const db = createReadClient(auth.session.accessToken);
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, first_name, initials, timezone")
    .eq("id", auth.session.claims.sub)
    .maybeSingle();
  if (error) {
    console.error("[data] profile query failed:", error.message);
    return { auth, profile: null };
  }
  return { auth, profile: (data as Profile | null) ?? null };
});
