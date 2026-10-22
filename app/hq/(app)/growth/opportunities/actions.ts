"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { todayIn } from "@/lib/hq/format";
import { logTag } from "@/lib/hq/growth/db-errors";
import { retainedValues } from "@/lib/hq/growth/retain";
import { readLeadActivityForm, readLeadDetailsForm } from "@/lib/hq/leads/forms";
import { addDaysIso, checkFollowUp, classifyLeadError, duplicateReasonText, leadFieldError, parseDuplicate, readLeadFields, type LeadDbError } from "@/lib/hq/leads/rules";
import { safeNextPath } from "@/lib/hq/next-path";
import { SNOOZE_DAYS } from "@/lib/hq/today";

/*
 * Server Actions for leads (opportunities): add a lead, change its next step or details, log a call
 * or note on it, snooze its follow-up from Today. Each is reachable by a direct POST, so each starts
 * with requireStaff("growth.write") and the DATABASE decides again (hq.create_opportunity,
 * hq.update_opportunity, hq.log_opportunity_activity: capability, MFA, every rule). Identity comes
 * from the session, never from the form. Messages are generic and field-level; the log gets the
 * error code only, never a name, phone number, email or note.
 *
 * Stage moves (including lost, with its reason code) and signing stay in the referrals action
 * moveStage (hq.move_opportunity), shared with the pipeline board.
 */

const GROWTH = `${HQ_BASE}/growth`;
const PIPELINE = `${GROWTH}/pipeline`;
const LEADS = `${GROWTH}/opportunities`;

const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const CHECK = "Please check the highlighted fields and try again.";

function withValues(base: ActionState, formData: FormData, extra: Record<string, unknown> = {}): ActionState {
  return { ...base, data: { values: retainedValues(formData), ...extra } };
}

function refresh(id?: string) {
  revalidatePath(HQ_BASE);
  revalidatePath(GROWTH);
  revalidatePath(PIPELINE);
  if (id) revalidatePath(`${LEADS}/${id}`);
}

/** A refusal in words: a field error when it belongs to one, otherwise a sentence. */
function failure(error: LeadDbError, fallback = GENERIC): ActionState {
  const kind = classifyLeadError(error);
  if (kind === "permission") return fail(FORBIDDEN);
  if (kind === "not_found") return fail("That lead could not be found. It may have been archived.");
  if (kind === "contact_not_found") return fail("That contact could not be found. It may have been archived.");
  if (kind === "stale") return fail("Someone else changed this lead a moment ago. Reload the page and try again.");
  const field = leadFieldError(kind);
  if (field) return fail(CHECK, { [field.field]: field.message });
  return fail(fallback);
}

// ── add a lead ───────────────────────────────────────────────

export async function createLead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const v = readLeadFields(f, { today: todayIn(staff.timezone), staffId: staff.id });
  if (!f.ok || !v.source || !v.nextActionDue) return withValues(f.fail(), formData);

  const { data, error } = await db.rpc("create_opportunity", {
    p_prospect_name: v.prospectName,
    p_prospect_phone: v.prospectPhone ?? undefined,
    p_prospect_email: v.prospectEmail ?? undefined,
    p_property_suburb: v.propertySuburb ?? undefined,
    p_property_address: v.propertyAddress ?? undefined,
    p_source: v.source,
    p_assigned_to: v.assignedTo ?? undefined,
    p_next_action: v.nextAction,
    p_next_action_due: v.nextActionDue,
    p_expected_close_date: v.expectedCloseDate ?? undefined,
    p_estimated_annual_value_cents: v.estimateCents ?? undefined,
    p_notes: v.notes ?? undefined,
    p_create_contact: true,
    p_confirm_distinct: v.confirmDistinct,
  });
  if (error) {
    console.error("[hq] create_opportunity failed:", logTag(error));
    if (classifyLeadError(error) === "duplicate") {
      const dup = parseDuplicate(error.details);
      const href = dup ? (dup.kind === "opportunity" ? `${LEADS}/${dup.id}` : `${GROWTH}/contacts/${dup.id}`) : null;
      return withValues(
        fail(
          dup
            ? `A ${dup.kind === "opportunity" ? "lead" : "landlord"} with ${duplicateReasonText(dup.reason)} is already in HQ. Open it to check, or tick "This is someone else" and save again.`
            : 'A lead or landlord with these details is already in HQ. Tick "This is someone else" and save again if it is a different person.',
        ),
        formData,
        { duplicate: href ? { href, kind: dup?.kind ?? "opportunity" } : null },
      );
    }
    return withValues(failure(error), formData);
  }
  const out = (data ?? {}) as { opportunity_id?: unknown; ref?: unknown };
  const id = typeof out.opportunity_id === "string" ? out.opportunity_id : "";
  if (!isUuid(id)) return withValues(fail("We couldn't confirm that was saved. Check the pipeline before trying again."), formData);
  refresh(id);
  redirect(withToast(`${LEADS}/${id}`, `Lead added${typeof out.ref === "string" ? ` (${out.ref})` : ""}`));
}

