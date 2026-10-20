import "server-only";

import type { HqClient } from "../db";
import { isUuid, likeValue } from "../forms";
import type { TaskPriority, TaskStatus } from "../constants";
import type {
  ActivityEntry,
  ChecklistItem,
  Dependency,
  FocusItem,
  Milestone,
  MilestoneStatus,
  ProjectDocument,
  ProjectHealth,
  ProjectLink,
  ProjectStatus,
  ProjectSummary,
  ProjectTask,
  Result,
  TaskComment,
} from "./types";
import type { ProjectListQuery } from "./rules";

/*
 * Reads for the project screens, the extended task page and Your Focus. Every query runs as the
 * signed-in person, so row level security is the control: projects need projects.read; tasks inside
 * a project still follow the task rule (assignee, creator, tasks.read_all), so a private task is
 * simply absent and every figure from the views counts only the tasks this person can see.
 * Archived rows are filtered out here. Nothing logs more than an error code.
 */

// The views are typed loosely here on purpose: the screens only use the columns named below.
type Db = HqClient;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (db: Db, rel: string) => (db as any).from(rel);

const n = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) || 0 : 0);
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const logErr = (where: string, e: { code?: string } | null | undefined) => console.error(`[hq] ${where} failed:`, e?.code ?? "unknown");

// ── projects ────────────────────────────────────────────────

const OVERVIEW =
  "id, ref, ref_number, name, description, owner_id, owner_name, status, priority, start_date, target_date, completed_at, notes, version, task_count, open_count, overdue_count, max_overdue_days, blocked_count, progress_done, progress_total, progress_pct, milestone_count, milestones_done, overdue_milestone_count, next_milestone_name, next_milestone_due, health, health_reasons, days_to_target, created_at, updated_at, deleted_at";

type OverviewRow = Record<string, unknown>;

function toSummary(r: OverviewRow): ProjectSummary | null {
  if (!s(r.id) || !s(r.name) || !s(r.status)) return null;
  return {
    id: r.id as string,
    ref: s(r.ref) ?? "",
    name: r.name as string,
    description: s(r.description),
    status: r.status as ProjectStatus,
    priority: (s(r.priority) ?? "normal") as TaskPriority,
    health: (s(r.health) ?? "on_track") as ProjectHealth,
    ownerId: s(r.owner_id),
    ownerName: s(r.owner_name),
    startDate: s(r.start_date),
    targetDate: s(r.target_date),
    completedAt: s(r.completed_at),
    notes: s(r.notes),
    version: n(r.version) || 1,
    doneCount: n(r.progress_done),
    totalCount: n(r.progress_total),
    progress: n(r.progress_pct),
    taskCount: n(r.task_count),
    openCount: n(r.open_count),
    overdueCount: n(r.overdue_count),
    blockedCount: n(r.blocked_count),
    maxOverdueDays: n(r.max_overdue_days),
    milestoneCount: n(r.milestone_count),
    milestonesDone: n(r.milestones_done),
    overdueMilestoneCount: n(r.overdue_milestone_count),
    nextMilestoneName: s(r.next_milestone_name),
    nextMilestoneDue: s(r.next_milestone_due),
    healthReasons: Array.isArray(r.health_reasons) ? (r.health_reasons as unknown[]).filter((x): x is string => typeof x === "string") : [],
    daysToTarget: r.days_to_target === null || r.days_to_target === undefined ? null : n(r.days_to_target),
    createdAt: s(r.created_at) ?? "",
    updatedAt: s(r.updated_at) ?? "",
  };
}

export async function listProjects(db: Db, q: ProjectListQuery, meId: string): Promise<Result<ProjectSummary[]>> {
  let query = from(db, "project_overview").select(OVERVIEW).is("deleted_at", null);
  if (q.status === "open") query = query.in("status", ["planning", "active", "on_hold"]);
  else if (q.status !== "all") query = query.eq("status", q.status);
  if (q.owner) query = query.eq("owner_id", q.owner === "me" ? meId : q.owner);
  if (q.health) query = query.eq("health", q.health);
  if (q.q) query = query.ilike("name", `%${likeValue(q.q).replace(/\*/g, "_")}%`);
  const { data, error } = await query.order("target_date", { ascending: true, nullsFirst: false }).order("ref_number", { ascending: true }).limit(200);
  if (error) {
    logErr("listProjects", error);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as OverviewRow[]).map(toSummary).filter((p): p is ProjectSummary => p !== null) };
}

