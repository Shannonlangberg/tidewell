"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, type InteractionType, type OrgContactRole } from "@/lib/hq/constants";
import { readContactForm } from "@/lib/hq/contacts/form";
import { readInteractionForm } from "@/lib/hq/contacts/interaction-form";
import {
  currentPrimary,
  demoteOldPrimary,
  findDuplicateContact,
  findDuplicateOrganisation,
  restorePrimary,
  type ContactInsert,
  type ContactUpdate,
} from "@/lib/hq/contacts/write";
import { classifyDbError, logTag } from "@/lib/hq/growth/db-errors";
import { checkFollowUpDate, todayInZone } from "@/lib/hq/growth/dates";
import { retainedValues } from "@/lib/hq/growth/retain";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for contacts and interactions.
 *
 * Every action calls requireStaff(<capability>) FIRST. Identity comes from the session, never
 * from a form field; created_by, verified_by and deleted_by are stamped by the database. Every
 * input is validated here on the server. Errors shown to people are generic and field-level;
 * what is logged is the error code and constraint name, never a name, email or note.
 *
 *   saveContact           growth.write   create or edit
 *   recordInteraction     growth.write   (+ tasks.write when it creates a follow-up task)
 *   updateContactField    growth.write   inline status / priority / owner / next follow-up
 *   verifyContact         growth.write   "Mark as verified"
 *   makePrimaryContact    growth.write   change an organisation's primary contact
 *   archiveContact        growth.delete  soft delete through hq.archive_record
 */

const CONTACTS = `${HQ_BASE}/growth/contacts`;
const ORGANISATIONS = `${HQ_BASE}/growth/organisations`;
const SOURCE_HQ = "Added in HQ";

const DONE_MESSAGE: Record<InteractionType, string> = {
  phone_call: "Call logged",
  coffee_meeting: "Meeting logged",
  office_meeting: "Meeting logged",
  email: "Email logged",
  message: "Message logged",
  note: "Note added",
};

const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";

function failWith(base: ActionState, retained: Record<string, unknown>, extra: Record<string, unknown> = {}): ActionState {
  return { ...base, data: { values: retained, ...extra } };
}

// ── add or edit a contact ────────────────────────────────────

