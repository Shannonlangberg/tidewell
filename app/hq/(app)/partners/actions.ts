"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, INTERACTION_LABEL, type InteractionType } from "@/lib/hq/constants";
import { readContactForm } from "@/lib/hq/contractors/contact-form";
import { classifyContractorError, logTag } from "@/lib/hq/contractors/db-errors";
import { abnProblem, stripAbn } from "@/lib/hq/contractors/abn";
import { readContractorFields } from "@/lib/hq/contractors/form";
import { parseDollars } from "@/lib/hq/contractors/money";
import { MOVE_TARGETS } from "@/lib/hq/contractors/status";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { normaliseName } from "@/lib/hq/growth/params";
import { retainedValues } from "@/lib/hq/growth/retain";
import { todayInZone } from "@/lib/hq/growth/dates";
import { loadTrades } from "@/lib/hq/trades/queries";
import { allowedTradeSlugs } from "@/lib/hq/trades/rules";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for contractors.
 *
 * Every action calls requireStaff(<capability>) FIRST. Identity comes from the session, never from
 * a form field; created_by, verified_by, approved_by and deleted_by are stamped by the database.
 * Every input is validated here on the server. What a person is shown is generic and field-level;
 * what is logged is the error code and constraint name, never a name, ABN, email or note.
 *
 * The database is the control. A hidden button is a courtesy: the guard trigger and the RPCs
 * refuse a request from someone who may not do it, and these actions run as that person.
 *
 *   saveContractor          contractors.write    create or edit (status is never part of it)
 *   markContractorVerified  contractors.write    clears "needs verifying"
 *   recordContractorContact contractors.write    (+ tasks.write when it creates a follow-up task)
 *   suspendContractor       contractors.write    set_contractor_status, a note is required
 *   changeContractorStatus  contractors.write    set_contractor_status to prospect / contacted / vetting / inactive
 *   approveContractor       contractors.approve  approve_contractor (preferred is a separate choice)
 *   reinstateContractor     contractors.approve  reinstate_contractor, back to vetting
 *   archiveContractor       contractors.approve  archive_record
 *   recordContractorJob     contractors.write    mark_contractor_used ("Record a job": last used, never backwards unless confirmed)
 */

const PARTNERS = `${HQ_BASE}/partners`;
const SOURCE_HQ = "Added in HQ";

const GENERIC = "Something went wrong and nothing was changed. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That contractor could not be found. It may have been archived.";

function failWith(base: ActionState, retained: Record<string, unknown>, extra: Record<string, unknown> = {}): ActionState {
  return { ...base, data: { values: retained, ...extra } };
}

function refresh(id?: string) {
  revalidatePath(PARTNERS);
  if (id) revalidatePath(`${PARTNERS}/${id}`);
  revalidatePath(HQ_BASE);
  revalidatePath(`${HQ_BASE}/search`);
}

// ── add or edit ──────────────────────────────────────────────

type Existing = { id: string; categories: string[]; licence_expires_on: string | null; insurance_expires_on: string | null };

