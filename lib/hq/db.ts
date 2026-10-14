import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * A Supabase client pointed at the `hq` schema that acts AS the signed-in person.
 *
 * It sends an access token that lib/auth.ts has already verified, so Postgres row
 * level security runs against that person. It has no session store: it can never
 * refresh a token and so can never lose a rotated cookie. Use it in Server
 * Components, Server Actions and route handlers.
 *
 * Do not use the secret key for HQ data. If a query needs it, the permission model
 * is wrong. The one place HQ touches the secret key is lib/hq/staff-admin.ts, and
 * only for the Auth admin API.
 */
export function hqClient(accessToken: string) {
  return createClient(supabaseUrl(), supabasePublishableKey(), {
    accessToken: async () => accessToken,
    db: { schema: "hq" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type HqClient = ReturnType<typeof hqClient>;