// ── the next step: owner, next action, follow-up date ────────

export async function updateLeadNextStep(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const id = f.uuid("opportunity_id", { required: true, label: "The lead" });
  const version = f.text("version", { max: 64 });
  const assignedTo = f.uuid("assigned_to");
  const nextAction = f.requiredText("next_action", { max: 300, label: "The next action" });
  const due = checkFollowUp(f, "next_action_due", todayIn(staff.timezone), true);
  if (!f.ok || !id || !due) return withValues(f.fail(), formData);

  const { data, error } = await db.rpc("update_opportunity", {
    p_opportunity: id,
    p_assigned_to: assignedTo ?? undefined,
    p_next_action: nextAction,
    p_next_action_due: due,
    p_expected_updated_at: version ?? undefined,
  });
  if (error) {
    console.error("[hq] update_opportunity (next step) failed:", logTag(error));
    return withValues(failure(error), formData);
  }
  refresh(id);
  const changed = (data as { changed?: unknown } | null)?.changed !== false;
  redirect(withToast(`${LEADS}/${id}`, changed ? "Next step saved" : "Nothing changed", changed ? "success" : "info"));
}

// ── the lead's details ───────────────────────────────────────

export async function updateLeadDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const idReader = new FormReader(formData);
  const id = idReader.uuid("opportunity_id", { required: true, label: "The lead" });
  if (!id) return withValues(idReader.fail(), formData);

  const current = await db
    .from("opportunities")
    .select("id, updated_at, prospect_phone, prospect_email, property_suburb, property_address, expected_close_date, estimated_annual_value_cents, notes, source")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (current.error) {
    console.error("[hq] updateLeadDetails read failed:", logTag(current.error));
    return withValues(fail(GENERIC), formData);
  }
  if (!current.data) return withValues(fail("That lead could not be found. It may have been archived."), formData);
  const c = current.data;

  const { reader: f, values: v } = readLeadDetailsForm(formData, { today: todayIn(staff.timezone), currentClose: c.expected_close_date });
  if (!f.ok) return withValues(f.fail(), formData);

  // Patch: send what is given; clear what was emptied.
  const clear: string[] = [];
  if (!v.prospectPhone && c.prospect_phone) clear.push("prospect_phone");
  if (!v.prospectEmail && c.prospect_email) clear.push("prospect_email");
  if (!v.propertySuburb && c.property_suburb) clear.push("property_suburb");
  if (!v.propertyAddress && c.property_address) clear.push("property_address");
  if (!v.expectedCloseDate && c.expected_close_date) clear.push("expected_close_date");
  if (v.estimateCents === null && c.estimated_annual_value_cents !== null) clear.push("estimated_annual_value");
  if (!v.notes && c.notes) clear.push("notes");

  const { data, error } = await db.rpc("update_opportunity", {
    p_opportunity: id,
    p_prospect_name: v.prospectName ?? undefined,
    p_prospect_phone: v.prospectPhone ?? undefined,
    p_prospect_email: v.prospectEmail ?? undefined,
    p_property_suburb: v.propertySuburb ?? undefined,
    p_property_address: v.propertyAddress ?? undefined,
    p_source: v.source && v.source !== c.source ? v.source : undefined,
    p_expected_close_date: v.expectedCloseDate ?? undefined,
    p_estimated_annual_value_cents: v.estimateCents ?? undefined,
    p_notes: v.notes ?? undefined,
    p_clear: clear.length ? clear : undefined,
    p_expected_updated_at: c.updated_at,
  });
  if (error) {
    console.error("[hq] update_opportunity (details) failed:", logTag(error));
    return withValues(failure(error), formData);
  }
  refresh(id);
  const changed = (data as { changed?: unknown } | null)?.changed !== false;
  redirect(withToast(`${LEADS}/${id}`, changed ? "Lead updated" : "Nothing changed", changed ? "success" : "info"));
}