export async function saveContractor(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const retained = retainedValues(formData);

  // The trades a contractor may be given come from hq.trades: the active ones, plus any archived trade this
  // contractor already has (kept, never silently dropped). The database checks the same rule again.
  const trades = await loadTrades(db);
  if (!trades.ok) return failWith(fail(GENERIC), retained);
  const editingId = new FormReader(formData).uuid("id");
  let current: string[] = [];
  if (editingId) {
    const had = await db.from("contractors").select("categories").eq("id", editingId).maybeSingle();
    current = had.data?.categories ?? [];
  }

  const f = new FormReader(formData);
  const v = readContractorFields(f, { categories: allowedTradeSlugs(trades.data, current), abnProblem, stripAbn, parseDollars });
  if (!f.ok) return failWith(f.fail(), retained);

  let existing: Existing | null = null;
  if (v.id) {
    const found = await db.from("contractors").select("id, categories, licence_expires_on, insurance_expires_on").eq("id", v.id).is("deleted_at", null).maybeSingle();
    if (found.error) {
      console.error("[hq] saveContractor load failed:", logTag(found.error));
      return failWith(fail(GENERIC), retained);
    }
    if (!found.data) return failWith(fail(NOT_FOUND), retained);
    existing = found.data;
  }

  if (v.ownerId) {
    const owner = await db.from("staff_profiles").select("id").eq("id", v.ownerId).eq("is_active", true).maybeSingle();
    if (owner.error) {
      console.error("[hq] saveContractor owner check failed:", logTag(owner.error));
      return failWith(fail(GENERIC), retained);
    }
    if (!owner.data) return failWith(fail("Please check the highlighted fields and try again.", { relationship_owner_id: "Choose one of the options." }), retained);
  }

  // Friendly duplicate protection before anything is written. The unique indexes still decide.
  const dup = await findDuplicate(db, { name: v.businessName, abn: v.abn, excludeId: v.id });
  if (dup) {
    const field = dup.reason === "abn" ? "abn" : "business_name";
    const message = dup.reason === "abn" ? "Another contractor already has this ABN." : "A contractor with this name is already in HQ.";
    return failWith(fail("This looks like a contractor you already have.", { [field]: message }), retained, { duplicate: { id: dup.id, name: dup.name } });
  }

  // Only the columns the database lets the API write. Status, approval and verification are never sent.
  const columns = {
    business_name: v.businessName,
    primary_contact_name: v.primaryContactName,
    phone: v.phone,
    email: v.email,
    website: v.website,
    abn: v.abn,
    categories: v.categories,
    service_suburbs: v.serviceSuburbs,
    service_regions: v.serviceRegions,
    emergency_available: v.emergencyAvailable,
    business_hours: v.businessHours,
    hourly_rate_cents: v.hourlyRateCents,
    callout_fee_cents: v.calloutFeeCents,
    after_hours_fee_cents: v.afterHoursFeeCents,
    minimum_charge_cents: v.minimumChargeCents,
    invoice_terms: v.invoiceTerms,
    licence_details: v.licenceDetails,
    insurance_details: v.insuranceDetails,
    relationship_owner_id: v.ownerId,
    internal_notes: v.internalNotes,
    last_job_date: v.lastJobDate,
  };

  let id: string;
  if (existing && v.id) {
    // Changing an expiry date clears its "verified" date (a verification vouches for the date it saw), so an
    // expiry that has not changed is left out of the update altogether.
    const update = {
      ...columns,
      ...(v.licenceExpiresOn !== existing.licence_expires_on ? { licence_expires_on: v.licenceExpiresOn } : {}),
      ...(v.insuranceExpiresOn !== existing.insurance_expires_on ? { insurance_expires_on: v.insuranceExpiresOn } : {}),
    };
    let q = db.from("contractors").update(update).eq("id", v.id).is("deleted_at", null);
    if (v.version) q = q.eq("updated_at", v.version);
    const res = await q.select("id");
    if (res.error) return failWith(saveFailure(res.error), retained);
    if (!res.data || res.data.length === 0) {
      return failWith(fail("This contractor was changed by someone else while you were editing. Reload the page to see their changes, then edit again."), retained);
    }
    id = v.id;
  } else {
    const res = await db
      .from("contractors")
      .insert({ ...columns, licence_expires_on: v.licenceExpiresOn, insurance_expires_on: v.insuranceExpiresOn, source: SOURCE_HQ, needs_verification: false })
      .select("id")
      .single();
    if (res.error || !res.data) return failWith(saveFailure(res.error), retained);
    id = res.data.id;
  }

  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, v.id ? "Contractor saved" : "Contractor added"));
}

type DbErr = { code?: string | null; message?: string | null } | null | undefined;