/** One project (archived ones come back only to projects.write holders, by RLS). `archived` says which. */
export async function getProject(db: Db, id: string): Promise<Result<{ project: ProjectSummary; archived: boolean } | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await from(db, "project_overview").select(OVERVIEW).eq("id", id).maybeSingle();
  if (error) {
    logErr("getProject", error);
    return { ok: false };
  }
  if (!data) return { ok: true, data: null };
  const project = toSummary(data as OverviewRow);
  return { ok: true, data: project ? { project, archived: (data as OverviewRow).deleted_at !== null } : null };
}

export async function projectMilestones(db: Db, projectId: string): Promise<Result<Milestone[]>> {
  const { data, error } = await from(db, "project_milestones")
    .select("id, project_id, name, description, due_date, status, sort_order, completed_at")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) {
    logErr("projectMilestones", error);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((m) => ({
      id: m.id as string,
      projectId: m.project_id as string,
      name: m.name as string,
      description: s(m.description),
      dueDate: s(m.due_date),
      status: (s(m.status) ?? "open") as MilestoneStatus,
      sortOrder: n(m.sort_order),
      completedAt: s(m.completed_at),
    })),
  };
}

// ── tasks (task_overview) ───────────────────────────────────

const TASK_COLS =
  "id, title, status, priority, due_date, assigned_to, assignee_name, created_by, project_id, project_ref, project_name, milestone_id, milestone_name, parent_task_id, parent_title, sort_order, blocked_reason, subtask_count, open_subtask_count, checklist_total, checklist_done, dependency_count, open_dependency_count, is_blocked, blocking_count, created_at, completed_at";

function toTask(r: Record<string, unknown>): ProjectTask {
  return {
    id: r.id as string,
    title: (r.title as string) ?? "",
    status: r.status as TaskStatus,
    priority: (s(r.priority) ?? "normal") as TaskPriority,
    dueDate: s(r.due_date),
    assignedTo: s(r.assigned_to),
    assignedToName: s(r.assignee_name),
    createdBy: s(r.created_by),
    projectId: s(r.project_id),
    projectRef: s(r.project_ref),
    projectName: s(r.project_name),
    milestoneId: s(r.milestone_id),
    milestoneName: s(r.milestone_name),
    parentId: s(r.parent_task_id),
    parentTitle: s(r.parent_title),
    sortOrder: n(r.sort_order),
    blocked: r.is_blocked === true,
    blockedReason: s(r.blocked_reason),
    subtaskCount: n(r.subtask_count),
    subtaskOpen: n(r.open_subtask_count),
    checklistTotal: n(r.checklist_total),
    checklistDone: n(r.checklist_done),
    dependsOnCount: n(r.dependency_count),
    blockingCount: n(r.blocking_count),
    createdAt: s(r.created_at) ?? "",
    completedAt: s(r.completed_at),
  };
}

/** Every live task in the project this person can see (at most 500, which is far more than a project has). */
export async function projectTasks(db: Db, projectId: string): Promise<Result<ProjectTask[]>> {
  const { data, error } = await from(db, "task_overview").select(TASK_COLS).eq("project_id", projectId).is("deleted_at", null).order("sort_order").order("created_at").limit(500);
  if (error) {
    logErr("projectTasks", error);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(toTask) };
}

export async function taskOverview(db: Db, id: string): Promise<Result<ProjectTask | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await from(db, "task_overview").select(TASK_COLS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) {
    logErr("taskOverview", error);
    return { ok: false };
  }
  return { ok: true, data: data ? toTask(data as Record<string, unknown>) : null };
}

export async function subtasksOf(db: Db, id: string): Promise<ProjectTask[]> {
  const { data, error } = await from(db, "task_overview").select(TASK_COLS).eq("parent_task_id", id).is("deleted_at", null).order("sort_order").order("created_at").limit(100);
  if (error) logErr("subtasksOf", error);
  return ((data ?? []) as Record<string, unknown>[]).map(toTask);
}

/**
 * Dependency edges among (or from) a set of tasks, with the visible end's title. A depends-on task
 * this person cannot see is counted (hiddenOpen) but never named.
 */
