/*
 * Project rules: everything about projects that is a decision rather than a database call or a
 * picture. Pure and with NO value imports (the same reason as lib/hq/tasks/rules.ts: the unit tests
 * run under Node's type stripping). The few values copied from neighbours are pinned to their
 * originals by rules.test.mts.
 *
 * Parts: 1 labels and tones, 2 the list query, 3 the project page's view query, 4 forms,
 * 5 ordering and grouping, 6 the board, 7 health wording and progress, 8 small text helpers.
 *
 * The database is the authority for every number here (progress, health, blocked): these
 * functions only decide how to SAY what it returned.
 */

import type { TaskPriority, TaskStatus } from "../constants";
import type { FormReader } from "../forms";
import type { Milestone, ProjectHealth, ProjectStatus, ProjectTask } from "./types";

// ── copies (pinned by rules.test.mts) ────────────────────────

const TASK_STATUSES: readonly TaskStatus[] = ["to_do", "in_progress", "waiting", "completed", "cancelled"]; // constants.ts TASK_STATUSES
const OPEN: readonly TaskStatus[] = ["to_do", "in_progress", "waiting"]; // constants.ts OPEN_TASK_STATUSES
const PRIORITIES: readonly TaskPriority[] = ["low", "normal", "high", "urgent"]; // constants.ts TASK_PRIORITIES
const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 }; // tasks/rules.ts PRIORITY_RANK
/** tasks/rules.ts ALLOWED (status transitions) */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  to_do: ["in_progress", "waiting", "completed", "cancelled"],
  in_progress: ["to_do", "waiting", "completed", "cancelled"],
  waiting: ["to_do", "in_progress", "completed", "cancelled"],
  completed: ["to_do", "in_progress"],
  cancelled: ["to_do"],
};
export const TASK_STATUS_WORD: Record<TaskStatus, string> = { to_do: "To do", in_progress: "In progress", waiting: "Waiting", completed: "Completed", cancelled: "Cancelled" }; // constants.ts TASK_STATUS_LABEL
export const TASK_PRIORITY_WORD: Record<TaskPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" }; // constants.ts TASK_PRIORITY_LABEL

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();
const oneOf = <T extends string>(list: readonly T[], v: string): T | null => ((list as readonly string[]).includes(v) ? (v as T) : null);

/** Whole calendar days from `today` to `date` (negative in the past). (format.ts daysFromToday) */
export function daysBetween(today: string, date: string | null | undefined): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function isOpenTask(status: TaskStatus): boolean {
  return (OPEN as readonly string[]).includes(status);
}

export function isTaskOverdue(status: TaskStatus, due: string | null | undefined, today: string): boolean {
  const n = daysBetween(today, due);
  return isOpenTask(status) && n !== null && n < 0;
}

// ════════════════════════════════════════════════════════════
// 1. Labels and tones
// ════════════════════════════════════════════════════════════

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ["planning", "active", "on_hold"];

export const PROJECT_HEALTHS: readonly ProjectHealth[] = ["on_track", "at_risk", "off_track", "on_hold", "done"];
export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  on_hold: "On hold",
  done: "Done",
};

export type Tone = "neutral" | "info" | "success" | "warning" | "error";

export function projectStatusTone(s: ProjectStatus): Tone {
  switch (s) {
    case "active":
      return "info";
    case "on_hold":
      return "warning";
    case "completed":
      return "success";
    default:
      return "neutral";
  }
}

export function healthTone(h: ProjectHealth): Tone {
  switch (h) {
    case "on_track":
      return "success";
    case "at_risk":
      return "warning";
    case "off_track":
      return "error";
    default:
      return "neutral";
  }
}

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
}

export function isProjectHealth(v: unknown): v is ProjectHealth {
  return typeof v === "string" && (PROJECT_HEALTHS as readonly string[]).includes(v);
}

/** PRJ-0001 */
export function projectRef(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  return `PRJ-${String(n).padStart(4, "0")}`;
}

