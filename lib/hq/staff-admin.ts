import "server-only";

import { createSecretClient } from "@/lib/supabase/secret";

/*
 * The one place Planted HQ touches the Supabase secret key, and only for the Auth
 * admin API: creating the login for a person an administrator is inviting.
 *
 * Everything else about a staff member (their role, pod, access) lives in
 * hq.staff_profiles and is written through the hq.add_staff() RPC AS the
 * administrator, so row level security and the capability check decide it. The
 * caller of this file must already have been authorised with
 * requireStaff("people.admin"). Never expose these functions to a client.
 *
 * No password is ever set. Sign-in is by emailed six-digit code (plus TOTP), and
 * the password route is refused by a database hook.
 */

export type CreateLoginInput = {
  email: string;
  fullName: string;
  firstName: string;
};

export type CreateLoginResult =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: "invalid" | "failed" };

/**
 * Creates the Auth user, or finds the existing one for that address. `created` says
 * which, so a failed follow-up step can remove only a login this call made.
 */
export async function createStaffLogin(input: CreateLoginInput): Promise<CreateLoginResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.fullName.trim() || !input.firstName.trim()) return { ok: false, reason: "invalid" };

  const admin = createSecretClient().auth.admin;

  const created = await admin.createUser({
    email,
    // The person proves they own the address by receiving the sign-in code, so
    // there is nothing to confirm in advance.
    email_confirm: true,
    // The names are read by the database trigger that builds the shared profile row.
    user_metadata: { full_name: input.fullName.trim(), first_name: input.firstName.trim() },
  });

  if (!created.error && created.data.user) return { ok: true, userId: created.data.user.id, created: true };

  // Already registered (a person can hold a login for more than one purpose). Reuse it
  // without touching its metadata.
  const exists = created.error?.code === "email_exists" || created.error?.status === 422;
  if (exists) {
    const existing = await findUserIdByEmail(email);
    if (existing) return { ok: true, userId: existing, created: false };
  }

  console.error("[hq] createStaffLogin failed:", created.error?.code ?? created.error?.message ?? "unknown");
  return { ok: false, reason: "failed" };
}

/** Removes a login this flow just created, after a later step failed. Never call it for `created: false`. */
export async function removeStaffLogin(userId: string): Promise<void> {
  const { error } = await createSecretClient().auth.admin.deleteUser(userId);
  if (error) console.error("[hq] removeStaffLogin failed:", error.code ?? error.message);
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createSecretClient().auth.admin;
  // The admin API has no lookup by address. A staff portal has few accounts, so walk
  // the pages; stop at the first match.
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