export async function dependencyMap(db: Db, taskIds: readonly string[]): Promise<Map<string, { visible: Dependency[]; hiddenOpen: number }>> {
  const out = new Map<string, { visible: Dependency[]; hiddenOpen: number }>();
  const ids = [...new Set(taskIds.filter(isUuid))];
  if (ids.length === 0) return out;
  const edges: { task_id: string; depends_on_task_id: string; depends_on_open: boolean }[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await from(db, "task_dependencies").select("task_id, depends_on_task_id, depends_on_open").in("task_id", ids.slice(i, i + 150)).limit(2000);
    if (error) {
      logErr("dependencyMap", error);
      return out;
    }
    edges.push(...((data ?? []) as typeof edges));
  }
  const targets = [...new Set(edges.map((e) => e.depends_on_task_id))];
  const info = new Map<string, Dependency>();
  for (let i = 0; i < targets.length; i += 150) {
    const { data } = await from(db, "task_overview").select("id, title, status, due_date, project_name").in("id", targets.slice(i, i + 150)).is("deleted_at", null);
    for (const r of (data ?? []) as Record<string, unknown>[]) info.set(r.id as string, { taskId: r.id as string, title: r.title as string, status: r.status as TaskStatus, dueDate: s(r.due_date), projectName: s(r.project_name) });
  }
  for (const e of edges) {
    const entry = out.get(e.task_id) ?? { visible: [], hiddenOpen: 0 };
    const d = info.get(e.depends_on_task_id);
    if (d) entry.visible.push(d);
    else if (e.depends_on_open) entry.hiddenOpen += 1;
    out.set(e.task_id, entry);
  }
  return out;
}

/** Tasks waiting on this one (visible ones only). */
export async function blockingOf(db: Db, id: string): Promise<Dependency[]> {
  const { data, error } = await from(db, "task_dependencies").select("task_id").eq("depends_on_task_id", id).limit(200);
  if (error) {
    logErr("blockingOf", error);
    return [];
  }
  const ids = ((data ?? []) as { task_id: string }[]).map((r) => r.task_id);
  if (ids.length === 0) return [];
  const t = await from(db, "task_overview").select("id, title, status, due_date, project_name").in("id", ids).is("deleted_at", null);
  return ((t.data ?? []) as Record<string, unknown>[]).map((r) => ({ taskId: r.id as string, title: r.title as string, status: r.status as TaskStatus, dueDate: s(r.due_date), projectName: s(r.project_name) }));
}