// ════════════════════════════════════════════════════════════
// 2. The projects list query
// ════════════════════════════════════════════════════════════

export type ProjectListQuery = {
  q: string;
  /** "open" (default: planning, active, on hold), "all", or one status. */
  status: ProjectStatus | "open" | "all";
  /** "me" or a staff id */
  owner: string | null;
  health: ProjectHealth | null;
  filtered: boolean;
};

export function parseProjectListQuery(sp: Params): ProjectListQuery {
  const q = first(sp.q).slice(0, 100).replace(/\s+/g, " ");
  const rawStatus = first(sp.status);
  const status = rawStatus === "all" ? "all" : (oneOf(PROJECT_STATUSES, rawStatus) ?? "open");
  const rawOwner = first(sp.owner).toLowerCase();
  const owner = rawOwner === "me" ? "me" : isUuid(rawOwner) ? rawOwner : null;
  const health = oneOf(PROJECT_HEALTHS, first(sp.health));
  return { q, status, owner, health, filtered: q !== "" || status !== "open" || owner !== null || health !== null };
}

// ════════════════════════════════════════════════════════════
// 3. The project page's view query
// ════════════════════════════════════════════════════════════

export const PROJECT_VIEWS = ["overview", "list", "board", "timeline"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];
export const PROJECT_VIEW_LABEL: Record<ProjectView, string> = { overview: "Overview", list: "List", board: "Board", timeline: "Timeline" };

export type ListGrouping = "milestone" | "status";

export type ProjectViewQuery = {
  view: ProjectView;
  group: ListGrouping;
  /** List filters: a status, "open" (default) or "all". */
  status: TaskStatus | "open" | "all";
  /** "me", "none" or a staff id */
  assignee: string | null;
  priority: TaskPriority | null;
  blockedOnly: boolean;
  filtered: boolean;
};

export function parseProjectViewQuery(sp: Params): ProjectViewQuery {
  const view = oneOf(PROJECT_VIEWS, first(sp.view)) ?? "overview";
  const group = first(sp.group) === "status" ? "status" : "milestone";
  const rawStatus = first(sp.status);
  const status = rawStatus === "all" ? "all" : (oneOf(TASK_STATUSES, rawStatus) ?? "open");
  const rawAssignee = first(sp.assignee).toLowerCase();
  const assignee = rawAssignee === "me" || rawAssignee === "none" ? rawAssignee : isUuid(rawAssignee) ? rawAssignee : null;
  const priority = oneOf(PRIORITIES, first(sp.priority));
  const blockedOnly = first(sp.blocked) === "1";
  return { view, group, status, assignee, priority, blockedOnly, filtered: status !== "open" || assignee !== null || priority !== null || blockedOnly };
}

/** The list filters, applied to the tasks the page loaded. A matching subtask keeps its parent row visible (dimmed by the caller if it does not match). */
export function filterProjectTasks(tasks: readonly ProjectTask[], q: Pick<ProjectViewQuery, "status" | "assignee" | "priority" | "blockedOnly">, meId: string): ProjectTask[] {
  const me = meId.toLowerCase();
  return tasks.filter((t) => {
    if (q.status === "open" && !isOpenTask(t.status)) return false;
    if (q.status !== "open" && q.status !== "all" && t.status !== q.status) return false;
    if (q.assignee === "me" && t.assignedTo !== me) return false;
    if (q.assignee === "none" && t.assignedTo !== null) return false;
    if (q.assignee && q.assignee !== "me" && q.assignee !== "none" && t.assignedTo !== q.assignee) return false;
    if (q.priority && t.priority !== q.priority) return false;
    if (q.blockedOnly && !t.blocked) return false;
    return true;
  });
}

// ════════════════════════════════════════════════════════════
// 4. Forms
// ════════════════════════════════════════════════════════════

