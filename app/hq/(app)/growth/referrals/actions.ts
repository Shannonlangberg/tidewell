"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, OPPORTUNITY_STAGES, REFERRAL_DIRECTIONS, SENT_OUTCOMES, STAGE_LABEL } from "@/lib/hq/constants";
import type { HqClient } from "@/lib/hq/db";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { formatDate, refNumber, todayIn } from "@/lib/hq/format";
import { zonedLocalToDate } from "@/lib/hq/growth/dates";
import { retainedValues } from "@/lib/hq/growth/retain";
import { classifyReferralError, logTag, type DbError } from "@/lib/hq/referrals/errors";
import { checkPartner, checkPastOrToday, safeReturnPath } from "@/lib/hq/referrals/rules";
import { canLeaveSigned } from "@/lib/hq/referrals/stages";

/*
 * Server Actions for referrals and the pipeline. They are reachable by a direct POST, so every
 * one asks the DATABASE who is calling and what they may do, before anything else.
 *
 *   recordReferral         growth.write   hq.record_referral (creates the opportunity or a claim)
 *   moveStage              growth.write   hq.move_opportunity (signing is idempotent)
 *   setCreditedSource      growth.write   hq.set_attributed_referral
 *   updateReferral         growth.write   direct update of the referral's own editable columns
 *   updateOpportunity      growth.write   direct update of the prospect, estimate, assignee, notes
 *   archiveReferral        growth.delete  hq.archive_record (and the opportunity, when it was the only referral)
 *
 * Identity comes from the session, never from a form field. Every input is validated here whatever
 * the browser did. Errors shown to people are generic and field-level; what is logged is the error
 * code and constraint name, never a name, phone number, email or note.
 *
 * Referrals and opportunities are written ONLY through the RPCs for everything that moves counts
 * (stage, signing, credit). The two direct updates touch only the columns the database grants.
 */

const GROWTH = `${HQ_BASE}/growth`;
const REFERRALS = `${GROWTH}/referrals`;
const PIPELINE = `${GROWTH}/pipeline`;

const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";

function failWith(base: ActionState, retained: Record<string, unknown>): ActionState {
  return { ...base, data: { values: retained } };
}

function refresh(...extra: string[]) {
  revalidatePath(GROWTH);
  revalidatePath(REFERRALS);
  revalidatePath(PIPELINE);
  for (const p of extra) revalidatePath(p);
}

async function isActiveStaff(db: HqClient, id: string): Promise<boolean> {
  const { data, error } = await db.from("staff_profiles").select("id").eq("id", id).eq("is_active", true).eq("employment_status", "active").maybeSingle();
  if (error) {
    console.error("[hq] staff check failed:", logTag(error));
    return false;
  }
  return !!data;
}

// ── record a referral ────────────────────────────────────────