export async function checklistOf(db: Db, id: string): Promise<ChecklistItem[]> {
  const { data, error } = await from(db, "task_checklist_items").select("id, text, done, sort_order, done_by, done_at").eq("task_id", id).order("sort_order").order("id").limit(60);
  if (error) {
    logErr("checklistOf", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await nameMap(db, rows.map((r) => s(r.done_by)));
  return rows.map((r) => ({ id: String(r.id), text: r.text as string, done: r.done === true, sortOrder: n(r.sort_order), doneByName: s(r.done_by) ? (names.get(r.done_by as string) ?? null) : null, doneAt: s(r.done_at) }));
}

export async function commentsOf(db: Db, id: string): Promise<TaskComment[]> {
  const { data, error } = await from(db, "task_comments").select("id, author_id, body, created_at, edited_at").eq("task_id", id).order("created_at").limit(200);
  if (error) {
    logErr("commentsOf", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await nameMap(db, rows.map((r) => s(r.author_id)));
  return rows.map((r) => ({ id: String(r.id), authorId: s(r.author_id), authorName: s(r.author_id) ? (names.get(r.author_id as string) ?? null) : null, body: r.body as string, createdAt: r.created_at as string, editedAt: s(r.edited_at) }));
}

async function activityFrom(db: Db, table: "task_activity" | "project_activity", column: "task_id" | "project_id", id: string, limit: number): Promise<ActivityEntry[]> {
  const { data, error } = await from(db, table).select("id, at, actor_id, kind, summary").eq(column, id).order("at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) {
    logErr(table, error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await nameMap(db, rows.map((r) => s(r.actor_id)));
  return rows.map((r) => ({ id: String(r.id), at: r.at as string, actorName: s(r.actor_id) ? (names.get(r.actor_id as string) ?? null) : null, kind: r.kind as string, summary: r.summary as string }));
}

export const taskActivity = (db: Db, id: string, limit = 60) => activityFrom(db, "task_activity", "task_id", id, limit);
export const projectActivity = (db: Db, id: string, limit = 15) => activityFrom(db, "project_activity", "project_id", id, limit);

// ── links and documents ─────────────────────────────────────

export async function projectLinks(db: Db, id: string, opts: { canGrowth: boolean; canContractors: boolean }): Promise<ProjectLink[]> {
  const { data, error } = await from(db, "project_links").select("id, contact_id, organisation_id, contractor_id, opportunity_id").eq("project_id", id).order("linked_at").limit(200);
  if (error) {
    logErr("projectLinks", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const pick = (k: string) => rows.map((r) => s(r[k])).filter((x): x is string => !!x);
  const [contacts, orgs, contractors, opps] = await Promise.all([
    opts.canGrowth && pick("contact_id").length ? from(db, "contacts").select("id, full_name").in("id", pick("contact_id")) : { data: [] },
    opts.canGrowth && pick("organisation_id").length ? from(db, "organisations").select("id, name").in("id", pick("organisation_id")) : { data: [] },
    opts.canContractors && pick("contractor_id").length ? from(db, "contractor_directory").select("id, business_name").in("id", pick("contractor_id")) : { data: [] },
    opts.canGrowth && pick("opportunity_id").length ? from(db, "opportunities").select("id, prospect_name, display_number").in("id", pick("opportunity_id")) : { data: [] },
  ]);
  const label = new Map<string, string>();
  for (const c of (contacts.data ?? []) as Record<string, unknown>[]) label.set(c.id as string, c.full_name as string);
  for (const o of (orgs.data ?? []) as Record<string, unknown>[]) label.set(o.id as string, o.name as string);
  for (const c of (contractors.data ?? []) as Record<string, unknown>[]) label.set(c.id as string, c.business_name as string);
  for (const o of (opps.data ?? []) as Record<string, unknown>[]) label.set(o.id as string, (s(o.prospect_name) ?? `Lead ${o.display_number}`) as string);
  return rows.map((r) => {
    const kind = r.contact_id ? "contact" : r.organisation_id ? "organisation" : r.contractor_id ? "contractor" : "opportunity";
    const targetId = (r.contact_id ?? r.organisation_id ?? r.contractor_id ?? r.opportunity_id) as string;
    return { id: String(r.id), kind, targetId, label: label.get(targetId) ?? null } as ProjectLink;
  });
}

export async function projectDocuments(db: Db, id: string): Promise<ProjectDocument[]> {
  const { data, error } = await from(db, "project_documents").select("id, title, url, added_by, added_at").eq("project_id", id).order("added_at").limit(60);
  if (error) {
    logErr("projectDocuments", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await nameMap(db, rows.map((r) => s(r.added_by)));
  return rows.map((r) => ({ id: String(r.id), title: r.title as string, url: r.url as string, addedByName: s(r.added_by) ? (names.get(r.added_by as string) ?? null) : null, createdAt: r.added_at as string }));
}

// ── pickers ─────────────────────────────────────────────────

export type ProjectOption = { value: string; label: string };

/** Live projects for the task page's project selector (closed ones too, grouped last by the caller if wanted). */
export async function projectOptions(db: Db): Promise<ProjectOption[]> {
  const { data, error } = await from(db, "projects").select("id, name, ref_number, status").is("deleted_at", null).order("name").limit(300);
  if (error) {
    logErr("projectOptions", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({ value: p.id as string, label: p.name as string }));
}

export async function milestoneOptions(db: Db, projectId: string): Promise<ProjectOption[]> {
  const r = await projectMilestones(db, projectId);
  return r.ok ? r.data.map((m) => ({ value: m.id, label: m.status === "done" ? `${m.name} (done)` : m.name })) : [];
}

/** Open tasks this person can see, for "blocked by" (excluding the task itself). */
export async function dependencyCandidates(db: Db, exceptId: string, projectId: string | null): Promise<{ value: string; label: string; group?: string }[]> {
  const { data, error } = await from(db, "task_overview")
    .select("id, title, project_name, project_id")
    .is("deleted_at", null)
    .in("status", ["to_do", "in_progress", "waiting"])
    .neq("id", exceptId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    logErr("dependencyCandidates", error);
    return [];
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const sorted = [...rows].sort((a, b) => Number(b.project_id === projectId) - Number(a.project_id === projectId));
  return sorted.map((r) => ({ value: r.id as string, label: r.title as string, group: (s(r.project_name) ?? "Not in a project") as string }));
}

// ── focus ───────────────────────────────────────────────────

export async function myFocus(db: Db, limit = 3): Promise<Result<FocusItem[]>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).rpc("my_focus", { p_limit: limit });
  if (error) {
    logErr("my_focus", error);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      taskId: r.task_id as string,
      title: r.title as string,
      projectId: s(r.project_id),
      projectName: s(r.project_name),
      dueDate: s(r.due_date),
      priority: (s(r.priority) ?? "normal") as TaskPriority,
      why: s(r.why) ?? "Next up",
    })),
  };
}

// ── names ───────────────────────────────────────────────────

export async function nameMap(db: Db, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i && isUuid(i)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await db.from("staff_profiles").select("id, full_name").in("id", unique);
  if (error) logErr("nameMap", error);
  for (const r of data ?? []) out.set(r.id, r.full_name);
  return out;
}
