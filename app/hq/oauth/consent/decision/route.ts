import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { currentStaffOrNull } from "@/lib/hq/auth";
import { publicOrigin } from "@/lib/hq/mcp/auth";
import { consentPath, isAuthorizationId, safeClientRedirect } from "@/lib/hq/mcp/consent";
import { createCookieClient } from "@/lib/supabase/server";

/*
 * Approve or cancel an OAuth connection request (the consent page's form posts here).
 *
 * It trusts nothing from the page: it checks the request came from this site (Origin),
 * re-reads the session from the cookie, and for "approve" re-checks that the person is
 * active staff, has completed any second step that is owed, and holds `ai.use`. Then it
 * calls Supabase Auth through the SDK on the cookie-writing client (which may rotate the
 * session cookies, which a route handler can write) and sends the browser back to the app
 * with a 303. Supabase builds that URL from the client's registered redirect URI; it is
 * checked again (https, or http on this machine only) before it is followed.
 *
 * "Cancel" is allowed for anyone signed in, so a person who may not connect can still send
 * the app a clean "access denied".
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function seeOther(url: string | URL): NextResponse {
  return NextResponse.redirect(url, { status: 303, headers: NO_STORE });
}

export async function POST(req: Request): Promise<Response> {
  // Cross-site form posts are refused (the session cookie is SameSite=Lax as well).
  const origin = req.headers.get("origin");
  // The site's configured public origin, or the host this request was addressed to.
  const here = publicOrigin(req, undefined);
  if (!origin || (origin !== here && origin !== publicOrigin(req))) {
    return new NextResponse("Forbidden", { status: 403, headers: NO_STORE });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("Bad request", { status: 400, headers: NO_STORE });
  }
  const authorizationId = form.get("authorization_id");
  const decision = form.get("decision");
  if (!isAuthorizationId(authorizationId) || (decision !== "approve" && decision !== "deny")) {
    return new NextResponse("Bad request", { status: 400, headers: NO_STORE });
  }
  const back = new URL(consentPath(authorizationId), here);

  const session = await currentSession();
  // Stale or missing: the consent page refreshes the session or signs the person in, then comes back.
  if (!session) return seeOther(back);

  if (decision === "approve") {
    const staff = await currentStaffOrNull(session);
    const mayApprove = !!staff && !(staff.mfaRequired && staff.aal !== "aal2") && staff.capabilities.includes("ai.use");
    // The consent page explains why; it never shows Approve to someone who may not.
    if (!mayApprove) return seeOther(back);
  }

  const supabase = await createCookieClient();
  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

  if (result.error || !result.data) {
    console.error("[hq oauth] consent decision failed:", result.error?.status ?? "no data");
    back.searchParams.set("failed", "1");
    return seeOther(back);
  }
  const to = safeClientRedirect(result.data.redirect_url);
  if (!to) {
    console.error("[hq oauth] refused to follow a redirect that is not https or loopback http");
    return new NextResponse("The app's return address is not allowed.", { status: 400, headers: NO_STORE });
  }
  return seeOther(to);
}
