/*
 * Shared pieces of the project and richer-task tools (docs/hq-projects.md section 3): resolving a
 * project (PRJ-0001, an id or its name) and a milestone within it, reading task_overview rows, the
 * dependency walk that finds what is holding a task up, and the lines the tools print.
 *
 * Every query runs as the person (ctx.db, RLS). A project is visible to everyone with projects.read;
 * the tasks inside it still follow the task rule (assignee, creator, tasks.read_all), so every list
 * and count here holds ONLY the tasks this person can see, and a task blocked by something they cannot
 * see is shown as blocked "by a task you cannot see" (task_dependencies.depends_on_open), never named.
 */
import { normaliseName, searchTerm } from "../../growth/params";
import { HEALTH_LABEL, PROJECT_STATUS_LABEL } from "../../projects/rules";
import type { ProjectHealth, ProjectStatus } from "../../projects/types";
import { LIMITS, candidatesText, clean, compose, decideResolution, isUuid, notFoundText, result, type Candidate } from "./core";
import { day, link, logDb, type ToolContext, type ToolResult } from "./kit";
import { firstOpenBlockers, type DepTask } from "./bulk-core";
import { taskPriorityLabel, taskStatusLabel } from "./records";

export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export const projectPath = (id: string) => `/hq/projects/${id}`;
export const taskPath = (id: string) => `/hq/operations/tasks/${id}`;

export const statusWord = (s: string) => (s in PROJECT_STATUS_LABEL ? PROJECT_STATUS_LABEL[s as ProjectStatus] : s.replace(/_/g, " "));
export const healthWord = (h: string | null | undefined) => (h && h in HEALTH_LABEL ? HEALTH_LABEL[h as ProjectHealth] : (h ?? "").replace(/_/g, " "));

/** Thrown by the loaders on a database error; defineTool turns it into the generic message (the log gets the code). */
function fail(where: string, error: { code?: string | null } | null): never {
  logDb(where, error);
  throw new Error(`${where} ${error?.code ?? ""}`);
}

// ── projects ─────────────────────────────────────────────────

export const OVERVIEW_COLS =
  "id, ref_number, ref, name, description, owner_id, owner_name, status, priority, start_date, target_date, completed_at, notes, version, task_count, open_count, completed_count, cancelled_count, overdue_count, max_overdue_days, blocked_count, progress_done, progress_total, progress_pct, milestone_count, milestones_done, overdue_milestone_count, next_milestone_id, next_milestone_name, next_milestone_due, health, health_reasons, days_to_target, updated_at, deleted_at";

export type ProjectRow = {
  id: string;
  ref_number: number;
  ref: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  notes: string | null;
  version: number;
  task_count: number;
  open_count: number;
  completed_count: number;
  cancelled_count: number;
  overdue_count: number;
  max_overdue_days: number;
  blocked_count: number;
  progress_done: number;
  progress_total: number;
  progress_pct: number;
  milestone_count: number;
  milestones_done: number;
  overdue_milestone_count: number;
  next_milestone_id: string | null;
  next_milestone_name: string | null;
  next_milestone_due: string | null;
  health: string;
  health_reasons: string[] | null;
  days_to_target: number | null;
  updated_at: string;
  deleted_at: string | null;
};

/** The overview rows a query builder returns (views are typed with nullable columns; this reads them as the view guarantees). */
export function toProjectRows(data: unknown): ProjectRow[] {
  return ((data ?? []) as ProjectRow[]).filter((r) => r && r.id && r.name);
}

const overviewBase = (ctx: ToolContext) => ctx.db.from("project_overview").select(OVERVIEW_COLS).is("deleted_at", null);

export type ProjectResolved = { ok: true; project: ProjectRow; note: string | null } | { ok: false; result: ToolResult };

const projectCandidate = (p: ProjectRow): Candidate => ({ id: p.id, label: `${p.ref} ${p.name}`, detail: `${statusWord(p.status)}, ${healthWord(p.health)}` });

