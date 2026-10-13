import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Secret-key client. Bypasses RLS, so it is the ONLY file allowed to read
 * SUPABASE_SECRET_KEY, and only the routes named in docs/backend-design.md
 * section 6 may import it (eslint.config.mjs enforces the boundary with
 * `no-restricted-imports`). Every caller must authorise first through the
 * cookie client so RLS decides, and then use this client only for the step
 * that genuinely needs it (admin user creation, URL signing by row id, the
 * stay page, the calendar feed, the enquiry insert, PDF rendering).
 */
export function createSecretClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
