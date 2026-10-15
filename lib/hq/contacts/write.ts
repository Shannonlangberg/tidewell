import "server-only";

import type { HqClient, Tables } from "../db";
import { logTag } from "../growth/db-errors";
import { normaliseName } from "../growth/params";

/*
 * Shared write-side helpers for contacts and organisations: duplicate look-ups (so a person gets
 * "this looks like someone you already have" with a link, not a raw 23505) and the safe order for
 * changing an organisation's primary contact.
 *
 * Every call runs as the signed-in person under row level security. The unique indexes in the
 * database remain the real guarantee; these look-ups only make the common cases friendly.
 */

export type ContactInsert = Tables["contacts"]["Insert"];
export type ContactUpdate = Tables["contacts"]["Update"];
export type OrganisationInsert = Tables["organisations"]["Insert"];
export type OrganisationUpdate = Tables["organisations"]["Update"];

export type DuplicateContact = {
  id: string;
  fullName: string;
  organisationName: string | null;
  reason: "name" | "email";
};

/** An existing live contact with the same name at the same organisation, or the same email. */
export async function findDuplicateContact(
  db: HqClient,
  input: { organisationId: string | null; fullName: string; email: string | null; excludeId?: string | null },
): Promise<DuplicateContact | null> {
  const key = normaliseName(input.fullName);

  if (input.organisationId && key) {
    const { data, error } = await db
      .from("contact_directory")
      .select("id, full_name, organisation_name")
      .eq("organisation_id", input.organisationId)
      .limit(200);
    if (error) {
      console.error("[hq] findDuplicateContact (name) failed:", logTag(error));
    } else {
      const hit = (data ?? []).find((c) => c.id && c.id !== input.excludeId && c.full_name && normaliseName(c.full_name) === key);
      if (hit?.id && hit.full_name) return { id: hit.id, fullName: hit.full_name, organisationName: hit.organisation_name, reason: "name" };
    }
  }

  if (input.email) {
    const { data, error } = await db.from("contact_directory").select("id, full_name, organisation_name").eq("email", input.email).limit(2);
    if (error) {
      console.error("[hq] findDuplicateContact (email) failed:", logTag(error));
    } else {
      const hit = (data ?? []).find((c) => c.id && c.id !== input.excludeId);
      if (hit?.id && hit.full_name) return { id: hit.id, fullName: hit.full_name, organisationName: hit.organisation_name, reason: "email" };
    }
  }
  return null;
}

export type DuplicateOrganisation = { id: string; name: string };

/** An existing live organisation whose normalised name matches `name`. */
export async function findDuplicateOrganisation(db: HqClient, name: string, excludeId?: string | null): Promise<DuplicateOrganisation | null> {
  const key = normaliseName(name);
  if (!key) return null;
  // Narrow with a prefix match on the first word, then compare keys exactly in code.
  const firstWord = key.split(" ")[0].replace(/[^\p{L}\p{N}]/gu, "");
  const q = db.from("organisation_directory").select("id, name").limit(200);
  const { data, error } = await (firstWord ? q.ilike("name", `*${firstWord}*`) : q);
  if (error) {
    console.error("[hq] findDuplicateOrganisation failed:", logTag(error));
    return null;
  }
  const hit = (data ?? []).find((o) => o.id && o.id !== excludeId && o.name && normaliseName(o.name) === key);
  return hit?.id && hit.name ? { id: hit.id, name: hit.name } : null;
}

/** The live primary contact of an organisation, if there is one. */
export async function currentPrimary(db: HqClient, organisationId: string, excludeId?: string | null): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("contacts")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("org_contact_role", "primary")
    .is("deleted_at", null)
    .limit(2);
  if (error) {
    console.error("[hq] currentPrimary failed:", logTag(error));
    return null;
  }
  const hit = (data ?? []).find((c) => c.id !== excludeId);
  return hit ? { id: hit.id } : null;
}

/**
 * Makes room for a new primary contact. The database allows exactly one primary per
 * organisation, so the old one must be demoted FIRST. Returns the demoted contact's id (so the
 * caller can put it back if the following write fails), null when there was none, or "error".
 */
export async function demoteOldPrimary(db: HqClient, organisationId: string, exceptId?: string | null): Promise<{ id: string } | null | "error"> {
  const old = await currentPrimary(db, organisationId, exceptId);
  if (!old) return null;
  const { error } = await db.from("contacts").update({ org_contact_role: "secondary" }).eq("id", old.id).eq("org_contact_role", "primary");
  if (error) {
    console.error("[hq] demoteOldPrimary failed:", logTag(error));
    return "error";
  }
  return old;
}

/** Best-effort: put a demoted primary back after a later write failed. */
export async function restorePrimary(db: HqClient, contactId: string): Promise<void> {
  const { error } = await db.from("contacts").update({ org_contact_role: "primary" }).eq("id", contactId);
  if (error) console.error("[hq] restorePrimary failed:", logTag(error));
}
