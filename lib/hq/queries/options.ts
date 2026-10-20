import "server-only";

import type { HqClient } from "../db";

/*
 * Option lists for pickers, shared by every feature so each does not write its own.
 * They run as the signed-in person, so row level security decides what appears: a
 * person who cannot read organisations gets an empty list, never someone else's.
 */

export type Option = { value: string; label: string; group?: string };

/** Active staff, for "assigned to" and "relationship owner" pickers. Needs people.read, which every role has. */
export async function staffOptions(db: HqClient): Promise<Option[]> {
  const { data, error } = await db
    .from("staff_profiles")
    .select("id, full_name")
    .eq("is_active", true)
    .eq("employment_status", "active")
    .order("full_name");
  if (error) {
    console.error("[hq] staffOptions failed:", error.code);
    return [];
  }
  return (data ?? []).map((s) => ({ value: s.id, label: s.full_name }));
}

/** Organisations, alphabetical. Capped: a person picking from more than a few hundred should be searching instead. */
export async function organisationOptions(db: HqClient, limit = 500): Promise<Option[]> {
  const { data, error } = await db.from("organisations").select("id, name").is("deleted_at", null).order("name").limit(limit);
  if (error) {
    console.error("[hq] organisationOptions failed:", error.code);
    return [];
  }
  return (data ?? []).map((o) => ({ value: o.id, label: o.name }));
}

/** Contacts with their organisation as the group. Same cap and the same caveat. */
export async function contactOptions(db: HqClient, limit = 500, opts: { partnersOnly?: boolean } = {}): Promise<Option[]> {
  let q = db.from("contact_directory").select("id, full_name, organisation_name");
  // A referral partner picker lists partner contacts only (a landlord never refers anyone in HQ's sense).
  if (opts.partnersOnly) q = q.eq("contact_kind", "partner");
  const { data, error } = await q.order("full_name").limit(limit);
  if (error) {
    console.error("[hq] contactOptions failed:", error.code);
    return [];
  }
  return (data ?? [])
    .filter((c): c is typeof c & { id: string; full_name: string } => !!c.id && !!c.full_name)
    .map((c) => ({ value: c.id, label: c.full_name, group: c.organisation_name ?? "No organisation" }));
}
