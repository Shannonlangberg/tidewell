/*
 * Shared helpers for the local HQ scripts. LOCAL DEVELOPMENT ONLY: every script that
 * imports this refuses to run against anything but the local Supabase stack.
 */
import { createClient } from "@supabase/supabase-js";

export const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const secret = process.env.SUPABASE_SECRET_KEY;

export function requireLocal(): void {
  if (!url || !publishable || !secret) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or SUPABASE_SECRET_KEY. Run with: node --env-file=.env.local <script>");
    process.exit(1);
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    console.error(`Refusing to run against ${host}. These scripts are for the local stack only.`);
    process.exit(1);
  }
}

export function adminClient() {
  return createClient(url!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Session = { access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string; user: unknown };

/**
 * A real session for an existing user without any email: ask the Auth admin API for a
 * one-time token and redeem it. The result is an ordinary Supabase session, so row level
 * security sees exactly what it would after a sign-in code.
 */
export async function sessionFor(email: string): Promise<Session> {
  const admin = adminClient();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) throw new Error(`generateLink failed for ${email}: ${link.error?.message ?? "no token"}`);
  const anon = createClient(url!, publishable!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (error || !data.session) throw new Error(`verifyOtp failed for ${email}: ${error?.message ?? "no session"}`);
  return data.session as unknown as Session;
}

/** A client that acts as the person holding `accessToken`, pointed at the hq schema. */
export function asUser(accessToken: string) {
  return createClient(url!, publishable!, {
    accessToken: async () => accessToken,
    db: { schema: "hq" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function findUserId(email: string): Promise<string | null> {
  const admin = adminClient().auth.admin;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
