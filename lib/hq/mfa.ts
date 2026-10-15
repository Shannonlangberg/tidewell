import "server-only";

import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/*
 * The signed-in person's authenticator-app (TOTP) factors, read straight from the Auth
 * API with the access token lib/auth.ts already verified. A plain read with no session
 * store: a Server Component must never use the cookie-writing client for this, because
 * if that client refreshed the token the rotated cookie would be lost and the next
 * refresh would sign the person out.
 */

export type TotpFactor = {
  id: string;
  status: "verified" | "unverified";
};

type RawFactor = { id?: unknown; factor_type?: unknown; status?: unknown };

export async function listTotpFactors(accessToken: string): Promise<TotpFactor[]> {
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey(), Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const user = (await res.json()) as { factors?: RawFactor[] };
    const out: TotpFactor[] = [];
    for (const f of user.factors ?? []) {
      if (f.factor_type !== "totp" || typeof f.id !== "string") continue;
      if (f.status !== "verified" && f.status !== "unverified") continue;
      out.push({ id: f.id, status: f.status });
    }
    return out;
  } catch (e) {
    console.error("[hq] listTotpFactors failed:", e instanceof Error ? e.name : "error");
    return [];
  }
}