export async function recordReferral(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const retained = retainedValues(formData);
  const today = todayIn(staff.timezone);

  const direction = f.oneOf("direction", REFERRAL_DIRECTIONS, { required: true });
  const contactId = f.uuid("partner_contact");
  const organisationId = f.uuid("partner_organisation");

  const dateText = f.date("referral_date", { required: true });
  if (dateText && !f.errors.referral_date) {
    const check = checkPastOrToday(dateText, today, "The referral date");
    if (!check.ok) f.errors.referral_date = check.message;
  }

  const assignedTo = f.uuid("assigned_to");
  const notes = f.text("notes", { max: 2000, label: "Notes" });

  // Received: a new prospect, or a further introduction for a prospect already in the pipeline.
  const mode = direction === "received" ? (f.oneOf("prospect_mode", ["new", "existing"] as const, { fallback: "new" }) ?? "new") : "new";
  const attaching = direction === "received" && mode === "existing";
  const existingOpportunity = attaching ? f.uuid("existing_opportunity") : null;
  if (attaching && !existingOpportunity && !f.errors.existing_opportunity) {
    f.errors.existing_opportunity = "Choose the prospect who is already in the pipeline.";
  }

  let prospectName: string | null = null;
  let prospectPhone: string | null = null;
  let prospectEmail: string | null = null;
  let suburb: string | null = null;
  let address: string | null = null;
  let estimateCents: number | null = null;
  if (!attaching) {
    prospectName = direction === "received" ? f.requiredText("prospect_name", { max: 200, label: "The prospect's name" }) : f.text("prospect_name", { max: 200, label: "The prospect's name" });
    prospectPhone = f.phone("prospect_phone");
    prospectEmail = f.email("prospect_email");
    suburb = f.text("property_suburb", { max: 120, label: "The suburb" });
    address = f.text("property_address", { max: 300, label: "The address" });
    if (direction === "received") estimateCents = f.dollarsToCents("estimated_value");
  }

  if (!direction || !f.ok) return failWith(f.fail(), retained);

  // A named contact must exist, and must work at the organisation if one was chosen too.
  let contactOrganisationId: string | null = null;
  if (contactId) {
    const found = await db.from("contacts").select("id, organisation_id").eq("id", contactId).is("deleted_at", null).maybeSingle();
    if (found.error) {
      console.error("[hq] recordReferral contact check failed:", logTag(found.error));
      return failWith(fail(GENERIC), retained);
    }
    if (!found.data) return failWith(fail("Please check the highlighted fields and try again.", { partner_contact: "That contact could not be found. It may have been archived." }), retained);
    contactOrganisationId = found.data.organisation_id;
  }
  const partner = checkPartner({ contactId, organisationId, contactOrganisationId });
  if (!partner.ok) return failWith(fail("Please check the highlighted fields and try again.", { [partner.field]: partner.message }), retained);

  const common = {
    p_referral_date: dateText ?? undefined,
    p_assigned_to: assignedTo ?? undefined,
    p_notes: notes ?? undefined,
  };
  const { data, error } =
    direction === "received"
      ? await db.rpc("record_referral", {
          p_direction: "received",
          p_referring_contact: partner.partner.contactId ?? undefined,
          p_referring_organisation: partner.partner.organisationId ?? undefined,
          p_existing_opportunity: existingOpportunity ?? undefined,
          p_prospect_name: prospectName ?? undefined,
          p_prospect_phone: prospectPhone ?? undefined,
          p_prospect_email: prospectEmail ?? undefined,
          p_property_suburb: suburb ?? undefined,
          p_property_address: address ?? undefined,
          p_estimated_value_cents: estimateCents ?? undefined,
          ...common,
        })
      : await db.rpc("record_referral", {
          p_direction: "sent",
          p_receiving_contact: partner.partner.contactId ?? undefined,
          p_receiving_organisation: partner.partner.organisationId ?? undefined,
          p_prospect_name: prospectName ?? undefined,
          p_prospect_phone: prospectPhone ?? undefined,
          p_prospect_email: prospectEmail ?? undefined,
          p_property_suburb: suburb ?? undefined,
          p_property_address: address ?? undefined,
          ...common,
        });

  if (error) {
    console.error("[hq] record_referral failed:", logTag(error));
    return failWith(recordFailure(error), retained);
  }

  const result = (data ?? {}) as { referral_id?: unknown; ref_number?: unknown; is_attributed?: unknown };
  const id = typeof result.referral_id === "string" ? result.referral_id : "";
  if (!isUuid(id)) {
    console.error("[hq] record_referral returned no referral id");
    return failWith(fail("We couldn't confirm that was saved. Check the referral register before trying again."), retained);
  }

  refresh();
  const label = refNumber(typeof result.ref_number === "number" ? result.ref_number : Number(result.ref_number));
  const message = result.is_attributed === false ? `${label} recorded. It is a further claim, so the credit stays with the first partner.` : `${label} recorded`;
  redirect(withToast(`${REFERRALS}/${id}`, message));
}

function recordFailure(error: DbError): ActionState {
  const summary = "Please check the highlighted fields and try again.";
  switch (classifyReferralError(error)) {
    case "permission":
      return fail(FORBIDDEN);
    case "partner_not_found":
      return fail(summary, { partner_organisation: "That partner could not be found. It may have been archived." });
    case "partner_required":
      return fail(summary, { partner_organisation: "Choose the partner: an organisation, a contact, or both." });
    case "partner_mismatch":
      return fail(summary, { partner_contact: "That contact works at a different organisation." });
    case "duplicate_claim":
      return fail(summary, { existing_opportunity: "This partner already has a referral for that prospect. Find it in the referral register instead." });
    case "not_found":
      return fail(summary, { existing_opportunity: "That prospect could not be found. It may have been archived." });
    case "prospect_required":
      return fail(summary, { prospect_name: "The prospect's name is required." });
    case "assignee_inactive":
      return fail(summary, { assigned_to: "Choose an active member of staff." });
    case "value_on_claim":
      return fail(summary, { estimated_value: "The estimate belongs to the prospect, so it can't be set on a further referral." });
    default:
      return fail(GENERIC);
  }
}

// ── move a prospect to another stage ─────────────────────────