function saveFailure(error: DbErr): ActionState {
  console.error("[hq] saveContractor write failed:", logTag(error));
  switch (classifyContractorError(error)) {
    case "name_duplicate":
      return fail("This looks like a contractor you already have.", { business_name: "A contractor with this name is already in HQ." });
    case "abn_duplicate":
      return fail("This looks like a contractor you already have.", { abn: "Another contractor already has this ABN." });
    case "abn_invalid":
      return fail("Please check the highlighted fields and try again.", { abn: "That ABN doesn't pass the ABN check, so a digit is probably wrong." });
    case "categories_empty":
      return fail("Please check the highlighted fields and try again.", { categories: "Choose at least one trade." });
    case "trade_not_current":
      return fail("Please check the highlighted fields and try again.", { categories: "One of those trades has just been archived or removed. Reload the page and choose again." });
    case "email_shape":
      return fail("Please check the highlighted fields and try again.", { email: "That doesn't look like an email address." });
    case "rates_negative":
      return fail("Please check the highlighted fields and try again.", { hourly_rate: "An amount can't be negative." });
    case "name_blank":
      return fail("Please check the highlighted fields and try again.", { business_name: "Business name is required." });
    case "permission":
      return fail(FORBIDDEN);
    default:
      return fail(GENERIC);
  }
}

async function findDuplicate(
  db: Awaited<ReturnType<typeof requireStaff>>["db"],
  input: { name: string; abn: string | null; excludeId: string | null },
): Promise<{ id: string; name: string; reason: "name" | "abn" } | null> {
  const key = normaliseName(input.name);
  if (input.abn) {
    const { data, error } = await db.from("contractor_directory").select("id, business_name").eq("abn", input.abn).limit(2);
    if (error) console.error("[hq] duplicate ABN check failed:", logTag(error));
    const hit = (data ?? []).find((c) => c.id && c.id !== input.excludeId);
    if (hit?.id && hit.business_name) return { id: hit.id, name: hit.business_name, reason: "abn" };
  }
  if (key) {
    const firstWord = key.split(" ")[0].replace(/[^\p{L}\p{N}]/gu, "");
    const q = db.from("contractor_directory").select("id, business_name").limit(200);
    const { data, error } = await (firstWord ? q.ilike("business_name", `*${firstWord}*`) : q);
    if (error) console.error("[hq] duplicate name check failed:", logTag(error));
    const hit = (data ?? []).find((c) => c.id && c.id !== input.excludeId && c.business_name && normaliseName(c.business_name) === key);
    if (hit?.id && hit.business_name) return { id: hit.id, name: hit.business_name, reason: "name" };
  }
  return null;
}

// ── verification ─────────────────────────────────────────────

/** "Mark as verified": a person has checked these details. The database stamps who and when. */
export async function markContractorVerified(formData: FormData): Promise<void> {
  const { db } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  if (!id) redirect(withToast(PARTNERS, NOT_FOUND, "error"));

  const res = await db.from("contractors").update({ needs_verification: false }).eq("id", id).is("deleted_at", null).select("id");
  if (res.error || !res.data || res.data.length === 0) {
    console.error("[hq] markContractorVerified failed:", logTag(res.error));
    redirect(withToast(`${PARTNERS}/${id}`, "We couldn't mark that as verified.", "error"));
  }
  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, "Marked as verified"));
}

// ── log contact ──────────────────────────────────────────────

const DONE_MESSAGE: Record<InteractionType, string> = {
  phone_call: "Call logged",
  coffee_meeting: "Meeting logged",
  office_meeting: "Meeting logged",
  email: "Email logged",
  message: "Message logged",
  note: "Note added",
};