export async function saveContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("growth.write");
  const { reader: f, values: v } = readContactForm(formData);
  const retained = retainedValues(formData);
  if (!f.ok) return failWith(f.fail(), retained);

  // Editing: the contact must exist, be live, and be visible to this person.
  let existing: { id: string; organisation_id: string | null; org_contact_role: OrgContactRole } | null = null;
  if (v.id) {
    const found = await db.from("contacts").select("id, organisation_id, org_contact_role").eq("id", v.id).is("deleted_at", null).maybeSingle();
    if (found.error) {
      console.error("[hq] saveContact load failed:", logTag(found.error));
      return failWith(fail(GENERIC), retained);
    }
    if (!found.data) return failWith(fail("That contact could not be found. It may have been archived."), retained);
    existing = found.data;
  }

  if (v.organisationId) {
    const org = await db.from("organisation_directory").select("id").eq("id", v.organisationId).maybeSingle();
    if (org.error) {
      console.error("[hq] saveContact organisation check failed:", logTag(org.error));
      return failWith(fail(GENERIC), retained);
    }
    if (!org.data) return failWith(fail("Please check the highlighted fields and try again.", { organisation_id: "Choose one of the options." }), retained);
  }

  // Friendly duplicate protection, before anything is written. The unique indexes still decide.
  const dup = await findDuplicateContact(db, { organisationId: v.organisationId, fullName: v.fullName, email: v.email, excludeId: v.id });
  if (dup) {
    const field = dup.reason === "name" ? "full_name" : "email";
    const message = dup.reason === "name" ? "A contact with this name already exists at this organisation." : "Another contact already uses this email address.";
    return failWith(fail("This looks like someone you already have.", { [field]: message }), retained, {
      duplicate: { kind: "contact", id: dup.id, name: dup.fullName, organisation: dup.organisationName },
    });
  }
  if (v.newOrganisationName) {
    const orgDup = await findDuplicateOrganisation(db, v.newOrganisationName);
    if (orgDup) {
      return failWith(fail("This organisation is already in HQ.", { new_organisation_name: "An organisation with this name already exists. Choose it from the list instead." }), retained, {
        duplicate: { kind: "organisation", id: orgDup.id, name: orgDup.name },
      });
    }
  }

  // A new organisation is created first, so the contact can belong to it.
  let organisationId = v.organisationId;
  let createdOrganisationId: string | null = null;
  if (v.newOrganisationName) {
    const org = await db
      .from("organisations")
      .insert({
        name: v.newOrganisationName,
        categories: v.categories,
        service_region: v.serviceRegion,
        relationship_owner_id: v.ownerId,
        source: SOURCE_HQ,
      })
      .select("id")
      .single();
    if (org.error || !org.data) {
      console.error("[hq] saveContact organisation insert failed:", logTag(org.error));
      if (classifyDbError(org.error) === "duplicate_organisation_name") {
        return failWith(fail("This organisation is already in HQ.", { new_organisation_name: "An organisation with this name already exists. Choose it from the list instead." }), retained);
      }
      return failWith(fail(classifyDbError(org.error) === "permission" ? FORBIDDEN : GENERIC), retained);
    }
    organisationId = org.data.id;
    createdOrganisationId = org.data.id;
  }

  // Which role the contact will hold at the organisation. The first contact added to an
  // organisation is its primary; after that, only when the person asks. The database allows ONE
  // primary per organisation, so the old one is demoted first and put back if the next write fails.
  let role: OrgContactRole = existing && existing.organisation_id === organisationId ? existing.org_contact_role : "secondary";
  let demoted: { id: string } | null = null;
  if (organisationId) {
    const other = createdOrganisationId ? null : await currentPrimary(db, organisationId, v.id);
    if (v.wantsPrimary || (!v.id && !other)) role = "primary";
    else if (role === "primary") role = "secondary";
    if (role === "primary" && other) {
      const result = await demoteOldPrimary(db, organisationId, v.id);
      if (result === "error") return failWith(fail("We couldn't change the primary contact. Nothing was saved."), retained);
      demoted = result;
    }
  } else {
    role = "secondary";
  }

  const undo = async () => {
    if (demoted) await restorePrimary(db, demoted.id);
    if (createdOrganisationId) {
      // Best effort: tidy the organisation this save created (needs growth.delete, so it may not apply).
      const { error } = await db.rpc("archive_record", { p_entity: "organisation", p_id: createdOrganisationId, p_reason: "Created by a save that failed" });
      if (error) console.error("[hq] saveContact cleanup failed:", logTag(error));
    }
  };

  const columns = {
    organisation_id: organisationId,
    full_name: v.fullName,
    position: v.position,
    categories: v.categories,
    phone: v.phone,
    email: v.email,
    website: v.website,
    location: v.location,
    service_region: v.serviceRegion,
    org_contact_role: role,
    relationship_owner_id: v.ownerId,
    relationship_status: v.status,
    priority: v.priority,
    notes: v.notes,
  };

  let contactId: string;
  if (v.id) {
    const update: ContactUpdate = columns;
    let q = db.from("contacts").update(update).eq("id", v.id).is("deleted_at", null);
    if (v.version) q = q.eq("updated_at", v.version);
    const res = await q.select("id");
    if (res.error) {
      await undo();
      return failWith(saveFailure(res.error), retained, duplicateHint(res.error));
    }
    if (!res.data || res.data.length === 0) {
      await undo();
      return failWith(fail("This contact was changed by someone else while you were editing. Reload the page to see their changes, then edit again."), retained);
    }
    contactId = v.id;
  } else {
    const insert: ContactInsert = { ...columns, source: SOURCE_HQ, needs_verification: false };
    const res = await db.from("contacts").insert(insert).select("id").single();
    if (res.error || !res.data) {
      await undo();
      return failWith(saveFailure(res.error), retained, duplicateHint(res.error));
    }
    contactId = res.data.id;
  }

  revalidatePath(CONTACTS);
  revalidatePath(`${CONTACTS}/${contactId}`);
  revalidatePath(ORGANISATIONS);
  if (organisationId) revalidatePath(`${ORGANISATIONS}/${organisationId}`);
  redirect(withToast(`${CONTACTS}/${contactId}`, v.id ? "Contact saved" : "Contact added"));
}

type DbErr = { code?: string | null; message?: string | null } | null | undefined;

function saveFailure(error: DbErr): ActionState {
  console.error("[hq] saveContact write failed:", logTag(error));
  switch (classifyDbError(error)) {
    case "duplicate_contact_name":
      return fail("This looks like someone you already have.", { full_name: "A contact with this name already exists at this organisation." });
    case "duplicate_contact_email":
      return fail("This looks like someone you already have.", { email: "Another contact already uses this email address." });
    case "duplicate_primary":
      return fail("This organisation already has a primary contact, and it could not be changed. Reload the page and try again.", {
        is_primary: "Another primary contact was set at the same moment. Reload and try again.",
      });
    case "permission":
      return fail(FORBIDDEN);
    case "invalid":
      return fail("We couldn't save that. Check the highlighted fields and try again.", { relationship_owner_id: "Choose one of the options." });
    default:
      return fail(GENERIC);
  }
}

