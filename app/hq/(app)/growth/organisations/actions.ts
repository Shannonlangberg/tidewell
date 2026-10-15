"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, PARTNER_CATEGORIES } from "@/lib/hq/constants";
import { findDuplicateOrganisation, type OrganisationInsert, type OrganisationUpdate } from "@/lib/hq/contacts/write";
import { classifyDbError, logTag } from "@/lib/hq/growth/db-errors";
import { retainedValues } from "@/lib/hq/growth/retain";
import { FormReader, fail, type ActionState } from "@/lib/hq/forms";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for organisations. Every one calls requireStaff(<capability>) first, takes
 * identity from the session, validates every input here, and shows people generic, field-level
 * errors. Only error codes and constraint names are logged.
 *
 *   saveOrganisation     growth.write    create or edit
 *   verifyOrganisation   growth.write    "Mark as verified"
 *   archiveOrganisation  growth.delete   soft delete through hq.archive_record
 */

const CONTACTS = `${HQ_BASE}/growth/contacts`;
const ORGANISATIONS = `${HQ_BASE}/growth/organisations`;
const SOURCE_HQ = "Added in HQ";
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const DUPLICATE_NAME = "An organisation with this name already exists.";

function failWith(base: ActionState, retained: Record<string, unknown>, extra: Record<string, unknown> = {}): ActionState {
  return { ...base, data: { values: retained, ...extra } };
}

export async function saveOrganisation(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);

  const id = f.uuid("id");
  const version = f.text("version", { max: 64 });
  const name = f.requiredText("name", { label: "Name", max: 200 });
  const categories = f.manyOf("categories", PARTNER_CATEGORIES);
  if (categories.length === 0 && !f.errors.categories) f.errors.categories = "Choose at least one category.";
  const website = f.url("website");
  const phone = f.phone("phone");
  const email = f.email("email");
  const location = f.text("location", { label: "Location", max: 300 });
  const serviceRegion = f.text("service_region", { label: "Service region", max: 120 });
  const ownerId = f.uuid("relationship_owner_id");
  const notes = f.text("notes", { label: "Notes", max: 4000 });

  const retained = retainedValues(formData);
  if (!f.ok) return failWith(f.fail(), retained);

  const dup = await findDuplicateOrganisation(db, name, id);
  if (dup) {
    return failWith(fail("This organisation is already in HQ.", { name: DUPLICATE_NAME }), retained, { duplicate: { kind: "organisation", id: dup.id, name: dup.name } });
  }

  const columns = {
    name,
    categories,
    website,
    phone,
    email,
    location,
    service_region: serviceRegion,
    relationship_owner_id: ownerId,
    notes,
  };

  let organisationId: string;
  if (id) {
    const update: OrganisationUpdate = columns;
    let q = db.from("organisations").update(update).eq("id", id).is("deleted_at", null);
    if (version) q = q.eq("updated_at", version);
    const res = await q.select("id");
    if (res.error) return failWith(writeFailure(res.error), retained);
    if (!res.data || res.data.length === 0) {
      return failWith(fail("This organisation was changed by someone else while you were editing. Reload the page to see their changes, then edit again."), retained);
    }
    organisationId = id;
  } else {
    const insert: OrganisationInsert = { ...columns, source: SOURCE_HQ, needs_verification: false };
    const res = await db.from("organisations").insert(insert).select("id").single();
    if (res.error || !res.data) return failWith(writeFailure(res.error), retained);
    organisationId = res.data.id;
  }

  revalidatePath(ORGANISATIONS);
  revalidatePath(`${ORGANISATIONS}/${organisationId}`);
  revalidatePath(CONTACTS);
  redirect(withToast(`${ORGANISATIONS}/${organisationId}`, id ? "Organisation saved" : "Organisation added"));
}

function writeFailure(error: { code?: string | null; message?: string | null } | null | undefined): ActionState {
  console.error("[hq] saveOrganisation write failed:", logTag(error));
  switch (classifyDbError(error)) {
    case "duplicate_organisation_name":
      return fail("This organisation is already in HQ.", { name: DUPLICATE_NAME });
    case "permission":
      return fail(FORBIDDEN);
    case "invalid":
      return fail("We couldn't save that. Check the highlighted fields and try again.", { relationship_owner_id: "Choose one of the options." });
    default:
      return fail(GENERIC);
  }
}

/** "Mark as verified": a person has checked this lead. The database stamps who and when. */
export async function verifyOrganisation(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  if (!id) redirect(withToast(ORGANISATIONS, "That organisation could not be found.", "error"));

  const res = await db.from("organisations").update({ needs_verification: false }).eq("id", id).is("deleted_at", null).select("id");
  if (res.error || !res.data || res.data.length === 0) {
    console.error("[hq] verifyOrganisation failed:", logTag(res.error));
    redirect(withToast(`${ORGANISATIONS}/${id}`, "We couldn't mark that as verified.", "error"));
  }
  revalidatePath(ORGANISATIONS);
  revalidatePath(`${ORGANISATIONS}/${id}`);
  redirect(withToast(`${ORGANISATIONS}/${id}`, "Marked as verified"));
}

/**
 * Archives an organisation through hq.archive_record. An organisation that still has live
 * contacts is refused with a plain explanation, so no contact is left pointing at an archived
 * organisation. Returns an error state to show in the dialog, or redirects to the list.
 */
export async function archiveOrganisation(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("growth.delete");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!id || !f.ok) return fail("That organisation could not be archived.", f.errors);

  const contacts = await db.from("contact_directory").select("id", { count: "exact", head: true }).eq("organisation_id", id);
  if (contacts.error) {
    console.error("[hq] archiveOrganisation count failed:", logTag(contacts.error));
    return fail("We couldn't check this organisation's contacts, so nothing was archived. Try again in a moment.");
  }
  if ((contacts.count ?? 0) > 0) {
    const n = contacts.count ?? 0;
    return fail(`This organisation still has ${n} ${n === 1 ? "contact" : "contacts"}. Archive or move ${n === 1 ? "that contact" : "them"} first.`);
  }

  const { error } = await db.rpc("archive_record", { p_entity: "organisation", p_id: id, p_reason: reason ?? undefined });
  if (error) {
    console.error("[hq] archiveOrganisation failed:", logTag(error));
    const kind = classifyDbError(error);
    if (kind === "permission") return fail(FORBIDDEN);
    if (kind === "not_found") return fail("That organisation could not be found. It may already be archived.");
    return fail("We couldn't archive this organisation. Nothing was changed.");
  }

  revalidatePath(ORGANISATIONS);
  revalidatePath(CONTACTS);
  redirect(withToast(ORGANISATIONS, "Organisation archived"));
}
