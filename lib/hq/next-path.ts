/*
 * Where to send a person after they sign in: the `?next=` they arrived with, but ONLY
 * if it is a path inside HQ. Anything else (another origin, a protocol-relative URL,
 * a path outside /hq, the sign-in screens themselves) becomes the fallback, so a
 * crafted link can never bounce a signed-in person to somewhere else.
 *
 * Pure and dependency-free (no project imports), so `node --test` can run it.
 */

const BASE = "/hq";
/** Landing here after signing in would loop, so they are never a destination. */
const AUTH_PAGES = ["/hq/sign-in", "/hq/verify", "/hq/mfa"] as const;
const ORIGIN = "http://hq.invalid";

export function safeNextPath(value: unknown, fallback: string = BASE): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (v.length === 0 || v.length > 500) return fallback;

  // Control characters, and backslashes (browsers read "/\evil.com" as "//evil.com").
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback;

  // One leading slash only, and it must be /hq itself or something below it.
  if (!v.startsWith("/") || v.startsWith("//")) return fallback;
  if (v !== BASE && !/^\/hq[/?#]/.test(v)) return fallback;

  let url: URL;
  try {
    url = new URL(v, ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== ORIGIN) return fallback;

  // Dot segments are resolved by the URL parser ("/hq/../app" becomes "/app"), so check again.
  const path = url.pathname;
  if (path !== BASE && !path.startsWith(`${BASE}/`)) return fallback;
  if (AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;

  // The fragment never reaches the server and is dropped.
  return `${path}${url.search}`;
}