/**
 * The project a person named: PRJ-0001 or an id is exact; a name (any case, spacing, "the") that
 * exactly one live project has wins; otherwise close matches are candidates (a single close match is
 * accepted for reading and must be confirmed for a write). Never a guess.
 */
export async function resolveProject(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<ProjectResolved> {
  const q = query.trim();
  const refMatch = /^prj[-\s]?0*(\d{1,9})$/i.exec(q);
  const tagged = /^project:([0-9a-f-]{36})$/i.exec(q);
  const id = tagged ? tagged[1].toLowerCase() : isUuid(q) ? q.toLowerCase() : null;
  if (refMatch || id) {
    const { data, error } = await (refMatch ? overviewBase(ctx).eq("ref_number", Number(refMatch[1])) : overviewBase(ctx).eq("id", id!)).limit(1);
    if (error) fail("project lookup", error);
    const hit = toProjectRows(data)[0];
    return hit ? { ok: true, project: hit, note: null } : { ok: false, result: result("not_found", notFoundText("project", q)) };
  }
  const term = searchTerm(q);
  if (term.length < 2) return { ok: false, result: result("not_found", notFoundText("project", q)) };
  const { data, error } = await overviewBase(ctx).ilike("name", `%${term}%`).order("updated_at", { ascending: false }).limit(LIMITS.candidates + 1);
  if (error) fail("project lookup", error);
  const close = toProjectRows(data);
  const key = normaliseName(q);
  const exact = close.filter((p) => normaliseName(p.name) === key);
  const byId = new Map(close.map((p) => [p.id, p]));
  const r = decideResolution({ exact: exact.map(projectCandidate), close: close.map(projectCandidate), mode });
  if (r.kind === "one") {
    const p = byId.get(r.record.id)!;
    return { ok: true, project: p, note: r.how === "close" ? `No project is named exactly "${clean(q, 80)}"; this is the only close match (${p.ref}).` : null };
  }
  if (r.kind === "none") return { ok: false, result: result("not_found", notFoundText("project", q)) };
  const t = candidatesText("project", q, r);
  return { ok: false, result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? null })) }) };
}

/** The refusal for a person without projects.read who names a project somewhere a task tool allows one. */
export const NO_PROJECTS_READ = "Refused: your HQ role does not include projects.read, so tasks cannot be found or filed by project. Nothing was read or changed.";

// ── milestones ───────────────────────────────────────────────

export type MilestoneRow = { id: string; project_id: string; name: string; description: string | null; due_date: string | null; status: string; sort_order: number; completed_at: string | null };
export const MILESTONE_COLS = "id, project_id, name, description, due_date, status, sort_order, completed_at";

export async function loadMilestones(ctx: ToolContext, projectIds: readonly string[]): Promise<MilestoneRow[]> {
  if (projectIds.length === 0) return [];
  const { data, error } = await ctx.db.from("project_milestones").select(MILESTONE_COLS).in("project_id", [...new Set(projectIds)]).order("sort_order").order("due_date", { ascending: true, nullsFirst: false }).limit(500);
  if (error) fail("milestones", error);
  return (data ?? []) as MilestoneRow[];
}

export type MilestoneResolved = { ok: true; milestone: MilestoneRow } | { ok: false; result: ToolResult };