export const NAME_MAX = 200;
export const PROJECT_DESCRIPTION_MAX = 5000;
export const NOTES_MAX = 50_000;
export const MILESTONE_DESCRIPTION_MAX = 2000;
export const DOC_TITLE_MAX = 200;
export const DOC_URL_MAX = 500;
export const CHECKLIST_TEXT_MAX = 300;
export const CHECKLIST_MAX_ITEMS = 50;
export const COMMENT_MAX = 4000;
export const BLOCKED_REASON_MAX = 500;
export const STATUS_NOTE_MAX = 500;

export type ProjectFormValues = {
  name: string;
  description: string | null;
  ownerId: string | null;
  status: ProjectStatus;
  priority: TaskPriority;
  startDate: string | null;
  targetDate: string | null;
  notes: string | null;
};

export const PROJECT_FORM_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  owner_id: "Owner",
  status: "Status",
  priority: "Priority",
  start_date: "Start date",
  target_date: "Target date",
  notes: "Notes",
};

/** Reads the project form (FormReader from lib/hq/forms.ts is passed in). A target before the start is a field error. */
export function readProjectFields(f: FormReader): ProjectFormValues {
  const name = f.requiredText("name", { max: NAME_MAX, label: "Name" });
  const description = f.text("description", { max: PROJECT_DESCRIPTION_MAX, label: "Description" });
  const owner = f.uuid("owner_id");
  const status = f.oneOf("status", PROJECT_STATUSES, { fallback: "planning" }) ?? "planning";
  const priority = f.oneOf("priority", PRIORITIES, { fallback: "normal" }) ?? "normal";
  const startDate = f.date("start_date");
  const targetDate = f.date("target_date");
  const notes = f.text("notes", { max: NOTES_MAX, label: "Notes" });
  if (startDate && targetDate && targetDate < startDate) f.errors.target_date = "The target date can't be before the start date.";
  return { name, description, ownerId: owner ? owner.toLowerCase() : null, status, priority, startDate, targetDate, notes };
}

export type MilestoneFormValues = { name: string; description: string | null; dueDate: string | null };

export function readMilestoneFields(f: FormReader): MilestoneFormValues {
  const name = f.requiredText("name", { max: NAME_MAX, label: "Milestone name" });
  const description = f.text("description", { max: MILESTONE_DESCRIPTION_MAX, label: "Description" });
  const dueDate = f.date("due_date");
  return { name, description, dueDate };
}

/** https only, at most 500 characters, a real host. Returns the normalised URL or null. */
export function safeDocumentUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || v.length > DOC_URL_MAX) return null;
  if (!/^https:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return u.toString().slice(0, DOC_URL_MAX);
  } catch {
    return null;
  }
}

export function readDocumentFields(f: FormReader, formData: { get(name: string): unknown }): { title: string; url: string | null } {
  const title = f.requiredText("title", { max: DOC_TITLE_MAX, label: "Title" });
  const raw = formData.get("url");
  const text = typeof raw === "string" ? raw.trim() : "";
  let url: string | null = null;
  if (!text) f.errors.url = "A link is required.";
  else {
    url = safeDocumentUrl(text);
    if (!url) f.errors.url = "Use a full https:// link, 500 characters or fewer.";
  }
  return { title, url };
}

/**
 * The checklist editor posts its items as repeated `item` fields (text) and `done` fields (the
 * index of each ticked item). Blank lines are dropped; the order posted is the order kept.
 */
export function readChecklist(formData: { getAll(name: string): unknown[] }): { items: { text: string; done: boolean }[]; error: string | null } {
  const texts = formData.getAll("item").map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""));
  const done = new Set(formData.getAll("done").map((v) => (typeof v === "string" ? Number.parseInt(v, 10) : -1)));
  const items: { text: string; done: boolean }[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (!text) continue;
    if (text.length > CHECKLIST_TEXT_MAX) return { items: [], error: `Each item must be ${CHECKLIST_TEXT_MAX} characters or fewer.` };
    items.push({ text, done: done.has(i) });
  }
  if (items.length > CHECKLIST_MAX_ITEMS) return { items: [], error: `A checklist can have at most ${CHECKLIST_MAX_ITEMS} items.` };
  return { items, error: null };
}