/** Lets the form link to the existing record for a duplicate that only the database caught (a race with the look-up). */
function duplicateHint(error: DbErr): Record<string, unknown> {
  const kind = classifyDbError(error);
  return kind === "duplicate_contact_name" || kind === "duplicate_contact_email" ? { duplicateUnknown: true } : {};
}

// ── log a call, meeting or note ──────────────────────────────

export async function recordInteraction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("growth.write");
  const { reader: f, values: v } = readInteractionForm(formData, {
    timezone: staff.timezone,
    staffId: staff.id,
    canCreateTasks: can("tasks.write"),
  });
  const retained = retainedValues(formData);
  if (!f.ok) return failWith(f.fail(), retained);

  const { data, error } = await db.rpc("record_interaction", {
    p_contact: v.contactId ?? undefined,
    p_organisation: v.organisationId ?? undefined,
    p_type: v.type,
    p_occurred_at: v.occurredAt.toISOString(),
    p_summary: v.summary,
    p_next_action: v.nextAction ?? undefined,
    p_follow_up_date: v.followUpDate ?? undefined,
    p_create_task: v.createTask,
    p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
    p_new_status: v.newStatus ?? undefined,
  });

  if (error) {
    console.error("[hq] record_interaction failed:", logTag(error));
    return failWith(interactionFailure(error), retained);
  }

  const result = (data ?? {}) as { task_id?: string | null };
  const done = DONE_MESSAGE[v.type];
  const message = result.task_id ? `${done} and follow-up task created` : done;

  revalidatePath(CONTACTS);
  if (v.contactId) revalidatePath(`${CONTACTS}/${v.contactId}`);
  if (v.organisationId) revalidatePath(`${ORGANISATIONS}/${v.organisationId}`);
  if (result.task_id) revalidatePath(`${HQ_BASE}/operations`);

  const back =
    v.returnTo === "contact" && v.contactId
      ? `${CONTACTS}/${v.contactId}`
      : v.returnTo === "organisation" && v.organisationId
        ? `${ORGANISATIONS}/${v.organisationId}`
        : CONTACTS;
  redirect(withToast(back, message));
}

/** The RPC's own messages are written for this purpose, but they are matched, not shown: people read our wording. */
function interactionFailure(error: DbErr): ActionState {
  const kind = classifyDbError(error);
  const text = (error?.message ?? "").toLowerCase();
  if (kind === "permission") return fail(FORBIDDEN);
  if (kind === "not_found") return fail("That contact could not be found. It may have been archived.", { contact_id: "Choose someone from the list." });
  if (kind === "invalid") {
    if (text.includes("summary")) return fail("Please check the highlighted fields and try again.", { summary: "Summary is required." });
    if (text.includes("future")) return fail("Please check the highlighted fields and try again.", { occurred_at: "The time can't be in the future." });
    if (text.includes("assignee")) return fail("Nothing was saved, so no call or task was recorded.", { task_assignee: "Choose an active member of staff." });
    if (text.includes("status")) return fail("Please check the highlighted fields and try again.", { new_status: "Choose a contact before changing a status." });
    if (text.includes("organisation")) return fail("That person doesn't belong to that organisation.", { contact_id: "Choose someone from the list." });
  }
  return fail("We couldn't log that. Nothing was saved. Try again in a moment.");
}

// ── inline edits on the profile ──────────────────────────────

const INLINE_FIELDS = ["relationship_status", "priority", "relationship_owner_id", "next_follow_up_date"] as const;