/** A milestone of ONE project, by id or name (any case); a part of a name gives candidates, never a guess. */
export function pickMilestone(list: readonly MilestoneRow[], project: { id: string; ref: string }, query: string): MilestoneResolved {
  const q = query.trim();
  const mine = list.filter((m) => m.project_id === project.id);
  if (isUuid(q)) {
    const hit = mine.find((m) => m.id === q.toLowerCase());
    return hit ? { ok: true, milestone: hit } : { ok: false, result: result("not_found", `No milestone with that id is in ${project.ref}. Nothing was changed.`) };
  }
  const key = normaliseName(q);
  const exact = mine.filter((m) => normaliseName(m.name) === key);
  if (exact.length === 1) return { ok: true, milestone: exact[0] };
  const close = exact.length > 1 ? exact : mine.filter((m) => key && normaliseName(m.name).includes(key));
  const names = mine.map((m) => `- ${clean(m.name)}${m.status === "done" ? " (done)" : ""} [id: ${m.id}]`);
  if (close.length === 0) {
    return { ok: false, result: result("not_found", compose({ head: `${project.ref} has no milestone named "${clean(q, 80)}". Nothing was changed.${mine.length ? " Its milestones are:" : " It has no milestones yet (create_milestone adds one)."}`, data: names }), { milestones: mine.map((m) => ({ id: m.id, name: m.name })) }) };
  }
  return {
    ok: false,
    result: result("ambiguous", compose({ head: `"${clean(q, 80)}" does not name exactly one milestone of ${project.ref}. Nothing was changed: ask which one, then call again with its name or id.`, data: close.map((m) => `- ${clean(m.name)} [id: ${m.id}]`) }), {
      candidates: close.map((m) => ({ id: m.id, label: m.name })),
    }),
  };
}

export function milestoneLine(ctx: ToolContext, m: MilestoneRow, today: string): string {
  const late = m.status === "open" && m.due_date && m.due_date < today;
  return `- ${clean(m.name)} - ${m.status === "done" ? `done${m.completed_at ? ` ${day(ctx, m.completed_at)}` : ""}` : "open"}${m.due_date ? `, due ${day(ctx, m.due_date)}${late ? " (OVERDUE)" : ""}` : ""} [id: ${m.id}]`;
}

// ── tasks (task_overview) ────────────────────────────────────

export const TASK_COLS =
  "id, title, description, status, priority, due_date, assigned_to, assignee_name, source, project_id, project_ref, project_name, milestone_id, milestone_name, parent_task_id, parent_title, sort_order, blocked_reason, subtask_count, open_subtask_count, checklist_total, checklist_done, dependency_count, open_dependency_count, is_blocked, blocking_count, is_overdue, overdue_days, created_by, created_by_name, created_at, updated_at, completed_at, deleted_at";

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  source: string;
  project_id: string | null;
  project_ref: string | null;
  project_name: string | null;
  milestone_id: string | null;
  milestone_name: string | null;
  parent_task_id: string | null;
  parent_title: string | null;
  sort_order: number;
  blocked_reason: string | null;
  subtask_count: number;
  open_subtask_count: number;
  checklist_total: number;
  checklist_done: number;
  dependency_count: number;
  open_dependency_count: number;
  is_blocked: boolean;
  blocking_count: number;
  is_overdue: boolean;
  overdue_days: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
};

export function toTaskRows(data: unknown): TaskRow[] {
  return ((data ?? []) as TaskRow[]).filter((r) => r && r.id && r.title);
}

export const isOpen = (s: string) => s === "to_do" || s === "in_progress" || s === "waiting";

/** One task line (record content, for the data block). */
export function taskLine(ctx: ToolContext, t: TaskRow, opts: { project?: boolean; indent?: boolean } = {}): string {
  const bits = [
    taskStatusLabel(t.status),
    t.priority !== "normal" ? `${taskPriorityLabel(t.priority).toLowerCase()} priority` : null,
    t.due_date ? `due ${day(ctx, t.due_date)}${t.is_overdue ? ` (OVERDUE by ${t.overdue_days} day${t.overdue_days === 1 ? "" : "s"})` : ""}` : null,
    t.assigned_to ? clean(t.assignee_name ?? "someone") : "unassigned",
    t.is_blocked ? "BLOCKED" : null,
    t.milestone_name ? `milestone ${clean(t.milestone_name)}` : null,
    opts.project && t.project_ref ? `${t.project_ref} ${clean(t.project_name ?? "", 60)}` : null,
    t.subtask_count ? `${t.subtask_count - t.open_subtask_count}/${t.subtask_count} subtasks done` : null,
    t.checklist_total ? `checklist ${t.checklist_done}/${t.checklist_total}` : null,
  ].filter(Boolean);
  return `${opts.indent ? "  " : ""}- ${clean(t.title)} [id: ${t.id}] - ${bits.join(", ")}`;
}