export async function moveStage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const retained = retainedValues(formData);
  const returnTo = safeReturnPath(formData.get("return_to"), PIPELINE);
  const today = todayIn(staff.timezone);

  const opportunityId = f.uuid("opportunity_id", { required: true, label: "The prospect" });
  const stage = f.oneOf("stage", OPPORTUNITY_STAGES, { required: true });
  const note = f.text("note", { max: 500, label: "The note" });
  let signedDate: string | null = null;
  let reference: string | null = null;
  let lostReason: string | null = null;
  if (stage === "management_signed") {
    const typed = f.date("signed_date");
    if (!f.errors.signed_date) {
      const check = checkPastOrToday(typed ?? today, today, "The signed date");
      if (check.ok) signedDate = check.value;
      else f.errors.signed_date = check.message;
    }
    reference = f.text("management_reference", { max: 100, label: "The reference" });
  } else if (stage === "lost") {
    lostReason = f.requiredText("lost_reason", { max: 300, label: "The reason" });
  }
  if (!f.ok || !opportunityId || !stage) return failWith(f.fail(), retained);

  // Look before moving, so signing twice is recognised and explained, and so a person who may not
  // leave "signed" is told why instead of meeting a database error.
  const current = await db.from("opportunities").select("id, stage, signed_at").eq("id", opportunityId).is("deleted_at", null).maybeSingle();
  if (current.error) {
    console.error("[hq] moveStage read failed:", logTag(current.error));
    return failWith(fail(GENERIC), retained);
  }
  if (!current.data) return failWith(fail("That prospect could not be found. It may have been archived."), retained);
  const from = current.data.stage;

  if (from === stage) {
    const message =
      stage === "management_signed"
        ? `Already signed${current.data.signed_at ? ` on ${formatDate(current.data.signed_at, staff.timezone)}` : ""}. This management is counted once, so nothing changed.`
        : `Already at ${STAGE_LABEL[stage]}. Nothing changed.`;
    redirect(withToast(returnTo, message, "info"));
  }
  if (from === "management_signed" && !canLeaveSigned(staff.role)) {
    return failWith(fail("Only a director or administrator can move a signed management out of signed.", { stage: "You can't move a signed management." }), retained);
  }

  const signedAt = signedDate ? zonedLocalToDate(`${signedDate}T12:00`, staff.timezone) : null;
  if (signedDate && !signedAt) return failWith(fail("Please check the highlighted fields and try again.", { signed_date: "Enter a valid date." }), retained);

  const { data, error } = await db.rpc("move_opportunity", {
    p_opportunity: opportunityId,
    p_stage: stage,
    p_note: note ?? undefined,
    p_signed_at: signedAt ? signedAt.toISOString() : undefined,
    p_management_reference: reference ?? undefined,
    p_lost_reason: lostReason ?? undefined,
  });
  if (error) {
    console.error("[hq] move_opportunity failed:", logTag(error));
    return failWith(moveFailure(error), retained);
  }

  const changed = (data as { changed?: unknown } | null)?.changed !== false;
  refresh();
  if (!changed) redirect(withToast(returnTo, "Nothing changed. It was already at that stage.", "info"));
  const message =
    stage === "management_signed"
      ? "Management signed. It is counted once, credited to the original source."
      : from === "management_signed"
        ? `Moved out of signed to ${STAGE_LABEL[stage]}. The signed count has changed.`
        : `Moved to ${STAGE_LABEL[stage]}`;
  redirect(withToast(returnTo, message));
}

function moveFailure(error: DbError): ActionState {
  const summary = "Please check the highlighted fields and try again.";
  switch (classifyReferralError(error)) {
    case "permission":
      return fail(FORBIDDEN);
    case "leave_signed_forbidden":
      return fail("Only a director or administrator can move a signed management out of signed.", { stage: "You can't move a signed management." });
    case "not_found":
      return fail("That prospect could not be found. It may have been archived.");
    case "lost_reason_required":
      return fail(summary, { lost_reason: "The reason is required." });
    case "duplicate_reference":
      return fail(summary, { management_reference: "That reference is already used for another management. Check it and try again." });
    default:
      return fail("We couldn't move that. Nothing was changed. Try again in a moment.");
  }
}

// ── who is credited ──────────────────────────────────────────