export async function recordContractorContact(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("contractors.write");
  const { reader: f, values: v } = readContactForm(formData, { timezone: staff.timezone, staffId: staff.id, canCreateTasks: can("tasks.write") });
  const retained = retainedValues(formData);
  if (!f.ok) return failWith(f.fail(), retained);

  const { data, error } = await db.rpc("record_contractor_contact", {
    p_contractor: v.contractorId,
    p_type: v.type,
    p_occurred_at: v.occurredAt.toISOString(),
    p_summary: v.summary,
    p_next_action: v.nextAction ?? undefined,
    p_follow_up_date: v.followUpDate ?? undefined,
    p_create_task: v.createTask,
    p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
    p_new_status: v.markContacted ? "contacted" : undefined,
  });
  if (error) {
    console.error("[hq] record_contractor_contact failed:", logTag(error));
    const kind = classifyContractorError(error);
    if (kind === "permission") return failWith(fail(FORBIDDEN), retained);
    if (kind === "not_found") return failWith(fail(NOT_FOUND), retained);
    const text = (error.message ?? "").toLowerCase();
    if (kind === "invalid" && text.includes("assignee")) return failWith(fail("Nothing was saved, so no call or task was recorded.", { task_assignee: "Choose an active member of staff." }), retained);
    return failWith(fail("We couldn't log that. Nothing was saved. Try again in a moment."), retained);
  }

  const result = (data ?? {}) as { task_id?: string | null };
  const done = DONE_MESSAGE[v.type] ?? `${INTERACTION_LABEL[v.type]} logged`;
  refresh(v.contractorId);
  if (result.task_id) revalidatePath(`${HQ_BASE}/operations`);
  redirect(withToast(`${PARTNERS}/${v.contractorId}`, result.task_id ? `${done} and follow-up task created` : done));
}

// ── status ───────────────────────────────────────────────────

function readIdAndNote(formData: FormData, opts: { noteRequired: boolean }) {
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const note = opts.noteRequired ? f.requiredText("note", { max: 1000, label: "A note" }) : f.text("note", { max: 1000, label: "The note" });
  return { f, id, note };
}

/** Why a status RPC refused, in words a person can act on. Matched, never shown raw. */
function statusFailure(error: DbErr, ctx: "approve" | "suspend" | "reinstate" | "move"): ActionState {
  const kind = classifyContractorError(error);
  const text = (error?.message ?? "").toLowerCase();
  if (kind === "permission") {
    return fail(ctx === "approve" || ctx === "reinstate" ? "Only a director or administrator can do that." : FORBIDDEN);
  }
  if (kind === "not_found") return fail(NOT_FOUND);
  if (ctx === "approve" && kind === "refused") {
    if (text.includes("checklist")) return fail("The vetting checklist is not complete, so this contractor can't be approved yet. Nothing was changed.");
    if (text.includes("suspended")) return fail("This contractor is suspended. Reinstate them first. Nothing was changed.");
    if (text.includes("inactive")) return fail("This contractor is inactive. Move them back to vetting first. Nothing was changed.");
  }
  if (ctx === "reinstate" && (kind === "invalid" || kind === "refused")) return fail("Only a suspended contractor can be reinstated. Nothing was changed.");
  return fail(GENERIC);
}

export async function approveContractor(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.approve");
  const { f, id, note } = readIdAndNote(formData, { noteRequired: true });
  const preferred = new FormReader(formData).bool("make_preferred");
  if (!id || !f.ok) return fail("Add a note to approve this contractor.", { ...f.errors, note: f.errors.note ?? "Say why you are approving them: what you checked, and who with." });

  const { data, error } = await db.rpc("approve_contractor", { p_contractor: id, p_make_preferred: preferred, p_note: note ?? undefined });
  if (error) {
    console.error("[hq] approve_contractor failed:", logTag(error));
    return statusFailure(error, "approve");
  }
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, !changed ? "Nothing changed" : preferred ? "Contractor approved as preferred" : "Contractor approved", changed ? "success" : "info"));
}

export async function suspendContractor(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const { f, id, note } = readIdAndNote(formData, { noteRequired: true });
  if (!id || !f.ok) return fail("Say why you are suspending them.", { note: f.errors.note ?? "A reason is required." });

  const { error } = await db.rpc("set_contractor_status", { p_contractor: id, p_status: "suspended", p_note: note ?? undefined });
  if (error) {
    console.error("[hq] suspend (set_contractor_status) failed:", logTag(error));
    return statusFailure(error, "suspend");
  }
  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, "Contractor suspended"));
}

export async function reinstateContractor(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.approve");
  const { f, id, note } = readIdAndNote(formData, { noteRequired: false });
  if (!id || !f.ok) return fail("That contractor could not be reinstated.", f.errors);

  const { error } = await db.rpc("reinstate_contractor", { p_contractor: id, p_note: note ?? undefined });
  if (error) {
    console.error("[hq] reinstate_contractor failed:", logTag(error));
    return statusFailure(error, "reinstate");
  }
  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, "Contractor reinstated and returned to vetting"));
}

