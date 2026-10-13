import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Cookie-writing client for Server Actions and route handlers only.
 *
 * It reads the session from the request cookies and, when auth-js rotates the
 * tokens (verifyOtp, a refresh inside getUser(), signOut), writes the new cookies
 * back through `setAll`. Cookie options stay at the @supabase/ssr defaults
 * (`httpOnly: false`, `sameSite: 'lax'`, `path: '/'`) plus `secure` in production;
 * see docs/backend-design.md section 8 for why the browser must read these cookies.
 *
 * Never use this in a Server Component: a Server Component cannot set cookies, so
 * a refresh there is lost and the next refresh fails with
 * `refresh_token_already_used`, signing the person out. Server Components go
 * through `lib/auth.ts` (local JWT verification) and `createReadClient()`.
 */
export async function createCookieClient() {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      },
    },
  });
}

/**
 * Read client for Server Components and data loaders. It sends an access token
 * that `lib/auth.ts` has already verified, so RLS runs as that person, and it has
 * no session store: it can never refresh, and so can never lose a rotated cookie.
 * `auth.*` methods are disabled on this client by design.
 */
export function createReadClient(accessToken: string) {
  return createClient(supabaseUrl(), supabasePublishableKey(), {
    accessToken: async () => accessToken,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
