"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { NOTE_MAX, isClosedStatus, readDecisionFields, type DecisionStatus } from "@/lib/hq/decisions/rules";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for the Decisions register. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff("decisions.write") FIRST (a reader's forged request is redirected out
 *      before anything is read or written),
 *   2. takes identity from the session only (the database stamps created_by, the history's
 *      changed_by and the audit actor),
 *   3. validates every input on the server (FormReader + the decision rules),
 *   4. writes ONLY through the hq RPCs (create_decision, update_decision, supersede_decision,
 *      link/unlink_decision_task, archive_record / restore_record), which check the capability again,
 *      write the history and the audit trail.
 * People see plain messages; only error codes are logged.
 */

const DECISIONS = `${HQ_BASE}/decisions`;
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That decision could not be found. It may have been archived.";
const CHECK = "Please check the highlighted fields and try again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

/** The RPCs' own messages are plain English and name no record values; show them for rule refusals only. */
function messageFor(error: DbError): string {
  const code = error?.code ?? "";
  if (code === "42501") return FORBIDDEN;
  if (code === "P0002" || code === "PGRST116") return NOT_FOUND;
  if ((code === "22023" || code === "23514") && error?.message) {
    const m = error.message.trim();
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
  }
  return GENERIC;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(DECISIONS);
  if (id) revalidatePath(`${DECISIONS}/${id}`);
  revalidatePath(`${HQ_BASE}/reports`);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

// ── create ───────────────────────────────────────────────────

export async function createDecision(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("decisions.write");
  const reader = new FormReader(formData);
  const v = readDecisionFields(reader, todayIn(staff.timezone), { statusRequired: true });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("create_decision", {
    p_title: v.title,
    p_category: v.category!,
    p_decision_date: v.decisionDate!,
    p_status: v.status!,
    p_description: v.description ?? undefined,
    p_rationale: v.rationale ?? undefined,
    p_decision_maker: v.decisionMakerId!,
    p_note: v.note ?? undefined,
  });
  const out = data as { decision_id?: string; ref?: string } | null;
  if (error || !out?.decision_id) {
    logged("createDecision", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(out.decision_id);
  redirect(withToast(`${DECISIONS}/${out.decision_id}`, `Decision ${out.ref ?? ""} recorded`.replace(/\s+/g, " ")));
}

// ── edit ─────────────────────────────────────────────────────

export async function updateDecision(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  if (!id) return withValues(fail(NOT_FOUND), formData);
  const versionRaw = formData.get("version");
  const version = typeof versionRaw === "string" && versionRaw !== "" ? versionRaw.slice(0, 64) : null;

  const cur = await db.from("decisions").select("status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (cur.error) {
    logged("updateDecision load", cur.error);
    return withValues(fail(GENERIC), formData);
  }
  if (!cur.data) return withValues(fail(NOT_FOUND), formData);
  const closed = isClosedStatus(cur.data.status as DecisionStatus);

  const reader = new FormReader(formData);
  const v = readDecisionFields(reader, todayIn(staff.timezone), { statusRequired: !closed });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  // Empty description / rationale are sent as "" so the database clears them (null would leave them).
  const { data, error } = await db.rpc("update_decision", {
    p_decision: id,
    p_title: v.title,
    p_description: v.description ?? "",
    p_rationale: v.rationale ?? "",
    p_category: v.category!,
    p_decision_date: v.decisionDate!,
    p_status: closed ? undefined : v.status!,
    p_decision_maker: v.decisionMakerId!,
    p_note: v.note ?? undefined,
    p_expected_updated_at: version ?? undefined,
  });
  if (error) {
    logged("updateDecision", error);
    const stale = error.hint === "decision_stale";
    return withValues(fail(stale ? "This decision was changed by someone else while you were editing. Reload the page to see their changes, then edit again." : messageFor(error)), formData);
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${DECISIONS}/${id}`, changed ? "Decision saved" : "Nothing changed", changed ? "success" : "info"));
}

// ── supersede and reverse (a note is required for both) ──────

function readNote(formData: FormData): { note: string | null; error: string | null } {
  const raw = formData.get("note");
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { note: null, error: "A note is required." };
  if (note.length > NOTE_MAX) return { note: null, error: `The note must be ${NOTE_MAX} characters or fewer.` };
  return { note, error: null };
}

export async function supersedeDecision(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  if (!id) return fail(NOT_FOUND);
  const target = idFrom(formData, "superseded_by");
  const { note, error: noteError } = readNote(formData);
  const fieldErrors: Record<string, string> = {};
  if (!target) fieldErrors.superseded_by = "Choose the decision that replaces this one.";
  else if (target === id) fieldErrors.superseded_by = "A decision cannot supersede itself.";
  if (noteError) fieldErrors.note = noteError;
  if (Object.keys(fieldErrors).length > 0) return withValues(fail(CHECK, fieldErrors), formData);

  const { error } = await db.rpc("supersede_decision", { p_decision: id, p_superseded_by: target!, p_note: note! });
  if (error) {
    logged("supersedeDecision", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  refresh(target!);
  redirect(withToast(`${DECISIONS}/${id}`, "Decision marked superseded"));
}

export async function reverseDecision(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  if (!id) return fail(NOT_FOUND);
  const { note, error: noteError } = readNote(formData);
  if (noteError) return withValues(fail(CHECK, { note: noteError }), formData);

  const { error } = await db.rpc("update_decision", { p_decision: id, p_status: "reversed", p_note: note! });
  if (error) {
    logged("reverseDecision", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  redirect(withToast(`${DECISIONS}/${id}`, "Decision marked reversed"));
}

// ── tasks ────────────────────────────────────────────────────

export async function linkTask(formData: FormData): Promise<void> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  const task = idFrom(formData, "task_id");
  if (!id) redirect(withToast(DECISIONS, NOT_FOUND, "error"));
  if (!task) redirect(withToast(`${DECISIONS}/${id}`, "Choose a task to link.", "error"));
  const { data, error } = await db.rpc("link_decision_task", { p_decision: id, p_task: task });
  if (error) {
    logged("linkTask", error);
    redirect(withToast(`${DECISIONS}/${id}`, error.code === "P0002" ? "That task could not be found." : messageFor(error), "error"));
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${DECISIONS}/${id}`, changed ? "Task linked" : "That task is already linked", changed ? "success" : "info"));
}

export async function unlinkTask(formData: FormData): Promise<void> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  const task = idFrom(formData, "task_id");
  if (!id || !task) redirect(withToast(DECISIONS, NOT_FOUND, "error"));
  const { error } = await db.rpc("unlink_decision_task", { p_decision: id, p_task: task });
  if (error) {
    logged("unlinkTask", error);
    redirect(withToast(`${DECISIONS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${DECISIONS}/${id}`, "Task unlinked"));
}

// ── archive and restore ──────────────────────────────────────

export async function archiveDecision(formData: FormData): Promise<void> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(DECISIONS, NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_record", { p_entity: "decision", p_id: id, p_reason: "Archived from the decision page" });
  if (error) {
    logged("archiveDecision", error);
    redirect(withToast(`${DECISIONS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(DECISIONS, "Decision archived"));
}

export async function restoreDecision(formData: FormData): Promise<void> {
  const { db } = await requireStaff("decisions.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(DECISIONS, NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_record", { p_entity: "decision", p_id: id });
  if (error) {
    logged("restoreDecision", error);
    redirect(withToast(`${DECISIONS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${DECISIONS}/${id}`, "Decision restored"));
}