// ── log a call, meeting or note on a lead ────────────────────

export async function logLeadActivity(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("growth.write");
  const idReader = new FormReader(formData);
  const id = idReader.uuid("opportunity_id", { required: true, label: "The lead" });
  if (!id) return withValues(idReader.fail(), formData);
  const back = safeNextPath(formData.get("return_to"), `${LEADS}/${id}`);

  const { reader: f, values: v } = readLeadActivityForm(formData, { timezone: staff.timezone, today: todayIn(staff.timezone), staffId: staff.id, canCreateTasks: can("tasks.write") });
  if (!f.ok) return withValues(f.fail(), formData);

  const { data, error } = await db.rpc("log_opportunity_activity", {
    p_opportunity: id,
    p_type: v.type,
    p_occurred_at: v.occurredAt.toISOString(),
    p_summary: v.summary,
    p_next_action: v.nextAction ?? undefined,
    p_next_action_due: v.nextActionDue ?? undefined,
    p_create_task: v.createTask,
    p_task_assignee: v.createTask ? (v.taskAssignee ?? undefined) : undefined,
    p_outcome: v.outcome ?? undefined,
    p_callback_promised: v.callbackPromised,
  });
  if (error) {
    console.error("[hq] log_opportunity_activity failed:", logTag(error));
    const kind = classifyLeadError(error);
    if (kind === "future") return withValues(fail(CHECK, { occurred_at: "The time can't be in the future." }), formData);
    if (kind === "task_assignee_inactive") return withValues(fail(CHECK, { task_assignee: "Choose an active member of staff." }), formData);
    return withValues(failure(error, "We couldn't log that. Nothing was saved. Try again in a moment."), formData);
  }
  refresh(id);
  const task = (data as { task_id?: unknown } | null)?.task_id;
  redirect(withToast(back, typeof task === "string" ? "Logged, and the follow-up task was created" : "Logged"));
}

// ── snooze a lead's follow-up (Today) ────────────────────────

/** Moves a lead's follow-up date a week on from today. A form action with no state: it redirects back with a toast. */
export async function snoozeLeadAction(formData: FormData): Promise<void> {
  const { db, staff } = await requireStaff("growth.write");
  const back = safeNextPath(formData.get("next"), HQ_BASE);
  const f = new FormReader(formData);
  const id = f.uuid("opportunityId", { required: true });
  if (!f.ok || !id) redirect(withToast(back, "We could not snooze that follow-up.", "error"));
  const next = addDaysIso(todayIn(staff.timezone), SNOOZE_DAYS);
  const { error } = await db.rpc("update_opportunity", { p_opportunity: id, p_next_action_due: next });
  if (error) {
    console.error("[hq] snooze lead failed:", logTag(error));
    const kind = classifyLeadError(error);
    redirect(withToast(back, kind === "permission" ? FORBIDDEN : kind === "not_found" ? "That lead is no longer available to you." : "We could not snooze that follow-up. Try again in a moment.", "error"));
  }
  refresh(id);
  redirect(withToast(back, "Snoozed for a week."));
}
