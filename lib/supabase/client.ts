"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client (publishable key). Reads the session from `document.cookie`,
 * which is why the auth cookies stay readable by JavaScript (`httpOnly: false`,
 * the @supabase/ssr default): the private Realtime subscriber, the cleaner's
 * direct Storage upload and the offline queue all need it. One instance per tab.
 */
export function createBrowserSupabase() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