export async function changeContractorStatus(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.write");
  const { f, id, note } = readIdAndNote(formData, { noteRequired: false });
  const target = f.oneOf("status", MOVE_TARGETS, { required: true });
  if (!id || !target || !f.ok) return fail("That change could not be made.", f.errors);

  const { data, error } = await db.rpc("set_contractor_status", { p_contractor: id, p_status: target, p_note: note ?? undefined });
  if (error) {
    console.error("[hq] set_contractor_status failed:", logTag(error));
    return statusFailure(error, "move");
  }
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  refresh(id);
  redirect(withToast(`${PARTNERS}/${id}`, changed ? "Status updated" : "Nothing changed", changed ? "success" : "info"));
}

// ── archive ──────────────────────────────────────────────────

/** Archives a contractor through hq.archive_record (soft delete: history and documents are kept). */
export async function archiveContractor(formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("contractors.approve");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const reason = f.text("reason", { max: 200, label: "The reason" });
  if (!id || !f.ok) return fail("That contractor could not be archived.", f.errors);
  if (!isUuid(id)) return fail("That contractor could not be archived.");

  const { error } = await db.rpc("archive_record", { p_entity: "contractor", p_id: id, p_reason: reason ?? undefined });
  if (error) {
    console.error("[hq] archiveContractor failed:", logTag(error));
    const kind = classifyContractorError(error);
    if (kind === "permission") return fail(FORBIDDEN);
    if (kind === "not_found") return fail("That contractor could not be found. It may already be archived.");
    return fail("We couldn't archive this contractor. Nothing was changed.");
  }
  refresh(id);
  redirect(withToast(PARTNERS, "Contractor archived"));
}

// ── record a job ("last used") ───────────────────────────────

/** Where "Record a job" may send the person back to: the profile or the Trades page, nothing else. */
function jobReturnTo(raw: string | null, id: string): string {
  const trades = `${PARTNERS}/trades`;
  if (raw && (raw === trades || raw.startsWith(`${trades}?`)) && /^[\w/?=&%.,-]*$/.test(raw)) return raw;
  return `${PARTNERS}/${id}`;
}

/**
 * Records that a contractor was used: last_job_date (recorded by staff; HQ is not connected to Ailo),
 * through hq.mark_contractor_used. Default today in the person's timezone; never in the future; an
 * earlier date than the one recorded needs the explicit "move it back" tick (the database refuses it
 * otherwise).
 */
export async function recordContractorJob(formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("contractors.write");
  const f = new FormReader(formData);
  const id = f.uuid("id", { required: true });
  const jobDate = f.date("job_date") ?? todayInZone(staff.timezone);
  const allowEarlier = f.bool("allow_earlier");
  const returnTo = id ? jobReturnTo(f.text("return_to", { max: 300 }), id) : PARTNERS;
  if (!id || !f.ok) return fail("That job could not be recorded.", f.errors);
  if (jobDate > todayInZone(staff.timezone)) return fail("Nothing was recorded.", { job_date: "The job date can't be in the future." });

  const { data, error } = await db.rpc("mark_contractor_used", { p_contractor: id, p_job_date: jobDate, p_allow_earlier: allowEarlier });
  if (error) {
    console.error("[hq] mark_contractor_used failed:", logTag(error));
    const kind = classifyContractorError(error);
    if (kind === "permission") return fail(FORBIDDEN);
    if (kind === "not_found") return fail(NOT_FOUND);
    if (kind === "refused") return fail("Nothing was recorded.", { job_date: "That is earlier than the last job already recorded. Tick the box to move the date back, or choose a later date." });
    if (kind === "invalid") return fail("Nothing was recorded.", { job_date: "Choose a date that is today or earlier." });
    return fail(GENERIC);
  }
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  refresh(id);
  revalidatePath(`${PARTNERS}/trades`);
  redirect(withToast(returnTo, changed ? "Job recorded" : "That date was already recorded", changed ? "success" : "info"));
}
