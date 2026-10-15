"use server";

import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { createCookieClient } from "@/lib/supabase/server";

/*
 * Disconnect a connected app (ChatGPT, Claude, ...) from the signed-in person's HQ login.
 *
 * Supabase Auth's revoke marks the person's consent for that OAuth client as revoked, deletes
 * the client's sessions and invalidates its refresh tokens. An access token the app already
 * holds stays valid until it expires (at most the project's JWT expiry, one hour by default);
 * /mcp verifies tokens locally, so it cannot see a revocation before then. The profile page
 * says so.
 *
 * Only ever the signed-in person's own grants: the SDK sends their session, never an id of
 * someone else. Any member of staff may disconnect their own apps (read-only included).
 */

const PROFILE = "/hq/profile";

export async function revokeConnectedAppAction(formData: FormData): Promise<void> {
  await requireStaff(undefined, false, PROFILE);
  const clientId = formData.get("client_id");
  if (typeof clientId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(clientId)) {
    redirect(withToast(PROFILE, "That app could not be found.", "error"));
  }

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) {
    console.error("[hq oauth] revoke failed:", error.status ?? "unknown");
    redirect(withToast(PROFILE, "That app could not be disconnected. Try again in a moment.", "error"));
  }
  redirect(withToast(PROFILE, "App disconnected. It can no longer refresh its access."));
}
