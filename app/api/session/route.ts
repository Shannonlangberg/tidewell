import { NextResponse, type NextRequest } from "next/server";
import { createCookieClient } from "@/lib/supabase/server";
import { ROLE_COOKIE } from "@/lib/roles";
import { cookies } from "next/headers";

/**
 * The one place a session is refreshed (design 1.1, section 8). Server
 * Components verify the access token locally and, when it is expiring or gone,
 * send the browser here with `?next=`; the SessionKeeper calls it with no `next`.
 *
 * `getUser()` through the cookie-writing client loads the session, refreshes it
 * if auth-js thinks it should, writes the rotated cookies, and checks the user
 * with the Auth server. Then: redirect back to `next` (same-origin paths only,
 * default /app) or answer 204. No session: clear the cookies, then redirect to
 * /app or answer 401.
 */
export async function GET(request: NextRequest) {
  const supabase = await createCookieClient();
  const { data, error } = await supabase.auth.getUser();
  const signedIn = !error && !!data.user;

  if (!signedIn) {
    try {
      // Removes a stale or corrupt sb-* cookie so the browser stops presenting it.
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      /* nothing to clear */
    }
    (await cookies()).set(ROLE_COOKIE, "", { path: "/app", maxAge: 0 });
  }

  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const headers = { "Cache-Control": "private, no-store" };

  if (next !== null) {
    return NextResponse.redirect(new URL(signedIn ? next : "/app", request.url), { status: 303, headers });
  }
  return new NextResponse(null, { status: signedIn ? 204 : 401, headers });
}

/** Only a same-origin path: starts with a single "/", no scheme, no protocol-relative "//". */
function safeNext(value: string | null): string | null {
  if (value === null) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/app";
  return value;
}
