"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader, fail, isIsoDate, isUuid, type ActionState } from "@/lib/hq/forms";
import {
  BLOCKED_REASON_MAX,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_TEXT_MAX,
  COMMENT_MAX,
  NAME_MAX,
  STATUS_NOTE_MAX,
  isProjectStatus,
  readDocumentFields,
  readMilestoneFields,
  readProjectFields,
} from "@/lib/hq/projects/rules";
import type { ProjectActionResult } from "@/lib/hq/projects/types";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for projects, milestones, links, documents and the inline task edits on the
 * project views. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff(capability) FIRST (projects.write for project changes, tasks.write for
 *      task changes): a forged request from someone without it is redirected out before anything,
 *   2. takes identity from the session only (the database stamps every actor),
 *   3. validates every input on the server (FormReader and lib/hq/projects/rules.ts),
 *   4. writes ONLY through the hq RPCs, which check the capability again, apply the task rules
 *      (who may update or reassign a task, one level of subtasks, no dependency cycles), and write
 *      the activity and audit rows. The database is the authority; a refusal is shown plainly.
 * Errors shown are generic or the RPC's own plain message for a rule refusal; only codes are logged.
 */

const PROJECTS = `${HQ_BASE}/projects`;
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That project could not be found. It may have been archived.";
const CHECK = "Please check the highlighted fields and try again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

/** The RPCs' messages are plain English and name no private values; they are shown for rule refusals only. */
function messageFor(error: DbError, notFound = NOT_FOUND): string {
  const code = error?.code ?? "";
  if (code === "42501") return error?.hint === "task_assign_rule" && error.message ? sentence(error.message) : FORBIDDEN;
  if (code === "P0002" || code === "PGRST116") return error?.message && /milestone|parent|task|project/.test(error.message) ? sentence(error.message) : notFound;
  if ((code === "22023" || code === "23514" || code === "23505") && error?.message) return sentence(error.message);
  return GENERIC;
}

function sentence(m: string): string {
  const t = m.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string | null) {
  revalidatePath(PROJECTS);
  if (id) revalidatePath(`${PROJECTS}/${id}`);
  revalidatePath(HQ_BASE);
  revalidatePath(`${HQ_BASE}/operations`);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

function textFrom(formData: FormData, name: string, max: number): string | null {
  const raw = formData.get(name);
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v.slice(0, max) : null;
}

/** Back to the project, keeping the view the person was on (only known views; anything else is dropped). */
function backTo(formData: FormData, id: string): string {
  const raw = formData.get("return_view");
  const view = typeof raw === "string" && ["list", "board", "timeline"].includes(raw) ? raw : null;
  const groupRaw = formData.get("return_group");
  const group = view === "list" && groupRaw === "status" ? "&group=status" : "";
  return view ? `${PROJECTS}/${id}?view=${view}${group}` : `${PROJECTS}/${id}`;
}

// ── create and edit ──────────────────────────────────────────

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("projects.write");
  const reader = new FormReader(formData);
  const v = readProjectFields(reader);
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("create_project", {
    p_name: v.name,
    p_description: v.description ?? undefined,
    p_owner: v.ownerId ?? undefined,
    p_status: v.status,
    p_priority: v.priority,
    p_start: v.startDate ?? undefined,
    p_target: v.targetDate ?? undefined,
    p_notes: v.notes ?? undefined,
  });
  const out = data as { project_id?: string; ref?: string } | null;
  if (error || !out?.project_id) {
    logged("createProject", error);
    const field = error?.hint === "project_name_taken" ? { name: sentence(error.message ?? "That name is taken") } : undefined;
    return withValues(fail(field ? CHECK : messageFor(error), field), formData);
  }
  refresh(out.project_id);
  redirect(withToast(`${PROJECTS}/${out.project_id}`, `Project ${out.ref ?? ""} created`.replace(/\s+/g, " ")));
}