/** Moves one item up (-1) or down (+1), returning a new array (unchanged when it would leave the list). */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  const out = [...list];
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return out;
  const [x] = out.splice(index, 1);
  out.splice(to, 0, x);
  return out;
}

// ════════════════════════════════════════════════════════════
// 5. Ordering and grouping
// ════════════════════════════════════════════════════════════

/** The order tasks are listed in inside a group: their sort order, then the soonest due (none last), then the most pressing, then the oldest. */
export function compareTasks(a: ProjectTask, b: ProjectTask): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  const p = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
  if (p !== 0) return p;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareMilestones(a: Milestone, b: Milestone): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

export type TaskRow = {
  task: ProjectTask;
  /** 0 = a task, 1 = a subtask drawn under its parent */
  depth: 0 | 1;
};

export type TaskGroup = {
  key: string;
  label: string;
  /** The milestone, when grouped by milestone (null for "No milestone"). */
  milestone: Milestone | null;
  status: TaskStatus | null;
  rows: TaskRow[];
};

/**
 * Rows with each subtask straight after its parent (one level only). A subtask whose parent is
 * not among `tasks` (filtered out, in another group, or not visible) is listed as an ordinary row.
 */
export function nestRows(tasks: readonly ProjectTask[]): TaskRow[] {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, ProjectTask[]>();
  const tops: ProjectTask[] = [];
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId) && t.parentId !== t.id) {
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    } else tops.push(t);
  }
  const rows: TaskRow[] = [];
  for (const t of [...tops].sort(compareTasks)) {
    rows.push({ task: t, depth: 0 });
    for (const c of (children.get(t.id) ?? []).sort(compareTasks)) rows.push({ task: c, depth: 1 });
  }
  return rows;
}

/**
 * Groups for the List view. By milestone: one group per milestone in its order, then "No
 * milestone" (a subtask follows its parent's milestone so the indent stays together). By status:
 * To do, In progress, Waiting, Completed, Cancelled. Empty groups are kept for milestones (so a
 * new milestone can be seen and filled) and dropped for statuses.
 */