export async function updateContactField(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const field = f.oneOf("field", INLINE_FIELDS, { required: true });
  if (!id || !field) return fail("That change could not be made.");

  const update: ContactUpdate = {};
  if (field === "relationship_status") {
    const value = f.oneOf("value", ["identified", "contacted", "meeting_booked", "met", "active_relationship", "referring_partner", "inactive"] as const, { required: true });
    if (value) update.relationship_status = value;
  } else if (field === "priority") {
    const value = f.oneOf("value", ["high", "medium", "low"] as const, { required: true });
    if (value) update.priority = value;
  } else if (field === "relationship_owner_id") {
    update.relationship_owner_id = f.uuid("value");
  } else {
    const raw = f.date("value");
    if (f.ok) {
      const check = checkFollowUpDate(raw, todayInZone(staff.timezone));
      if (!check.ok) f.errors.value = check.message;
      else update.next_follow_up_date = check.value;
    }
  }
  if (!f.ok) return fail("That change could not be made.", f.errors);

  const res = await db.from("contacts").update(update).eq("id", id).is("deleted_at", null).select("id");
  if (res.error) {
    console.error("[hq] updateContactField failed:", logTag(res.error));
    const kind = classifyDbError(res.error);
    if (kind === "permission") return fail(FORBIDDEN);
    if (kind === "invalid") return fail("That change could not be made.", { value: "Choose one of the options." });
    return fail(GENERIC);
  }
  if (!res.data || res.data.length === 0) return fail("That contact could not be found. It may have been archived.");

  revalidatePath(CONTACTS);
  revalidatePath(`${CONTACTS}/${id}`);
  return succeed("Saved");
}

// ── verification ─────────────────────────────────────────────

/** "Mark as verified": a person has checked this lead. The database stamps who and when. */
export async function verifyContact(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  if (!id) redirect(withToast(CONTACTS, "That contact could not be found.", "error"));

  const res = await db.from("contacts").update({ needs_verification: false }).eq("id", id).is("deleted_at", null).select("id");
  if (res.error || !res.data || res.data.length === 0) {
    console.error("[hq] verifyContact failed:", logTag(res.error));
    redirect(withToast(`${CONTACTS}/${id}`, "We couldn't mark that as verified.", "error"));
  }
  revalidatePath(CONTACTS);
  revalidatePath(`${CONTACTS}/${id}`);
  redirect(withToast(`${CONTACTS}/${id}`, "Marked as verified"));
}

// ── primary contact ──────────────────────────────────────────

export async function makePrimaryContact(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const returnTo = f.oneOf("return_to", ["contact", "organisation"] as const, { fallback: "contact" }) ?? "contact";
  if (!id) redirect(withToast(CONTACTS, "That contact could not be found.", "error"));

  const found = await db.from("contacts").select("id, organisation_id, org_contact_role").eq("id", id).is("deleted_at", null).maybeSingle();
  const contact = found.data;
  const back = returnTo === "organisation" && contact?.organisation_id ? `${ORGANISATIONS}/${contact.organisation_id}` : `${CONTACTS}/${id}`;
  if (found.error || !contact || !contact.organisation_id) {
    redirect(withToast(back, "That contact could not be made the primary contact.", "error"));
  }
  if (contact.org_contact_role === "primary") redirect(withToast(back, "They are already the primary contact.", "info"));

  // The old primary is demoted FIRST: the database allows only one per organisation.
  const demoted = await demoteOldPrimary(db, contact.organisation_id, id);
  if (demoted === "error") redirect(withToast(back, "We couldn't change the primary contact.", "error"));

  const { error } = await db.from("contacts").update({ org_contact_role: "primary" }).eq("id", id);
  if (error) {
    console.error("[hq] makePrimaryContact failed:", logTag(error));
    if (demoted) await restorePrimary(db, demoted.id);
    redirect(withToast(back, "We couldn't change the primary contact. The previous one is unchanged.", "error"));
  }

  revalidatePath(CONTACTS);
  revalidatePath(`${CONTACTS}/${id}`);
  revalidatePath(ORGANISATIONS);
  revalidatePath(`${ORGANISATIONS}/${contact.organisation_id}`);
  redirect(withToast(back, "Primary contact updated"));
}

// ── archive ──────────────────────────────────────────────────

/**
 * Archives a contact through hq.archive_record (soft delete: history is kept, the contact
 * leaves every list). Returns an error state to show in the dialog, or redirects to the list.
 */
export async function archiveContact(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("growth.delete");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!id || !f.ok) return fail("That contact could not be archived.", f.errors);

  const { error } = await db.rpc("archive_record", { p_entity: "contact", p_id: id, p_reason: reason ?? undefined });
  if (error) {
    console.error("[hq] archiveContact failed:", logTag(error));
    const kind = classifyDbError(error);
    if (kind === "permission") return fail(FORBIDDEN);
    if (kind === "not_found") return fail("That contact could not be found. It may already be archived.");
    return fail("We couldn't archive this contact. Nothing was changed.");
  }

  revalidatePath(CONTACTS);
  revalidatePath(ORGANISATIONS);
  redirect(withToast(CONTACTS, "Contact archived"));
}