/** A form action with no result state: it redirects back with a toast, success or failure. */
export async function setCreditedSource(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const opportunityId = f.uuid("opportunity_id", { required: true });
  const referralId = f.uuid("referral_id", { required: true });
  const back = safeReturnPath(formData.get("return_to"), REFERRALS);
  if (!opportunityId || !referralId) redirect(withToast(back, "That change could not be made.", "error"));

  const { data, error } = await db.rpc("set_attributed_referral", { p_opportunity: opportunityId, p_referral: referralId });
  if (error) {
    console.error("[hq] set_attributed_referral failed:", logTag(error));
    const kind = classifyReferralError(error);
    const message =
      kind === "permission"
        ? FORBIDDEN
        : kind === "not_found" || kind === "not_a_claim"
          ? "That referral is not one of this prospect's introductions. Reload the page and try again."
          : "We couldn't change the credited source. Nothing was changed.";
    redirect(withToast(back, message, "error"));
  }
  refresh(back.split("?")[0]);
  const changed = (data as { changed?: unknown } | null)?.changed !== false;
  redirect(withToast(back, changed ? "Credited source changed. The signed count is unchanged." : "That referral was already the credited source.", changed ? "success" : "info"));
}

// ── edit a referral ──────────────────────────────────────────

export async function updateReferral(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const retained = retainedValues(formData);
  const id = f.uuid("referral_id", { required: true, label: "The referral" });
  if (!id) return failWith(f.fail(), retained);
  const back = safeReturnPath(formData.get("return_to"), `${REFERRALS}/${id}`);
  const today = todayIn(staff.timezone);

  // The direction comes from the database, never from the form: a received referral cannot be given an outcome.
  const found = await db.from("referrals").select("id, direction, assigned_to").eq("id", id).is("deleted_at", null).maybeSingle();
  if (found.error) {
    console.error("[hq] updateReferral read failed:", logTag(found.error));
    return failWith(fail(GENERIC), retained);
  }
  if (!found.data) return failWith(fail("That referral could not be found. It may have been archived."), retained);

  const dateText = f.date("referral_date", { required: true });
  if (dateText && !f.errors.referral_date) {
    const check = checkPastOrToday(dateText, today, "The referral date");
    if (!check.ok) f.errors.referral_date = check.message;
  }
  const assignedTo = f.uuid("assigned_to");
  const notes = f.text("notes", { max: 2000, label: "Notes" });

  const update: {
    referral_date?: string;
    assigned_to?: string | null;
    notes?: string | null;
    sent_outcome?: (typeof SENT_OUTCOMES)[number];
    prospect_name?: string | null;
    prospect_phone?: string | null;
    prospect_email?: string | null;
    property_suburb?: string | null;
    property_address?: string | null;
  } = { notes, assigned_to: assignedTo };
  if (dateText) update.referral_date = dateText;

  if (found.data.direction === "sent") {
    const outcome = f.oneOf("sent_outcome", SENT_OUTCOMES, { required: true });
    if (outcome) update.sent_outcome = outcome;
    update.prospect_name = f.text("prospect_name", { max: 200, label: "The prospect's name" });
    update.prospect_phone = f.phone("prospect_phone");
    update.prospect_email = f.email("prospect_email");
    update.property_suburb = f.text("property_suburb", { max: 120, label: "The suburb" });
    update.property_address = f.text("property_address", { max: 300, label: "The address" });
  }
  if (!f.ok) return failWith(f.fail(), retained);

  // Someone who has since left may still be the assignee: leaving it unchanged is fine, choosing them anew is not.
  if (assignedTo && assignedTo !== found.data.assigned_to && !(await isActiveStaff(db, assignedTo))) {
    return failWith(fail("Please check the highlighted fields and try again.", { assigned_to: "Choose an active member of staff." }), retained);
  }

  const res = await db.from("referrals").update(update).eq("id", id).is("deleted_at", null).select("id");
  if (res.error) {
    console.error("[hq] updateReferral failed:", logTag(res.error));
    return failWith(classifyReferralError(res.error) === "permission" ? fail(FORBIDDEN) : fail(GENERIC), retained);
  }
  if (!res.data || res.data.length === 0) return failWith(fail("That referral could not be found. It may have been archived."), retained);

  refresh(`${REFERRALS}/${id}`);
  redirect(withToast(back, "Referral updated"));
}

// ── edit the prospect behind a received referral ─────────────

