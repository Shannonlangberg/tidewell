"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { FormReader, fail, isUuid, succeed, type ActionState } from "@/lib/hq/forms";
import { GOAL_MAX, HANDOVER_STEPS, HANDOVER_STEP_STATUSES, NOTE_MAX, readPropertyFields } from "@/lib/hq/portfolio/rules";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for the portfolio. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff(<capability>) FIRST (a reader's forged request is redirected out before
 *      anything is read or written): portfolio.write for properties and steps, settings.admin for
 *      the goal;
 *   2. takes identity from the session only (the database stamps created_by, completed_by and the
 *      audit actor);
 *   3. validates every input on the server (FormReader + the portfolio rules);
 *   4. writes ONLY through the hq RPCs (convert_to_managed_property, add_existing_managed_property,
 *      update_managed_property, set_handover_step, set_business_goal, archive_record /
 *      restore_record), which check the capability again and write the audit trail.
 * People see plain messages; only error codes are logged.
 */

const PORTFOLIO = `${HQ_BASE}/portfolio`;
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That property could not be found. It may have been archived.";
const CHECK = "Please check the highlighted fields and try again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

/** The RPCs' own messages are plain English and name no record values beyond an MP number; show them for rule refusals only. */
function messageFor(error: DbError): string {
  const code = error?.code ?? "";
  if (code === "42501") return FORBIDDEN;
  if (code === "P0002" || code === "PGRST116") return NOT_FOUND;
  if ((code === "22023" || code === "23514" || code === "23505") && error?.message && !/violates|constraint|relation/i.test(error.message)) {
    const m = error.message.trim();
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
  }
  if (code === "23505") return "That address or Ailo reference is already recorded on another property.";
  return GENERIC;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(PORTFOLIO);
  if (id) revalidatePath(`${PORTFOLIO}/${id}`);
  revalidatePath(`${HQ_BASE}/reports`);
  revalidatePath(HQ_BASE);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

type RpcProperty = { managed_property_id?: string; ref?: string; changed?: boolean };

// ── create: from a signed opportunity ────────────────────────

export async function convertToManagedProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("portfolio.write");
  const opportunityId = idFrom(formData, "opportunity_id");
  if (!opportunityId) return withValues(fail("Choose the signed opportunity this property comes from."), formData);
  const reader = new FormReader(formData);
  const v = readPropertyFields(reader, todayIn(staff.timezone), "convert");
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("convert_to_managed_property", {
    p_opportunity_id: opportunityId,
    p_service_type: v.serviceType!,
    p_property_address: v.propertyAddress ?? undefined,
    p_suburb: v.suburb ?? undefined,
    p_owner_contact_id: v.ownerContactId ?? undefined,
    p_owner_name: v.ownerName ?? undefined,
    p_fee_basis: v.feeBasis ?? undefined,
    p_fee_percent: v.feePercent ?? undefined,
    p_fee_notes: v.feeNotes ?? undefined,
    p_agreement_signed_on: v.agreementSignedOn ?? undefined,
    p_managed_from: v.managedFrom ?? undefined,
    p_status: v.status ?? undefined,
    p_ailo_reference: v.ailoReference ?? undefined,
    p_notes: v.notes ?? undefined,
  });
  const out = data as RpcProperty | null;
  if (error || !out?.managed_property_id) {
    logged("convertToManagedProperty", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(out.managed_property_id);
  revalidatePath(`${HQ_BASE}/growth/opportunities/${opportunityId}`);
  redirect(withToast(`${PORTFOLIO}/${out.managed_property_id}`, `${out.ref ?? "Property"} is now a managed property`));
}

// ── create: signed before HQ ─────────────────────────────────

export async function addExistingProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("portfolio.write");
  const reader = new FormReader(formData);
  const v = readPropertyFields(reader, todayIn(staff.timezone), "manual");
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("add_existing_managed_property", {
    p_manual_origin_note: v.manualOriginNote!,
    p_property_address: v.propertyAddress!,
    p_service_type: v.serviceType!,
    p_suburb: v.suburb ?? undefined,
    p_owner_contact_id: v.ownerContactId ?? undefined,
    p_owner_name: v.ownerName ?? undefined,
    p_fee_basis: v.feeBasis ?? undefined,
    p_fee_percent: v.feePercent ?? undefined,
    p_fee_notes: v.feeNotes ?? undefined,
    p_agreement_signed_on: v.agreementSignedOn ?? undefined,
    p_managed_from: v.managedFrom ?? undefined,
    p_status: v.status ?? undefined,
    p_ailo_reference: v.ailoReference ?? undefined,
    p_ailo_status: v.ailoStatus ?? undefined,
    p_notes: v.notes ?? undefined,
  });
  const out = data as RpcProperty | null;
  if (error || !out?.managed_property_id) {
    logged("addExistingProperty", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(out.managed_property_id);
  redirect(withToast(`${PORTFOLIO}/${out.managed_property_id}`, `${out.ref ?? "Property"} recorded`));
}

// ── edit ─────────────────────────────────────────────────────

export async function updateProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("portfolio.write");
  const id = idFrom(formData);
  if (!id) return withValues(fail(NOT_FOUND), formData);
  const versionRaw = formData.get("version");
  const version = typeof versionRaw === "string" && versionRaw !== "" ? versionRaw.slice(0, 64) : null;
  const reader = new FormReader(formData);
  const v = readPropertyFields(reader, todayIn(staff.timezone), "edit");
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  // The edit form shows every field, so blanks clear: "" for text, p_clear for the rest.
  const clear: string[] = [];
  if (!v.ownerContactId) clear.push("owner_contact_id");
  if (!v.feeBasis) clear.push("fee_basis");
  if (v.feePercent === null) clear.push("fee_percent");
  if (!v.agreementSignedOn) clear.push("agreement_signed_on");
  if (!v.managedFrom) clear.push("managed_from");
  if (!v.endedOn) clear.push("ended_on");

  const { data, error } = await db.rpc("update_managed_property", {
    p_id: id,
    p_property_address: v.propertyAddress!,
    p_suburb: v.suburb ?? "",
    p_owner_contact_id: v.ownerContactId ?? undefined,
    p_owner_name: v.ownerName ?? "",
    p_service_type: v.serviceType!,
    p_fee_basis: v.feeBasis ?? undefined,
    p_fee_percent: v.feePercent ?? undefined,
    p_fee_notes: v.feeNotes ?? "",
    p_agreement_signed_on: v.agreementSignedOn ?? undefined,
    p_managed_from: v.managedFrom ?? undefined,
    p_status: v.status ?? undefined,
    p_ended_on: v.endedOn ?? undefined,
    p_ailo_reference: v.ailoReference ?? "",
    p_ailo_status: v.ailoStatus ?? undefined,
    p_notes: v.notes ?? "",
    p_clear: clear,
    p_note: v.note ?? undefined,
    p_expected_updated_at: version ?? undefined,
  });
  if (error) {
    logged("updateProperty", error);
    const stale = error.hint === "managed_property_stale";
    return withValues(fail(stale ? "This property was changed by someone else while you were editing. Reload the page to see their changes, then edit again." : messageFor(error)), formData);
  }
  refresh(id);
  const changed = (data as RpcProperty | null)?.changed !== false;
  redirect(withToast(`${PORTFOLIO}/${id}`, changed ? "Property saved" : "Nothing changed", changed ? "success" : "info"));
}

// ── the handover checklist ───────────────────────────────────

export async function setHandoverStepAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("portfolio.write");
  const id = idFrom(formData, "property_id");
  const reader = new FormReader(formData);
  const step = reader.oneOf("step", HANDOVER_STEPS, { required: true });
  const status = reader.oneOf("status", HANDOVER_STEP_STATUSES, { required: true });
  const note = reader.text("note", { max: NOTE_MAX, label: "The note" });
  if (status === "not_applicable" && !note && !reader.errors.note) reader.errors.note = "Say why this step does not apply.";
  if (!id) return withValues(fail(NOT_FOUND), formData);
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);
  const { error } = await db.rpc("set_handover_step", { p_property_id: id, p_step: step!, p_status: status!, ...(note ? { p_note: note } : {}) });
  if (error) {
    logged("setHandoverStep", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  return succeed("Saved.");
}

// ── archive and restore ──────────────────────────────────────

export async function archiveProperty(formData: FormData): Promise<void> {
  const { db } = await requireStaff("portfolio.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PORTFOLIO, NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_record", { p_entity: "managed_property", p_id: id, p_reason: "Archived from the property page" });
  if (error) {
    logged("archiveProperty", error);
    redirect(withToast(`${PORTFOLIO}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(PORTFOLIO, "Property archived"));
}

export async function restoreProperty(formData: FormData): Promise<void> {
  const { db } = await requireStaff("portfolio.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PORTFOLIO, NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_record", { p_entity: "managed_property", p_id: id });
  if (error) {
    logged("restoreProperty", error);
    redirect(withToast(`${PORTFOLIO}/${id}`, error.code === "23514" ? "Its opportunity is no longer signed, so it cannot be restored. Sign the opportunity again first." : messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${PORTFOLIO}/${id}`, "Property restored"));
}

// ── the goal (directors) ─────────────────────────────────────

export async function setBusinessGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  const reader = new FormReader(formData);
  const raw = reader.requiredText("target", { max: 6, label: "The target" });
  const target = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (raw && (!Number.isInteger(target) || target < 1 || target > GOAL_MAX)) reader.errors.target = `Enter a whole number of properties from 1 to ${GOAL_MAX}.`;
  const date = reader.date("goal_date");
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);
  const { data, error } = await db.rpc("set_business_goal", { p_target: target, ...(date ? { p_date: date } : {}) });
  if (error) {
    logged("setBusinessGoal", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh();
  revalidatePath(`${HQ_BASE}/settings`);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  return succeed(changed ? "Goal saved." : "Nothing changed.");
}