/** The next actionable tasks of a list: open, not blocked, not a parent with open subtasks; overdue first, then priority, due date, oldest. */
export function nextActions(tasks: readonly TaskRow[], n: number): TaskRow[] {
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return tasks
    .filter((t) => isOpen(t.status) && !t.is_blocked && t.open_subtask_count === 0)
    .sort((a, b) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      const p = (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2);
      if (p) return p;
      if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date < b.due_date ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    })
    .slice(0, n);
}

// ── what is holding tasks up ─────────────────────────────────

export type Blockage = { task: TaskRow; roots: DepTask[]; hidden: number };

/**
 * For blocked tasks, the first OPEN tasks blocking each (walking the chain of unfinished dependencies
 * to the work that can start now). Two batched rounds of reads: the open dependencies of the blocked
 * tasks and of what they wait for. A blocking task this person cannot see is counted as hidden.
 */
export async function blockages(ctx: ToolContext, blocked: readonly TaskRow[], known: readonly TaskRow[]): Promise<Blockage[]> {
  if (blocked.length === 0) return [];
  const tasks = new Map<string, DepTask>();
  const add = (t: TaskRow) => tasks.set(t.id, { id: t.id, title: t.title, status: t.status, due: t.due_date, assignee: t.assignee_name, projectId: t.project_id });
  for (const t of known) add(t);
  const deps = new Map<string, string[]>();
  let ask = [...new Set(blocked.map((t) => t.id))];
  for (let round = 0; round < 3 && ask.length; round += 1) {
    const { data, error } = await ctx.db.from("task_dependencies").select("task_id, depends_on_task_id").in("task_id", ask).eq("depends_on_open", true).limit(1000);
    if (error) fail("task dependencies", error);
    for (const id of ask) if (!deps.has(id)) deps.set(id, []);
    for (const d of data ?? []) deps.get(d.task_id)!.push(d.depends_on_task_id);
    const unknown = [...new Set((data ?? []).map((d) => d.depends_on_task_id).filter((id) => !tasks.has(id)))];
    if (unknown.length) {
      const r = await ctx.db.from("task_overview").select(TASK_COLS).in("id", unknown).is("deleted_at", null).limit(500);
      if (r.error) fail("blocking tasks", r.error);
      for (const t of toTaskRows(r.data)) add(t);
    }
    ask = [...new Set((data ?? []).map((d) => d.depends_on_task_id).filter((id) => tasks.has(id) && !deps.has(id)))];
  }
  const walked = firstOpenBlockers(blocked.map((t) => t.id), deps, tasks);
  return blocked.map((t) => {
    const w = walked.get(t.id) ?? { roots: [], hidden: 0 };
    return { task: t, roots: w.roots.map((id) => tasks.get(id)!).filter(Boolean), hidden: w.hidden };
  });
}

export function blockageLines(ctx: ToolContext, list: readonly Blockage[], max = 10): string[] {
  const out: string[] = [];
  for (const b of list.slice(0, max)) {
    out.push(`- ${clean(b.task.title)} [id: ${b.task.id}] is waiting on:`);
    for (const r of b.roots.slice(0, 5)) out.push(`    - ${clean(r.title)} [id: ${r.id}] - ${taskStatusLabel(r.status)}${r.due ? `, due ${day(ctx, r.due)}` : ""}, ${r.assignee ? clean(r.assignee) : "unassigned"}`);
    if (b.hidden) out.push(`    - ${b.hidden === 1 ? "a task" : `${b.hidden} tasks`} you cannot see`);
    if (!b.roots.length && !b.hidden) out.push("    - (its blockers are finished now; it should be free)");
  }
  if (list.length > max) out.push(`… ${list.length - max} more blocked task(s): open the project in HQ for all of them.`);
  return out;
}

