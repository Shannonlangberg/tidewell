"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/hq/constants";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { classifyDbError, logTag } from "@/lib/hq/tasks/db-errors";
import { safeReturnPath } from "@/lib/hq/tasks/return-path";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { canTransition, isTaskStatus, readTaskFields } from "@/lib/hq/tasks/rules";
import type { TaskActionResult } from "@/lib/hq/tasks/types";
import { staffNames } from "@/lib/hq/tasks/queries";
import { checkTaskReferences } from "@/lib/hq/tasks/write";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for tasks. They are reachable by a direct POST, so every one of them:
 *   1. calls requireStaff("tasks.write") FIRST (a read-only person's forged request is
 *      redirected out before anything is read or written),
 *   2. takes the person's identity from the session, never from the request (created_by,
 *      completed_by and deleted_by are stamped by the database),
 *   3. validates every input on the server (uuids, enums, lengths, dates),
 *   4. runs as the signed-in person, so row level security still applies to every query.
 * Errors shown to people are generic and field-level; only error CODES are logged.
 *
 *   createTask        tasks.write   new task (source = 'manual')
 *   updateTask        tasks.write   edit fields and reassign (not status)
 *   changeTaskStatus  tasks.write   complete, reopen, start, wait, cancel (allowed transitions only)
 *   archiveTask       tasks.write   soft delete through hq.archive_record (the database decides who may)
 */

const OPERATIONS = `${HQ_BASE}/operations`;
const TASKS = `${OPERATIONS}/tasks`;

const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That task could not be found. It may have been archived.";

function failWith(base: ActionState, retained: Record<string, string>): ActionState {
  return { ...base, data: { values: retained } };
}

/** Everything that shows tasks: the list, the task, the dashboard, search. */
function refreshTasks(id?: string) {
  revalidatePath(OPERATIONS);
  if (id) revalidatePath(`${TASKS}/${id}`);
  revalidatePath(HQ_BASE);
  revalidatePath(`${HQ_BASE}/search`);
}

// ── create ───────────────────────────────────────────────────

export async function createTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, can } = await requireStaff("tasks.write");
  const reader = new FormReader(formData);
  const values = readTaskFields(reader);
  const retained = retainedValues(formData);
  if (!reader.ok) return failWith(reader.fail(), retained);

  const checked = await checkTaskReferences(db, values, { canLink: can("growth.read"), canLinkContractors: can("contractors.read") });
  if (checked.ok === "error") return failWith(fail(GENERIC), retained);
  if (checked.ok === false) return failWith(fail("Please check the highlighted fields and try again.", checked.fieldErrors), retained);

  // created_by is NOT sent: the database stamps the caller. source is always 'manual' here.
  const { data, error } = await db
    .from("tasks")
    .insert({
      title: values.title,
      description: values.description,
      due_date: values.dueDate,
      priority: values.priority,
      status: "to_do",
      assigned_to: values.assignedTo,
      related_contact_id: values.contactId,
      related_organisation_id: values.organisationId,
      related_referral_id: values.referralId,
      related_opportunity_id: values.opportunityId,
      related_contractor_id: values.contractorId,
      source: "manual",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[hq] createTask failed:", logTag(error));
    const kind = classifyDbError(error);
    return failWith(fail(kind === "permission" ? FORBIDDEN : kind === "foreign_key" ? "A person or record you chose no longer exists. Reload the page and try again." : GENERIC), retained);
  }

  refreshTasks(data.id);
  const returnTo = safeReturnPath(formData.get("return"));
  redirect(withToast(returnTo ?? `${TASKS}/${data.id}`, "Task created"));
}

// ── edit ─────────────────────────────────────────────────────

