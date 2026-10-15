/*
 * Pure helpers for the OAuth consent page (/hq/oauth/consent) and its decision route.
 * No imports, so `node --test` can run consent.test.mts.
 */

/** Supabase authorization ids are opaque tokens; accept only a conservative alphabet and length. */
export function isAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where a chat app may be sent back to: https anywhere, or http only on this machine
 * (desktop clients listen on a loopback port; OAuth 2.1 and the MCP spec allow exactly
 * these). Supabase already matched the URI exactly against the client's registration; this
 * is a second check so nothing else (javascript:, data:, a custom scheme) is ever followed.
 */
export function safeClientRedirect(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  if (u.protocol === "https:") return u.toString();
  if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u.toString();
  return null;
}

/** The consent page's own address, for coming back after sign-in (a path inside /hq). */
export function consentPath(authorizationId: string): string {
  return `/hq/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/** Shown host of a redirect URI, so a person can see where they are being sent. */
export function redirectHost(uri: string): string {
  try {
    const u = new URL(uri);
    return u.host || uri;
  } catch {
    return uri;
  }
}

export type ConsentLines = { can: string[]; cannot: string[] };

/**
 * Plain-language "what this connection can and cannot do" for this person. It mirrors
 * docs/hq-mcp.md section 2 and says only what their own capabilities allow, because the
 * connection acts with exactly their HQ permissions.
 */
export function consentLines(capabilities: readonly string[]): ConsentLines {
  const has = (c: string) => capabilities.includes(c);
  const can: string[] = [];
  can.push("Act as you, with exactly your HQ permissions. Everything it does is logged under your name.");
  const reads = ["tasks"];
  if (has("growth.read")) reads.unshift("referral partner contacts, organisations, referrals and the pipeline");
  if (has("contractors.read")) reads.unshift("contractors and their vetting and expiry dates");
  const reports = ["daily", "weekly"];
  if (has("growth.read")) reports.push("growth");
  if (has("contractors.read")) reports.push("contractor");
  can.push(`Search and read ${reads.join(", ")}, and build ${reports.join(", ").replace(/, ([^,]*)$/, " and $1")} reports from HQ's figures.`);
  if (has("people.read")) can.push("See the team directory (names and roles only).");
  const writes: string[] = [];
  if (has("tasks.write")) writes.push("create and update tasks");
  if (has("growth.write")) writes.push("add a contact or organisation, update a contact, log a call, meeting, email or note, record a referral, and move an opportunity (but never to signed)");
  if (has("contractors.write")) writes.push("update a contractor's contact details, areas, rates and notes, log a contact with them, record a review, and tick vetting steps");
  if (writes.length > 0) can.push(`Make small changes, one record at a time, when you ask: ${writes.join("; ")}.`);
  else can.push("It cannot change anything: your role is read only for these areas.");

  const cannot = [
    "Delete or archive anything.",
    "Approve, prefer, suspend, reinstate or deactivate a contractor, or sign a management.",
    "Upload, download or open documents, or run imports.",
    "Change people, roles or settings.",
    "See anything you cannot see in HQ yourself.",
  ];
  return { can, cannot };
}