export function projectHeadLine(ctx: ToolContext, p: ProjectRow): string {
  return `${p.ref} ${clean(p.name)} - ${statusWord(p.status)}, ${healthWord(p.health)}, ${p.progress_total ? `${p.progress_done} of ${p.progress_total} done (${p.progress_pct}%)` : "no tasks yet"}${p.target_date ? `, target ${day(ctx, p.target_date)}` : ""}${p.owner_name ? `, owner ${clean(p.owner_name)}` : ""} [id: ${p.id}] ${link(ctx, projectPath(p.id))}`;
}

/** Said whenever counts are shown to someone who cannot see every task. */
export const visibilityNote = (ctx: ToolContext) =>
  ctx.staff.capabilities.includes("tasks.read_all") ? null : "Counts and lists include only the tasks you can see (yours, and ones you created); colleagues' private tasks are not counted.";

/**
 * The person's own bulk budget right now (hq.bulk_budget) and when the oldest call in the rolling hour
 * drops out (their own hq.bulk_usage rows): for the honest refusal. Never throws; unknown stays null.
 */
export async function bulkBudget(ctx: ToolContext): Promise<{ callsUsed: number | null; callsLimit: number | null; itemsUsed: number | null; itemsLimit: number | null; retryAt: string | null }> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const [b, u] = await Promise.all([
    ctx.db.rpc("bulk_budget"),
    ctx.db.from("bulk_usage").select("at").eq("staff_id", ctx.staff.id).gt("at", since).order("at").limit(1),
  ]);
  const v = (b.error ? null : b.data) as Record<string, unknown> | null;
  const n = (k: string) => (v && typeof v[k] === "number" ? (v[k] as number) : null);
  const oldest = u.error ? null : (u.data?.[0]?.at ?? null);
  return {
    callsUsed: n("calls_used"),
    callsLimit: n("calls_per_hour"),
    itemsUsed: n("items_used"),
    itemsLimit: n("items_per_hour"),
    retryAt: oldest ? new Date(Date.parse(oldest) + 3_600_000 + 60_000).toISOString() : null,
  };
}

export type RpcError = { code?: string | null; message?: string | null; hint?: string | null; details?: string | null } | null | undefined;

/**
 * A refused RPC in words a person can act on. The project RPCs (0144) write their 22023 / 23514 / 23505 /
 * P0002 messages for people (they hold only what the person sent, never another record), so those are
 * shown; a permission refusal says so; anything else is the generic message (the log gets the code only).
 */
export function rpcFailure(where: string, error: RpcError, verb = "Not saved"): ToolResult {
  logDb(where, error);
  const code = error?.code ?? "";
  const msg = error?.message ? clean(error.message, 400) : "";
  if (code === "42501") return result("refused", `Refused by HQ: your role is not allowed to do that${error?.message && /requires|only|needs/.test(error.message) ? ` (${msg})` : ""}. Nothing was changed.`, { code });
  if (code === "P0002") return result("not_found", `${verb}: ${msg || "that record could not be found"}. It may be archived, or not visible to you. Nothing was changed.`, { code });
  if (error?.hint === "project_stale") return result("refused", `Not changed: ${msg}. Read it again (get_project), then make the change on the newest version.`, { code: "stale" });
  if (error?.hint === "idempotency_key_reused") return result("refused", `Not done: ${msg}. Nothing was written. If this is a retry of the SAME plan, send exactly the same entries; if the plan changed, generate a new idempotency key.`, { code: error.hint });
  if ((code === "22023" || code === "23514" || code === "23505") && msg) return result("invalid", `${verb}: ${msg}. Nothing was changed.`, { code, hint: error?.hint ?? null });
  return result("error", "Something went wrong reading or writing HQ, and nothing was changed. Try again in a moment.", { code });
}