export async function updateTask(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("tasks.write");
  const retained = retainedValues(formData);

  const idRaw = formData.get("id");
  const id = typeof idRaw === "string" && isUuid(idRaw) ? idRaw.toLowerCase() : null;
  if (!id) return failWith(fail(NOT_FOUND), retained);
  const versionRaw = formData.get("version");
  const version = typeof versionRaw === "string" && versionRaw !== "" ? versionRaw.slice(0, 64) : null;

  const reader = new FormReader(formData);
  const values = readTaskFields(reader);
  if (!reader.ok) return failWith(reader.fail(), retained);

  // The task must exist, be live, and be visible to this person (otherwise this is a not found, never a leak).
  const found = await db.from("tasks").select("id, created_by, assigned_to").eq("id", id).is("deleted_at", null).maybeSingle();
  if (found.error) {
    console.error("[hq] updateTask load failed:", logTag(found.error));
    return failWith(fail(GENERIC), retained);
  }
  if (!found.data) return failWith(fail(NOT_FOUND), retained);

  // A task can only be handed to someone else by the person who created it or by someone who can see
  // every task. The database enforces this too (the changed row would no longer be visible to an
  // assignee who is neither, so the update is refused), but this says why, beside the field.
  const mayHandOver = found.data.created_by === staff.id || can("tasks.read_all");
  if (!mayHandOver && values.assignedTo !== staff.id) {
    return failWith(
      fail("Please check the highlighted fields and try again.", {
        assigned_to: "Only the person who created this task, or someone who can see everyone's tasks, can give it to someone else.",
      }),
      retained,
    );
  }

  const canLink = can("growth.read");
  const canLinkContractors = can("contractors.read");
  const checked = await checkTaskReferences(db, values, { canLink, canLinkContractors });
  if (checked.ok === "error") return failWith(fail(GENERIC), retained);
  if (checked.ok === false) return failWith(fail("Please check the highlighted fields and try again.", checked.fieldErrors), retained);

  const update = {
    title: values.title,
    description: values.description,
    due_date: values.dueDate,
    priority: values.priority,
    assigned_to: values.assignedTo,
    // Linked records are only touched by someone who can see them: without growth.read the
    // form has no pickers, and a missing field must not unlink anything.
    ...(canLink
      ? {
          related_contact_id: values.contactId,
          related_organisation_id: values.organisationId,
          related_referral_id: values.referralId,
          related_opportunity_id: values.opportunityId,
        }
      : {}),
    // Likewise the contractor link: only someone with contractors.read has the picker, so only they change it.
    ...(canLinkContractors ? { related_contractor_id: values.contractorId } : {}),
  };

  // No RETURNING: if the person reassigns a task they neither created nor may read in full, the
  // new row is no longer visible to them, and a RETURNING select would be refused for that.
  let q = db.from("tasks").update(update, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (version) q = q.eq("updated_at", version);
  const { error, count } = await q;
  if (error) {
    console.error("[hq] updateTask failed:", logTag(error));
    const kind = classifyDbError(error);
    return failWith(fail(kind === "permission" ? FORBIDDEN : kind === "foreign_key" ? "A person or record you chose no longer exists. Reload the page and try again." : GENERIC), retained);
  }
  if (!count) {
    return failWith(
      fail(version ? "This task was changed by someone else while you were editing. Reload the page to see their changes, then edit again." : NOT_FOUND),
      retained,
    );
  }

  refreshTasks(id);
  // The person who made the change can always still see the task (see mayHandOver above), so the task page is always where they land.
  let message = "Task saved";
  if (values.assignedTo !== found.data.assigned_to) {
    const names = await staffNames(db, [values.assignedTo]);
    const who = values.assignedTo ? names.get(values.assignedTo) : null;
    message = values.assignedTo === null ? "Task saved and unassigned" : who ? `Task saved and assigned to ${who}` : "Task saved";
  }
  redirect(withToast(`${TASKS}/${id}`, message));
}

// ── status: complete, reopen, start, wait, cancel ────────────

function statusMessage(from: TaskStatus, to: TaskStatus): string {
  if (to === "completed") return "Task completed";
  if (to === "cancelled") return "Task cancelled";
  if (from === "completed" || from === "cancelled") return "Task reopened";
  return `Task marked ${TASK_STATUS_LABEL[to].toLowerCase()}`;
}

/**
 * Moves a task to a new status. Called directly (not as a form post) by the quick tick on the
 * list and by the status control on the task, so it returns a result for a toast instead of
 * redirecting. completed_at / completed_by are stamped (or cleared) by the database.
 */
export async function changeTaskStatus(taskId: string, to: string): Promise<TaskActionResult> {
  const { db } = await requireStaff("tasks.write");
  if (typeof taskId !== "string" || !isUuid(taskId)) return { ok: false, message: NOT_FOUND };
  const id = taskId.toLowerCase();
  if (!isTaskStatus(to)) return { ok: false, message: "Choose one of the statuses." };

  const found = await db.from("tasks").select("status").eq("id", id).is("deleted_at", null).maybeSingle();
  if (found.error) {
    console.error("[hq] changeTaskStatus load failed:", logTag(found.error));
    return { ok: false, message: GENERIC };
  }
  if (!found.data) return { ok: false, message: NOT_FOUND };

  const from = found.data.status;
  // A second tap on the same button (or two people at once) is not a failure.
  if (from === to) return { ok: true, message: `Task is already ${TASK_STATUS_LABEL[to].toLowerCase()}` };
  if (!canTransition(from, to)) {
    return { ok: false, message: `A task that is ${TASK_STATUS_LABEL[from].toLowerCase()} can't be marked ${TASK_STATUS_LABEL[to].toLowerCase()}. ${from === "completed" || from === "cancelled" ? "Reopen it first." : ""}`.trim() };
  }

  // The `eq("status", from)` makes this a compare-and-set: if someone else moved it in the meantime, nothing changes.
  const { error, count } = await db.from("tasks").update({ status: to }, { count: "exact" }).eq("id", id).eq("status", from).is("deleted_at", null);
  if (error) {
    console.error("[hq] changeTaskStatus failed:", logTag(error));
    return { ok: false, message: classifyDbError(error) === "permission" ? FORBIDDEN : GENERIC };
  }
  if (!count) return { ok: false, message: "This task was just changed by someone else. Reload to see the latest." };

  refreshTasks(id);
  return { ok: true, message: statusMessage(from, to) };
}

// ── archive ──────────────────────────────────────────────────

/**
 * Archives (soft deletes) a task through hq.archive_record. The database decides who may: the
 * task's creator or assignee holding tasks.write, anyone holding tasks.read_all with tasks.write,
 * and anyone with growth.delete. Posted from a ConfirmDialog, so it redirects with a toast.
 */
export async function archiveTask(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const raw = formData.get("id");
  const id = typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
  if (!id) redirect(withToast(OPERATIONS, NOT_FOUND, "error"));

  const { error } = await db.rpc("archive_record", { p_entity: "task", p_id: id, p_reason: "Archived from the task page" });
  if (error) {
    console.error("[hq] archiveTask failed:", logTag(error));
    const kind = classifyDbError(error);
    if (kind === "not_found") redirect(withToast(OPERATIONS, NOT_FOUND, "error"));
    redirect(withToast(`${TASKS}/${id}`, kind === "permission" ? "You can't archive this task." : GENERIC, "error"));
  }
  refreshTasks(id);
  redirect(withToast(OPERATIONS, "Task archived"));
}
