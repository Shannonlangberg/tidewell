/**
 * Public Supabase settings. Both values are safe in the browser: the publishable
 * key only ever acts as the signed-in user (RLS applies) or as `anon`.
 */
export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url;
}

export function supabasePublishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  return key;
}

/** `sb-<ref>-auth-token`, the cookie name @supabase/ssr derives from the project URL. */
export function authCookieName(): string {
  const ref = new URL(supabaseUrl()).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}