export async function updateProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) return withValues(fail(NOT_FOUND), formData);
  const versionRaw = Number.parseInt(String(formData.get("version") ?? ""), 10);
  const version = Number.isSafeInteger(versionRaw) && versionRaw > 0 ? versionRaw : undefined;

  const reader = new FormReader(formData);
  const v = readProjectFields(reader);
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  // Empty optional fields are cleared explicitly (null in the RPC means "leave it").
  const clear: string[] = [];
  if (!v.description) clear.push("description");
  if (!v.ownerId) clear.push("owner");
  if (!v.startDate) clear.push("start_date");
  if (!v.targetDate) clear.push("target_date");
  if (!v.notes) clear.push("notes");

  const { data, error } = await db.rpc("update_project", {
    p_id: id,
    p_expected_version: version,
    p_name: v.name,
    p_description: v.description ?? undefined,
    p_owner: v.ownerId ?? undefined,
    p_status: v.status,
    p_priority: v.priority,
    p_start: v.startDate ?? undefined,
    p_target: v.targetDate ?? undefined,
    p_notes: v.notes ?? undefined,
    p_clear: clear.length ? clear : undefined,
  });
  if (error) {
    logged("updateProject", error);
    if (error.hint === "project_stale") return withValues(fail("This project was changed by someone else while you were editing. Reload the page to see their changes, then edit again."), formData);
    const field = error.hint === "project_name_taken" ? { name: sentence(error.message ?? "That name is taken") } : undefined;
    return withValues(fail(field ? CHECK : messageFor(error), field), formData);
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${PROJECTS}/${id}`, changed ? "Project saved" : "Nothing changed", changed ? "success" : "info"));
}

export async function setProjectStatus(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const status = formData.get("status");
  if (!isProjectStatus(status)) redirect(withToast(`${PROJECTS}/${id}`, "Choose one of the statuses.", "error"));
  const { error } = await db.rpc("set_project_status", { p_id: id, p_status: status, p_note: textFrom(formData, "note", STATUS_NOTE_MAX) ?? undefined });
  if (error) {
    logged("setProjectStatus", error);
    redirect(withToast(`${PROJECTS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${PROJECTS}/${id}`, "Status updated"));
}

export async function archiveProject(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_record", { p_entity: "project", p_id: id, p_reason: "Archived from the project page" });
  if (error) {
    logged("archiveProject", error);
    redirect(withToast(`${PROJECTS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(PROJECTS, "Project archived"));
}

export async function restoreProject(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_record", { p_entity: "project", p_id: id });
  if (error) {
    logged("restoreProject", error);
    redirect(withToast(`${PROJECTS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${PROJECTS}/${id}`, "Project restored"));
}

// ── links and documents ──────────────────────────────────────

const LINK_KINDS = ["contact", "organisation", "contractor", "opportunity"] as const;
type LinkKind = (typeof LINK_KINDS)[number];

export async function addProjectLink(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  // One picker per kind: the first one with a value wins.
  let kind: LinkKind | null = null;
  let target: string | null = null;
  for (const k of LINK_KINDS) {
    const v = idFrom(formData, `link_${k}`);
    if (v) {
      kind = k;
      target = v;
      break;
    }
  }
  if (!kind || !target) redirect(withToast(`${PROJECTS}/${id}`, "Choose a contact or organisation to link.", "error"));
  const { data, error } = await db.rpc("add_project_link", { p_project: id, p_kind: kind, p_id: target });
  if (error) {
    logged("addProjectLink", error);
    redirect(withToast(`${PROJECTS}/${id}`, error.code === "P0002" ? "That record could not be found." : messageFor(error), "error"));
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${PROJECTS}/${id}`, changed ? "Linked" : "That is already linked", changed ? "success" : "info"));
}

export async function removeProjectLink(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  const target = idFrom(formData, "target_id");
  const kindRaw = formData.get("kind");
  const kind = typeof kindRaw === "string" && (LINK_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as LinkKind) : null;
  if (!id || !target || !kind) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const { error } = await db.rpc("remove_project_link", { p_project: id, p_kind: kind, p_id: target });
  if (error) {
    logged("removeProjectLink", error);
    redirect(withToast(`${PROJECTS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${PROJECTS}/${id}`, "Link removed"));
}

export async function addProjectDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  if (!id) return fail(NOT_FOUND);
  const reader = new FormReader(formData);
  const v = readDocumentFields(reader, formData);
  if (!reader.ok || !v.url) return withValues(reader.fail(CHECK), formData);
  const { error } = await db.rpc("add_project_document", { p_project: id, p_title: v.title, p_url: v.url });
  if (error) {
    logged("addProjectDocument", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  redirect(withToast(`${PROJECTS}/${id}`, "Document link added"));
}

export async function removeProjectDocument(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData);
  const docRaw = String(formData.get("document_id") ?? "");
  const doc = /^\d{1,18}$/.test(docRaw) ? docRaw : null;
  if (!id || !doc) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const { error } = await db.rpc("remove_project_document", { p_project: id, p_document: Number(doc) });
  if (error) {
    logged("removeProjectDocument", error);
    redirect(withToast(`${PROJECTS}/${id}`, messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(`${PROJECTS}/${id}`, "Document link removed"));
}

// ── milestones ───────────────────────────────────────────────

export async function createMilestone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("projects.write");
  const id = idFrom(formData, "project_id");
  if (!id) return fail(NOT_FOUND);
  const reader = new FormReader(formData);
  const v = readMilestoneFields(reader);
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);
  const { error } = await db.rpc("create_milestone", { p_project: id, p_name: v.name, p_description: v.description ?? undefined, p_due: v.dueDate ?? undefined });
  if (error) {
    logged("createMilestone", error);
    const field = error.hint === "milestone_name_taken" ? { name: sentence(error.message ?? "That name is taken") } : undefined;
    return withValues(fail(field ? CHECK : messageFor(error), field), formData);
  }
  refresh(id);
  redirect(withToast(backTo(formData, id), "Milestone added"));
}

/** Complete (optionally with open tasks, which needs a note), or reopen. */
export async function setMilestoneDone(formData: FormData): Promise<void> {
  const { db } = await requireStaff("projects.write");
  const project = idFrom(formData, "project_id");
  const id = idFrom(formData, "milestone_id");
  if (!project || !id) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const back = backTo(formData, project);
  const done = formData.get("done") === "1";
  if (done) {
    const force = formData.get("force") === "1";
    const note = textFrom(formData, "note", 300);
    const { data, error } = await db.rpc("complete_milestone", { p_id: id, p_force: force, p_note: note ?? undefined });
    if (error) {
      logged("completeMilestone", error);
      redirect(withToast(back, messageFor(error), "error"));
    }
    refresh(project);
    const open = Number((data as { open_tasks?: number } | null)?.open_tasks ?? 0);
    redirect(withToast(back, open > 0 ? `Milestone completed with ${open === 1 ? "1 open task" : `${open} open tasks`}` : "Milestone completed"));
  }
  const { error } = await db.rpc("reopen_milestone", { p_id: id });
  if (error) {
    logged("reopenMilestone", error);
    redirect(withToast(back, messageFor(error), "error"));
  }
  refresh(project);
  redirect(withToast(back, "Milestone reopened"));
}

// ── tasks on the project views ───────────────────────────────

/** The add-task row: a title, in this project (and milestone, when the row is under one). */
export async function addProjectTask(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const project = idFrom(formData, "project_id");
  if (!project) redirect(withToast(PROJECTS, NOT_FOUND, "error"));
  const back = backTo(formData, project);
  const raw = formData.get("title");
  const title = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!title) redirect(withToast(back, "Type what needs doing first.", "error"));
  if (title.length > NAME_MAX) redirect(withToast(back, `A task title must be ${NAME_MAX} characters or fewer.`, "error"));
  const milestone = idFrom(formData, "milestone_id");
  const parent = idFrom(formData, "parent_id");
  const { error } = await db.rpc("create_project_task", {
    p_title: title,
    p_project: project,
    p_milestone: milestone ?? undefined,
    p_parent: parent ?? undefined,
  });
  if (error) {
    logged("addProjectTask", error);
    redirect(withToast(back, messageFor(error), "error"));
  }
  refresh(project);
  redirect(withToast(back, "Task added"));
}

const TASK_FIELDS = ["assignee", "priority", "due_date", "milestone", "blocked_reason"] as const;
type TaskField = (typeof TASK_FIELDS)[number];
const PRIORITIES = ["low", "normal", "high", "urgent"];

/**
 * One inline edit from the List view (assignee, priority, due date, milestone) or the task page
 * (blocked reason). Called directly by the small controls, so it returns a result for a toast.
 * Goes through update_project_task, which applies the single-task rules (only someone who may
 * update the task; only its creator or a tasks.read_all holder may give it to someone else).
 */
export async function setTaskField(taskId: string, field: string, value: string): Promise<ProjectActionResult> {
  const { db } = await requireStaff("tasks.write");
  if (typeof taskId !== "string" || !isUuid(taskId)) return { ok: false, message: "That task could not be found." };
  if (!(TASK_FIELDS as readonly string[]).includes(field)) return { ok: false, message: GENERIC };
  const f = field as TaskField;
  const v = typeof value === "string" ? value.trim() : "";
  let patchValue: string | null;
  switch (f) {
    case "assignee":
    case "milestone":
      if (v && !isUuid(v)) return { ok: false, message: "Choose one of the options." };
      patchValue = v ? v.toLowerCase() : null;
      break;
    case "priority":
      if (!PRIORITIES.includes(v)) return { ok: false, message: "Choose one of the priorities." };
      patchValue = v;
      break;
    case "due_date":
      if (v && !isIsoDate(v)) return { ok: false, message: "Enter a valid date." };
      patchValue = v || null;
      break;
    case "blocked_reason":
      if (v.length > BLOCKED_REASON_MAX) return { ok: false, message: `Keep it to ${BLOCKED_REASON_MAX} characters.` };
      patchValue = v || null;
      break;
  }
  const { data, error } = await db.rpc("update_project_task", { p_id: taskId.toLowerCase(), p_patch: { [f]: patchValue } });
  if (error) {
    logged("setTaskField", error);
    return { ok: false, message: messageFor(error, "That task could not be found.") };
  }
  const out = data as { project_id?: string | null; changed?: boolean } | null;
  refresh(out?.project_id ?? null);
  revalidatePath(`${HQ_BASE}/operations/tasks/${taskId.toLowerCase()}`);
  if (out?.changed === false) return { ok: true, message: "Nothing changed" };
  const words: Record<TaskField, string> = {
    assignee: patchValue ? "Task reassigned" : "Task unassigned",
    priority: "Priority updated",
    due_date: patchValue ? "Due date updated" : "Due date cleared",
    milestone: patchValue ? "Milestone updated" : "Milestone cleared",
    blocked_reason: "Note saved",
  };
  return { ok: true, message: words[f] };
}

// ── the task page (/hq/operations/tasks/[id]) ────────────────

const TASK_NOT_FOUND = "That task could not be found. It may have been archived.";
const taskPath = (id: string) => `${HQ_BASE}/operations/tasks/${id}`;

function refreshTask(id: string, projects: readonly (string | null | undefined)[] = []) {
  revalidatePath(taskPath(id));
  revalidatePath(`${HQ_BASE}/operations`);
  revalidatePath(HQ_BASE);
  revalidatePath(PROJECTS);
  for (const p of new Set(projects.filter((x): x is string => !!x))) revalidatePath(`${PROJECTS}/${p}`);
}

/**
 * Project, milestone and parent from the task page's "Where it sits" form. Only fields that changed
 * are sent (the form posts the current values as current_*), so someone without projects.write can
 * still change the parent. A new project drops a milestone from the old one.
 */
export async function setTaskPlacement(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const back = taskPath(id);
  const cur = (name: string) => idFrom(formData, `current_${name}`);
  const project = idFrom(formData, "project_id");
  const parent = idFrom(formData, "parent_id");
  const milestone = idFrom(formData, "milestone_id");
  for (const name of ["project_id", "milestone_id", "parent_id"]) {
    const raw = formData.get(name);
    if (typeof raw === "string" && raw !== "" && !isUuid(raw)) redirect(withToast(back, "Choose one of the options.", "error"));
  }
  const patch: Record<string, string | null> = {};
  if (project !== cur("project")) {
    // The milestone list on the page belongs to the old project, so a move clears it (choose a new one after).
    patch.project = project;
    patch.milestone = null;
  } else if (milestone !== cur("milestone")) {
    patch.milestone = milestone;
  }
  if (parent !== cur("parent")) patch.parent = parent;
  if (parent && parent === id) redirect(withToast(back, "A task cannot be its own parent.", "error"));
  if (Object.keys(patch).length === 0) redirect(withToast(back, "Nothing changed", "info"));

  const { data, error } = await db.rpc("update_project_task", { p_id: id, p_patch: patch });
  if (error) {
    logged("setTaskPlacement", error);
    redirect(withToast(back, messageFor(error, TASK_NOT_FOUND), "error"));
  }
  const out = data as { project_id?: string | null; changed?: boolean } | null;
  refreshTask(id, [out?.project_id, cur("project")]);
  redirect(withToast(back, out?.changed === false ? "Nothing changed" : "Task moved", out?.changed === false ? "info" : "success"));
}

/** The task page's "Add a subtask" row: same project (the database takes the parent's) and the parent's milestone. */
export async function addSubtask(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const parent = idFrom(formData, "parent_id");
  if (!parent) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const back = `${taskPath(parent)}#task-subtasks`;
  const raw = formData.get("title");
  const title = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  if (!title) redirect(withToast(back, "Type what needs doing first.", "error"));
  if (title.length > NAME_MAX) redirect(withToast(back, `A task title must be ${NAME_MAX} characters or fewer.`, "error"));
  const milestone = idFrom(formData, "milestone_id");
  const { data, error } = await db.rpc("create_project_task", { p_title: title, p_parent: parent, p_milestone: milestone ?? undefined });
  if (error) {
    logged("addSubtask", error);
    redirect(withToast(back, messageFor(error, TASK_NOT_FOUND), "error"));
  }
  refreshTask(parent, [(data as { project_id?: string | null } | null)?.project_id]);
  redirect(withToast(back, "Subtask added"));
}

export async function saveBlockedReason(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const raw = formData.get("blocked_reason");
  const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (v.length > BLOCKED_REASON_MAX) redirect(withToast(taskPath(id), `Keep the note to ${BLOCKED_REASON_MAX} characters.`, "error"));
  const { data, error } = await db.rpc("update_project_task", { p_id: id, p_patch: { blocked_reason: v || null } });
  if (error) {
    logged("saveBlockedReason", error);
    redirect(withToast(taskPath(id), messageFor(error, TASK_NOT_FOUND), "error"));
  }
  refreshTask(id, [(data as { project_id?: string | null } | null)?.project_id]);
  redirect(withToast(taskPath(id), v ? "Note saved" : "Note cleared"));
}

export async function addTaskDependency(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const dep = idFrom(formData, "depends_on");
  if (!dep) redirect(withToast(taskPath(id), "Choose the task this one waits for.", "error"));
  if (dep === id) redirect(withToast(taskPath(id), "A task cannot wait for itself.", "error"));
  const { data, error } = await db.rpc("add_task_dependency", { p_task: id, p_depends_on: dep });
  if (error) {
    logged("addTaskDependency", error);
    redirect(withToast(taskPath(id), error.hint === "task_dependency_cycle" ? "That would make the tasks wait for each other in a loop, so it was not added." : messageFor(error, TASK_NOT_FOUND), "error"));
  }
  refreshTask(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(taskPath(id), changed ? "Dependency added" : "It already waits for that task", changed ? "success" : "info"));
}

export async function removeTaskDependency(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const id = idFrom(formData);
  const dep = idFrom(formData, "depends_on");
  // "back" is the page the button was on: this task, or the task that is waiting (from its "blocking" list).
  const backId = idFrom(formData, "back_id") ?? id;
  if (!id || !dep || !backId) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const { error } = await db.rpc("remove_task_dependency", { p_task: id, p_depends_on: dep });
  if (error) {
    logged("removeTaskDependency", error);
    redirect(withToast(taskPath(backId), messageFor(error, TASK_NOT_FOUND), "error"));
  }
  refreshTask(id);
  revalidatePath(taskPath(dep));
  redirect(withToast(taskPath(backId), "Dependency removed"));
}

/**
 * The checklist editor saves the whole list after each tick, add, edit, move or removal. Items
 * keep their id (so their done stamp survives); the database replaces the rest and writes one
 * activity row.
 */
export async function saveTaskChecklist(taskId: string, items: unknown): Promise<ProjectActionResult & { items?: { id: string; text: string; done: boolean }[] }> {
  const { db } = await requireStaff("tasks.write");
  if (typeof taskId !== "string" || !isUuid(taskId)) return { ok: false, message: TASK_NOT_FOUND };
  if (!Array.isArray(items)) return { ok: false, message: GENERIC };
  if (items.length > CHECKLIST_MAX_ITEMS) return { ok: false, message: `A checklist can have at most ${CHECKLIST_MAX_ITEMS} items.` };
  const clean: { id?: number; text: string; done: boolean }[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") return { ok: false, message: GENERIC };
    const r = raw as { id?: unknown; text?: unknown; done?: unknown };
    const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim() : "";
    if (!text) continue;
    if (text.length > CHECKLIST_TEXT_MAX) return { ok: false, message: `Each item must be ${CHECKLIST_TEXT_MAX} characters or fewer.` };
    const id = typeof r.id === "string" && /^\d{1,18}$/.test(r.id) ? Number(r.id) : undefined;
    clean.push(id === undefined ? { text, done: r.done === true } : { id, text, done: r.done === true });
  }
  const id = taskId.toLowerCase();
  const { data, error } = await db.rpc("set_task_checklist", { p_task: id, p_items: clean });
  if (error) {
    logged("saveTaskChecklist", error);
    return { ok: false, message: messageFor(error, TASK_NOT_FOUND) };
  }
  refreshTask(id);
  const out = data as { done?: number; total?: number; changed?: boolean; items?: { id: number; text: string; done: boolean }[] } | null;
  return {
    ok: true,
    message: out?.changed === false ? "Nothing changed" : "Checklist saved",
    items: (out?.items ?? []).map((i) => ({ id: String(i.id), text: i.text, done: i.done === true })),
  };
}

export async function addTaskComment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("tasks.write");
  const id = idFrom(formData);
  if (!id) return fail(TASK_NOT_FOUND);
  const raw = formData.get("body");
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return withValues(fail(CHECK, { body: "Write the comment first." }), formData);
  if (body.length > COMMENT_MAX) return withValues(fail(CHECK, { body: `A comment must be ${COMMENT_MAX} characters or fewer.` }), formData);
  const { error } = await db.rpc("add_task_comment", { p_task: id, p_body: body });
  if (error) {
    logged("addTaskComment", error);
    return withValues(fail(messageFor(error, TASK_NOT_FOUND)), formData);
  }
  refreshTask(id);
  redirect(withToast(`${taskPath(id)}#task-comments`, "Comment added"));
}

export async function editTaskComment(formData: FormData): Promise<void> {
  // No capability gate here beyond being staff: a director may edit without tasks.write. The RPC decides (author within 60 minutes, or a director).
  const { db } = await requireStaff();
  const id = idFrom(formData);
  if (!id) redirect(withToast(`${HQ_BASE}/operations`, TASK_NOT_FOUND, "error"));
  const commentRaw = String(formData.get("comment_id") ?? "");
  if (!/^\d{1,18}$/.test(commentRaw)) redirect(withToast(taskPath(id), "That comment could not be found.", "error"));
  const raw = formData.get("body");
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) redirect(withToast(taskPath(id), "A comment needs text.", "error"));
  if (body.length > COMMENT_MAX) redirect(withToast(taskPath(id), `A comment must be ${COMMENT_MAX} characters or fewer.`, "error"));
  const { data, error } = await db.rpc("edit_task_comment", { p_comment: Number(commentRaw), p_body: body });
  if (error) {
    logged("editTaskComment", error);
    const msg = error.hint === "task_comment_edit_window" && error.message ? sentence(error.message) : messageFor(error, "That comment could not be found.");
    redirect(withToast(taskPath(id), msg, "error"));
  }
  refreshTask(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${taskPath(id)}#task-comments`, changed ? "Comment updated" : "Nothing changed", changed ? "success" : "info"));
}
