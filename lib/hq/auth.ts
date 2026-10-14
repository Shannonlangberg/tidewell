import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession, type Session } from "@/lib/auth";
import { hqClient, type HqClient } from "./db";
import { HQ_BASE, isOneOf, STAFF_ROLES, type Capability, type StaffRole } from "./constants";
import { DEFAULT_TIMEZONE } from "./format";

/*
 * The guard every HQ layout, page loader and Server Action starts with.
 *
 * Authentication: lib/auth.ts verifies the access token locally and sends anything
 * stale through /api/session (which refreshes and returns), so this file never
 * refreshes a session itself.
 *
 * Authorisation: hq.my_access() asks the DATABASE who this person is. It works at
 * aal1 so we can tell "must complete MFA" from "no HQ access". The capabilities it
 * returns only drive what the interface offers; every query is still checked by
 * row level security, so a missing check here can hide data wrongly but cannot
 * expose it.
 */

export type Staff = {
  id: string;
  fullName: string;
  firstName: string;
  role: StaffRole;
  timezone: string;
  capabilities: readonly Capability[];
  mfaRequired: boolean;
  aal: "aal1" | "aal2";
};

export type StaffContext = {
  staff: Staff;
  session: Session;
  db: HqClient;
  /** True when the database granted this capability to the signed-in person. */
  can: (capability: Capability) => boolean;
};

type MyAccess = {
  staff_id: string;
  full_name: string;
  first_name: string;
  role: string;
  timezone: string | null;
  mfa_required: boolean;
  aal: string;
  capabilities: string[] | null;
} | null;

const loadAccess = cache(async (token: string) => {
  const { data, error } = await hqClient(token).rpc("my_access");
  if (error) {
    console.error("[hq] my_access failed:", error.message);
    return null;
  }
  return data as MyAccess;
});

/** Where a person who cannot use HQ is sent, with a reason the sign-in page can explain. */
function noAccess(reason: "no-access" | "inactive" = "no-access"): never {
  redirect(`${HQ_BASE}/sign-in?error=${reason}`);
}

export type RequireStaffOptions = {
  /** Redirect to /hq/no-access-style sign-in unless the person holds this. */
  capability?: Capability;
  /**
   * Let a person who still owes an MFA step through, with no capabilities. Only the
   * MFA screen itself should set this.
   */
  allowMfaPending?: boolean;
  /** Where to come back to after a token refresh. */
  next?: string;
};

export const requireStaff = cache(async (capability?: Capability, allowMfaPending = false, next: string = HQ_BASE): Promise<StaffContext> => {
  const session = await readSession(next);
  const access = await loadAccess(session.accessToken);

  if (!access || !isOneOf(STAFF_ROLES, access.role)) noAccess("no-access");

  const aal = access.aal === "aal2" ? "aal2" : "aal1";
  if (access.mfa_required && aal !== "aal2") {
    if (!allowMfaPending) redirect(`${HQ_BASE}/mfa`);
  }

  const capabilities = (access.capabilities ?? []) as Capability[];
  const can = (c: Capability) => capabilities.includes(c);
  if (capability && !can(capability) && !(allowMfaPending && access.mfa_required && aal !== "aal2")) {
    // Signed in and a member of staff, but this part of HQ is not theirs.
    redirect(`${HQ_BASE}?denied=${encodeURIComponent(capability)}`);
  }

  return {
    staff: {
      id: access.staff_id,
      fullName: access.full_name,
      firstName: access.first_name,
      role: access.role as StaffRole,
      timezone: access.timezone || DEFAULT_TIMEZONE,
      capabilities,
      mfaRequired: access.mfa_required,
      aal,
    },
    session,
    db: hqClient(session.accessToken),
    can,
  };
});

/** A person who is signed in to Supabase but may not be staff. Never redirects. For the sign-in screens. */
export async function currentStaffOrNull(session: Session | null): Promise<Staff | null> {
  if (!session) return null;
  const access = await loadAccess(session.accessToken);
  if (!access || !isOneOf(STAFF_ROLES, access.role)) return null;
  return {
    id: access.staff_id,
    fullName: access.full_name,
    firstName: access.first_name,
    role: access.role as StaffRole,
    timezone: access.timezone || DEFAULT_TIMEZONE,
    capabilities: (access.capabilities ?? []) as Capability[],
    mfaRequired: access.mfa_required,
    aal: access.aal === "aal2" ? "aal2" : "aal1",
  };
}
