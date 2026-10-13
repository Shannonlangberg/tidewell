import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";
import { createRemoteJWKSet, decodeProtectedHeader, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import { authCookieName, supabaseUrl } from "@/lib/supabase/env";
import { createReadClient } from "@/lib/supabase/server";
import { ROLES, ROLE_COOKIE, isAppRole, type AppRole } from "@/lib/roles";

/*
 * Session reading for Server Components, layouts and data loaders.
 *
 * A Server Component must never trigger a token refresh: it cannot write the
 * rotated cookies, the browser keeps the old refresh token, and the next refresh
 * fails with `refresh_token_already_used`, signing the person out (design 1.1,
 * section 8). So this file never calls getSession()/getUser()/getClaims().
 * It reads the `sb-*-auth-token` cookie that @supabase/ssr wrote, verifies the
 * access token locally with jose, and treats a missing, invalid or expiring
 * token as "needs refresh": redirect to /api/session, whose cookie-writing
 * client refreshes and comes back.
 *
 * Claims route the UI only. Every requireRole() also reads `memberships` live
 * through the read client (RLS as the person), so a revoked membership loses
 * data on the next request.
 */

export type MembershipStatus = "invited" | "active" | "read_only" | "ended";

export type Membership = {
  id: string;
  role: AppRole;
  status: MembershipStatus;
  crew_kind: "cleaner" | "tradie" | null;
  owner_account_id: string | null;
  property_id: string | null;
  is_primary_contact: boolean;
};

export type Claims = {
  sub: string;
  email: string | null;
  aal: "aal1" | "aal2";
  sessionId: string | null;
  exp: number;
  /** From the token hook. `null` while the hook is not installed (claims absent). */
  appRoles: AppRole[] | null;
  isManager: boolean;
  crewKind: "cleaner" | "tradie" | null;
  ownerAccountIds: string[];
};

export type Session = { accessToken: string; claims: Claims };

export type Authorised = { session: Session; role: AppRole; memberships: Membership[] };

/** Which membership statuses may read as each role (design 3.1: owners may be read_only). */
const READ_STATUSES: Record<AppRole, MembershipStatus[]> = {
  owner: ["active", "read_only"],
  crew: ["active"],
  manager: ["active"],
};

/** auth-js refreshes inside 90 s of expiry; stay well clear so a read never triggers one. */
const REFRESH_MARGIN_S = 120;

// ---------- token verification ----------

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function remoteJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`));
  return jwks;
}

type Verified = { kind: "ok"; payload: JWTPayload } | { kind: "expired" } | { kind: "invalid" };

async function verifyAccessToken(token: string): Promise<Verified> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { kind: "invalid" };
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    let payload: JWTPayload;
    if (alg === "HS256") {
      // Local stack fallback only: the hosted project must sign with asymmetric keys
      // (enabled under Authentication > JWT keys), so a shared-secret token is refused
      // in production rather than verified with a secret that should not exist there.
      const secret = process.env.SUPABASE_JWT_SECRET;
      if (!secret || process.env.NODE_ENV === "production") return { kind: "invalid" };
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"], clockTolerance: 5 }));
    } else {
      ({ payload } = await jwtVerify(token, remoteJwks(), { algorithms: ["ES256", "RS256"], clockTolerance: 5 }));
    }
    if (typeof payload.exp !== "number" || payload.exp - now < REFRESH_MARGIN_S) return { kind: "expired" };
    if (typeof payload.sub !== "string") return { kind: "invalid" };
    return { kind: "ok", payload };
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) return { kind: "expired" };
    return { kind: "invalid" };
  }
}

function toClaims(p: JWTPayload): Claims {
  const roles = Array.isArray(p.app_roles) ? (p.app_roles as unknown[]).filter(isAppRole) : null;
  const crewKind = p.crew_kind === "cleaner" || p.crew_kind === "tradie" ? p.crew_kind : null;
  const accounts = Array.isArray(p.owner_account_ids) ? (p.owner_account_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    sub: p.sub as string,
    email: typeof p.email === "string" ? p.email : null,
    aal: p.aal === "aal2" ? "aal2" : "aal1",
    sessionId: typeof p.session_id === "string" ? p.session_id : null,
    exp: p.exp as number,
    appRoles: roles,
    isManager: p.is_manager === true,
    crewKind,
    ownerAccountIds: accounts,
  };
}

// ---------- cookie reading ----------

/** The access token from the (possibly chunked, base64url-encoded) @supabase/ssr cookie. */
async function accessTokenFromCookies(): Promise<string | null> {
  const store = await cookies();
  const name = authCookieName();
  const raw = await combineChunks(name, (chunk) => store.get(chunk)?.value ?? null);
  if (!raw) return null;
  try {
    const json = raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw;
    const parsed: unknown = JSON.parse(json);
    const token = (parsed as { access_token?: unknown } | null)?.access_token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

type SessionState = { kind: "none" } | { kind: "stale" } | { kind: "ok"; session: Session };

/** One verification per request, shared by the layout guard, the loaders and the page. */
const sessionState = cache(async (): Promise<SessionState> => {
  const token = await accessTokenFromCookies();
  if (!token) return { kind: "none" };
  const result = await verifyAccessToken(token);
  if (result.kind === "ok") return { kind: "ok", session: { accessToken: token, claims: toClaims(result.payload) } };
  // Expired tokens refresh at /api/session; an invalid one is cleared there too.
  return { kind: "stale" };
});

// ---------- public API ----------

/** The verified session, or null. Never redirects; for pages that have a signed-out state (sign-in). */
export async function currentSession(): Promise<Session | null> {
  const s = await sessionState();
  return s.kind === "ok" ? s.session : null;
}

/**
 * The verified session, or a redirect to /api/session (which refreshes and
 * returns to `next`, or sends a signed-out person to /app).
 */
export async function readSession(next: string = "/app/route"): Promise<Session> {
  const s = await sessionState();
  if (s.kind === "ok") return s.session;
  redirect(`/api/session?next=${encodeURIComponent(next)}`);
}

/** Live memberships for this session, as the database sees them (RLS as the person). */
const liveMemberships = cache(async (session: Session): Promise<Membership[]> => {
  const db = createReadClient(session.accessToken);
  const { data, error } = await db
    .from("memberships")
    .select("id, role, status, crew_kind, owner_account_id, property_id, is_primary_contact")
    .eq("user_id", session.claims.sub)
    .in("status", ["active", "read_only"]);
  if (error) {
    // No table yet, or a policy refused: either way the person has no role here.
    console.error("[auth] memberships query failed:", error.message);
    return [];
  }
  return (data as Membership[]).filter((m) => isAppRole(m.role));
});

function rolesFrom(session: Session, memberships: Membership[]): AppRole[] {
  const fromDb = ROLES.filter((role) => memberships.some((m) => m.role === role && READ_STATUSES[role].includes(m.status)));
  // The hook's claim only narrows: the database is the truth.
  const claimed = session.claims.appRoles;
  return claimed ? fromDb.filter((r) => claimed.includes(r)) : fromDb;
}

/** Roles the signed-in person may use right now ([] when signed out). Does not check MFA. */
export async function currentRoles(): Promise<AppRole[]> {
  const session = await currentSession();
  if (!session) return [];
  return rolesFrom(session, await liveMemberships(session));
}

/**
 * The guard every role layout, every loader in lib/data and every Server Action
 * starts with. Verified claims plus a live memberships query; a manager must also
 * hold an aal2 session (TOTP verified) or is sent to /app/mfa. Anything else
 * redirects to /app. Cached per request and per role.
 */
export const requireRole = cache(async (role: AppRole): Promise<Authorised> => {
  const session = await readSession(`/app/${role}`);
  if (session.claims.appRoles && !session.claims.appRoles.includes(role)) redirect("/app");
  const memberships = (await liveMemberships(session)).filter((m) => m.role === role && READ_STATUSES[role].includes(m.status));
  if (memberships.length === 0) redirect("/app");
  if (role === "manager" && session.claims.aal !== "aal2") redirect("/app/mfa");
  return { session, role, memberships };
});

/**
 * For screens shared by several roles (/app/more): the chosen role if the person
 * holds it, else the first of `roles` they hold. Redirects to /app when none.
 */
export async function requireAnyRole(roles: readonly AppRole[] = ROLES): Promise<Authorised> {
  const available = await currentRoles();
  const chosen = await chosenRole();
  const pick = (chosen && roles.includes(chosen) && available.includes(chosen) ? chosen : null) ?? roles.find((r) => available.includes(r));
  if (!pick) {
    // Signed out (or expired) goes through the refresh path; signed in with no role goes to /app.
    const s = await sessionState();
    redirect(s.kind === "ok" ? "/app" : `/api/session?next=${encodeURIComponent("/app/route")}`);
  }
  return requireRole(pick);
}

/** The role picked on /app/choose, if any. A preference only. */
export async function chosenRole(): Promise<AppRole | null> {
  const value = (await cookies()).get(ROLE_COOKIE)?.value;
  return isAppRole(value) ? value : null;
}