export async function updateOpportunity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const retained = retainedValues(formData);
  const id = f.uuid("opportunity_id", { required: true, label: "The prospect" });
  const back = safeReturnPath(formData.get("return_to"), REFERRALS);

  const prospectName = f.requiredText("prospect_name", { max: 200, label: "The prospect's name" });
  const prospectPhone = f.phone("prospect_phone");
  const prospectEmail = f.email("prospect_email");
  const suburb = f.text("property_suburb", { max: 120, label: "The suburb" });
  const address = f.text("property_address", { max: 300, label: "The address" });
  const estimateCents = f.dollarsToCents("estimated_value");
  const assignedTo = f.uuid("assigned_to");
  const notes = f.text("notes", { max: 2000, label: "Notes" });
  if (!id || !f.ok) return failWith(f.fail(), retained);

  const current = await db.from("opportunities").select("id, assigned_to").eq("id", id).is("deleted_at", null).maybeSingle();
  if (current.error) {
    console.error("[hq] updateOpportunity read failed:", logTag(current.error));
    return failWith(fail(GENERIC), retained);
  }
  if (!current.data) return failWith(fail("That prospect could not be found. It may have been archived."), retained);
  if (assignedTo && assignedTo !== current.data.assigned_to && !(await isActiveStaff(db, assignedTo))) {
    return failWith(fail("Please check the highlighted fields and try again.", { assigned_to: "Choose an active member of staff." }), retained);
  }

  const res = await db
    .from("opportunities")
    .update({
      prospect_name: prospectName,
      prospect_phone: prospectPhone,
      prospect_email: prospectEmail,
      property_suburb: suburb,
      property_address: address,
      estimated_annual_value_cents: estimateCents,
      assigned_to: assignedTo,
      notes,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (res.error) {
    console.error("[hq] updateOpportunity failed:", logTag(res.error));
    const kind = classifyReferralError(res.error);
    return failWith(kind === "permission" ? fail(FORBIDDEN) : kind === "invalid" ? fail("Please check the highlighted fields and try again.", { estimated_value: "That amount isn't allowed." }) : fail(GENERIC), retained);
  }
  if (!res.data || res.data.length === 0) return failWith(fail("That prospect could not be found. It may have been archived."), retained);

  refresh(back.split("?")[0]);
  redirect(withToast(back, "Prospect updated"));
}

// ── archive ──────────────────────────────────────────────────

/**
 * Archives a referral through hq.archive_record (a soft delete: the history is kept, the referral
 * leaves every list and every count). When it was the ONLY referral for its prospect, the prospect
 * goes with it, so no orphaned opportunity is left in the pipeline and the counts. The database
 * refuses to archive the credited source while other partners claim the prospect: that message is
 * shown, and nothing changes.
 */
export async function archiveReferral(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.delete");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!id || !f.ok) redirect(withToast(REFERRALS, "That referral could not be archived.", "error"));
  const here = `${REFERRALS}/${id}`;

  const found = await db.from("referrals").select("id, direction, opportunity_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (found.error || !found.data) {
    if (found.error) console.error("[hq] archiveReferral read failed:", logTag(found.error));
    redirect(withToast(REFERRALS, "That referral could not be found. It may already be archived.", "error"));
  }

  const { error } = await db.rpc("archive_record", { p_entity: "referral", p_id: id, p_reason: reason ?? undefined });
  if (error) {
    console.error("[hq] archive_record failed:", logTag(error));
    const kind = classifyReferralError(error);
    const message =
      kind === "attributed_source"
        ? "This is the credited source and other partners claim the same prospect. Make another referral the credited source first, then archive this one."
        : kind === "permission"
          ? FORBIDDEN
          : kind === "not_found"
            ? "That referral could not be found. It may already be archived."
            : "We couldn't archive this referral. Nothing was changed.";
    redirect(withToast(here, message, "error"));
  }

  // The only referral for its prospect: archive the prospect too, so it is not left counted but unseen.
  let prospectKept = false;
  const opportunityId = found.data.opportunity_id;
  if (found.data.direction === "received" && opportunityId) {
    const others = await db.from("referral_overview").select("id", { count: "exact", head: true }).eq("opportunity_id", opportunityId).eq("direction", "received");
    if (!others.error && (others.count ?? 0) === 0) {
      const archived = await db.rpc("archive_record", { p_entity: "opportunity", p_id: opportunityId, p_reason: reason ?? "Its only referral was archived" });
      if (archived.error) {
        console.error("[hq] archive opportunity failed:", logTag(archived.error));
        prospectKept = true;
      }
    }
  }

  refresh();
  redirect(
    prospectKept
      ? withToast(REFERRALS, "Referral archived, but its prospect could not be archived and may still appear in the pipeline.", "info")
      : withToast(REFERRALS, "Referral archived"),
  );
}