export function groupTasks(tasks: readonly ProjectTask[], milestones: readonly Milestone[], by: ListGrouping): TaskGroup[] {
  if (by === "status") {
    return TASK_STATUSES.map((s) => ({ key: s, label: TASK_STATUS_WORD[s], milestone: null, status: s, rows: nestRows(tasks.filter((t) => t.status === s)) })).filter((g) => g.rows.length > 0);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const milestoneOf = (t: ProjectTask): string | null => {
    const parent = t.parentId ? byId.get(t.parentId) : undefined;
    return parent ? parent.milestoneId : t.milestoneId;
  };
  const known = new Set(milestones.map((m) => m.id));
  const groups: TaskGroup[] = [...milestones].sort(compareMilestones).map((m) => ({
    key: m.id,
    label: m.name,
    milestone: m,
    status: null,
    rows: nestRows(tasks.filter((t) => milestoneOf(t) === m.id)),
  }));
  const loose = tasks.filter((t) => {
    const m = milestoneOf(t);
    return !m || !known.has(m);
  });
  if (loose.length > 0 || milestones.length === 0) groups.push({ key: "none", label: milestones.length === 0 ? "Tasks" : "No milestone", milestone: null, status: null, rows: nestRows(loose) });
  return groups;
}

// ════════════════════════════════════════════════════════════
// 6. The board
// ════════════════════════════════════════════════════════════

/** Board columns. Cancelled tasks are not a column (they are counted under the board). */
export const BOARD_COLUMNS: readonly TaskStatus[] = ["to_do", "in_progress", "waiting", "completed"];

/** Where a card may move from its status (the same transitions the task page allows). */
export function moveTargets(from: TaskStatus): TaskStatus[] {
  return TRANSITIONS[from].filter((s) => s !== from);
}

export function canMove(from: TaskStatus, to: TaskStatus): boolean {
  return from !== to && TRANSITIONS[from].includes(to);
}

export function boardColumns(tasks: readonly ProjectTask[]): { status: TaskStatus; tasks: ProjectTask[] }[] {
  return BOARD_COLUMNS.map((s) => ({ status: s, tasks: tasks.filter((t) => t.status === s).sort(compareTasks) }));
}

/** What a refused drop says. */
export function moveRefusal(from: TaskStatus, to: TaskStatus): string {
  if (from === to) return "";
  if (from === "completed" || from === "cancelled") return `A ${TASK_STATUS_WORD[from].toLowerCase()} task can only be reopened: move it to ${TRANSITIONS[from].map((x) => TASK_STATUS_WORD[x]).join(" or ")}.`;
  return `A task can't move from ${TASK_STATUS_WORD[from]} to ${TASK_STATUS_WORD[to]}.`;
}

// ════════════════════════════════════════════════════════════
// 7. Health wording and progress
// ════════════════════════════════════════════════════════════

export type HealthInput = {
  health: ProjectHealth;
  /** hq.project_overview.health_reasons: the database's own plain-language reasons (the authority). */
  reasons: readonly string[];
  blockedCount: number;
  /** Tasks counted for progress (top-level, not cancelled). */
  totalCount: number;
};

/** A reason as a sentence: capital first letter, a full stop at the end, no doubled spaces. */
export function asSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/**
 * The lines under the health word. The rules and their wording are the database's
 * (hq.project_overview, migration 0143): off track when a task is more than 7 days overdue, a
 * milestone is overdue or the target date has passed; at risk when any task is overdue, or the
 * target is within 14 days with under 60% done. This only tidies them into sentences and adds two
 * plain facts the rules do not cover: that there are no tasks yet, and how many tasks are waiting
 * on other tasks.
 */
export function healthLines(p: HealthInput): string[] {
  const lines = p.reasons.map(asSentence).filter(Boolean);
  if (p.totalCount === 0 && (p.health === "on_track" || p.health === "at_risk")) {
    return [...lines.filter((l) => !/comfortable/i.test(l)), "No tasks yet: add the first few steps and progress will show here."];
  }
  if (p.blockedCount > 0 && p.health !== "done") lines.push(p.blockedCount === 1 ? "1 task is waiting on another task." : `${p.blockedCount} tasks are waiting on other tasks.`);
  return lines;
}

/** "3 of 12 done", "No tasks yet" */
export function progressText(done: number, total: number): string {
  if (total <= 0) return "No tasks yet";
  return `${done} of ${total} done`;
}

/** A width for the thin progress rule, 0..100, whole numbers. */
export function progressWidth(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

// ════════════════════════════════════════════════════════════
// 8. Small text helpers
// ════════════════════════════════════════════════════════════

/** "Jane Citizen" -> "JC" (format.ts initials) */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const a = parts[0][0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (a + b).toUpperCase();
}

/** "Due today", "Due tomorrow", "Due in 4 days", "3 days overdue", "" when no date. Closed tasks say nothing about lateness. */
export function dueWords(due: string | null, status: TaskStatus, today: string): string {
  const n = daysBetween(today, due);
  if (n === null) return "";
  if (!isOpenTask(status)) return "";
  if (n < 0) return n === -1 ? "1 day overdue" : `${-n} days overdue`;
  if (n === 0) return "Due today";
  if (n === 1) return "Due tomorrow";
  if (n <= 14) return `Due in ${n} days`;
  return "";
}

/** "n/m" for the checklist, or "" when there is none. */
export function checklistText(done: number, total: number): string {
  return total > 0 ? `${done}/${total}` : "";
}
