import "server-only";

import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

/*
 * Reads from Supabase Auth's OAuth server AS the signed-in person, for Server Components
 * (the consent page and the Connected apps section of the profile).
 *
 * supabase-js has these as `auth.oauth.getAuthorizationDetails()` and `auth.oauth.listGrants()`,
 * but they read the session from a session store and may refresh it, which a Server
 * Component must never do (it cannot write the rotated cookies; see lib/auth.ts). So these
 * two reads call the same Auth endpoints the SDK calls, with the access token lib/auth.ts
 * has already verified. The WRITES (approve, deny, revoke) run in a route handler and a
 * Server Action through the SDK's own methods on the cookie-writing client.
 *
 * Only the publishable key and the person's own token are sent. Nothing here is logged.
 */

export type OAuthClientInfo = { id: string; name: string; uri: string; logo_uri: string };

export type AuthorizationDetails =
  | { kind: "consent"; authorizationId: string; redirectUri: string; client: OAuthClientInfo; userId: string; scope: string }
  | { kind: "already"; redirectUrl: string }
  | { kind: "gone" }
  | { kind: "error" };

export type OAuthGrantInfo = { client: OAuthClientInfo; scopes: string[]; grantedAt: string };

async function authGet(path: string, accessToken: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${supabaseUrl()}/auth/v1${path}`, {
    method: "GET",
    headers: { apikey: supabasePublishableKey(), Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function clientFrom(v: unknown): OAuthClientInfo {
  const c = (v ?? {}) as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === "string" ? x : "");
  return { id: s(c.id ?? c.client_id), name: s(c.name ?? c.client_name), uri: s(c.uri ?? c.client_uri), logo_uri: s(c.logo_uri) };
}

export async function getAuthorizationDetails(accessToken: string, authorizationId: string): Promise<AuthorizationDetails> {
  let r: { status: number; body: unknown };
  try {
    r = await authGet(`/oauth/authorizations/${encodeURIComponent(authorizationId)}`, accessToken);
  } catch {
    console.error("[hq oauth] authorization details request failed");
    return { kind: "error" };
  }
  if (r.status === 404 || r.status === 400 || r.status === 410) return { kind: "gone" };
  if (r.status !== 200 || !r.body || typeof r.body !== "object") {
    console.error("[hq oauth] authorization details:", r.status);
    return { kind: "error" };
  }
  const b = r.body as Record<string, unknown>;
  if (typeof b.authorization_id === "string") {
    const user = (b.user ?? {}) as Record<string, unknown>;
    return {
      kind: "consent",
      authorizationId: b.authorization_id,
      redirectUri: typeof b.redirect_uri === "string" ? b.redirect_uri : "",
      client: clientFrom(b.client),
      userId: typeof user.id === "string" ? user.id : "",
      scope: typeof b.scope === "string" ? b.scope : "",
    };
  }
  if (typeof b.redirect_url === "string") return { kind: "already", redirectUrl: b.redirect_url };
  return { kind: "error" };
}

/** This person's connected apps, or null when Auth could not be asked. */
export async function listGrants(accessToken: string): Promise<OAuthGrantInfo[] | null> {
  try {
    const r = await authGet("/user/oauth/grants", accessToken);
    if (r.status !== 200 || !Array.isArray(r.body)) {
      console.error("[hq oauth] list grants:", r.status);
      return null;
    }
    return (r.body as Record<string, unknown>[]).map((g) => ({
      client: clientFrom(g.client),
      scopes: Array.isArray(g.scopes) ? (g.scopes as unknown[]).filter((x): x is string => typeof x === "string") : [],
      grantedAt: typeof g.granted_at === "string" ? g.granted_at : "",
    }));
  } catch {
    console.error("[hq oauth] list grants request failed");
    return null;
  }
}
