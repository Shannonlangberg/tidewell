/*
 * Task rules: everything about tasks that is a decision rather than a database call or a
 * picture. Pure, so `node --test` runs it, and it has NO value imports on purpose.
 *
 * Why one file with no imports: the unit tests run under Node's type stripping, which needs
 * relative imports to name the `.ts` file, and the project's tsconfig (which this feature does
 * not change) rejects that in source files. So a tested module can import types, but not the
 * values of its neighbours. The few tiny helpers that would have been imported (a uuid check,
 * a day count, the status lists) are written out below and pinned to their originals by a test
 * (rules.test.mts compares them with lib/hq/constants.ts, forms.ts and format.ts).
 *
 * Parts: 1 dates, 2 priority, 3 status transitions, 4 views, 5 list query and predicate,
 * 6 the "New task" link contract, 7 the task form's fields.
 */

import type { TaskPriority, TaskStatus } from "../constants";
import type { FormReader } from "../forms";

// ── helpers (same behaviour as the originals named beside each) ──

const ALL_STATUSES: readonly TaskStatus[] = ["to_do", "in_progress", "waiting", "completed", "cancelled"]; // constants.ts TASK_STATUSES
const OPEN_STATUSES: readonly TaskStatus[] = ["to_do", "in_progress", "waiting"]; // constants.ts OPEN_TASK_STATUSES
const ALL_PRIORITIES: readonly TaskPriority[] = ["low", "normal", "high", "urgent"]; // constants.ts TASK_PRIORITIES (the enum's declared order)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // forms.ts isUuid
/** forms.ts isUuid */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Whole calendar days from `today` to `date`: negative when `date` is in the past. (format.ts daysFromToday) */
function daysFromToday(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** First value of a search param, trimmed, bounded. (forms.ts strParam) */
function strParam(value: string | string[] | undefined, max = 200): string {
  const v = Array.isArray(value) ? value[0] : value;
  return (v ?? "").trim().slice(0, max);
}

/** Positive integer from a search param, bounded. (forms.ts intParam) */
function intParam(value: string | string[] | undefined, fallback: number, min = 1, max = 10_000): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(v ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}


// ════════════════════════════════════════════════════════════
// 1. Dates
// ════════════════════════════════════════════════════════════

export const UPCOMING_DAYS = 14;
/** How far back "Completed" reaches before the "show older" link. */
export const COMPLETED_RECENT_DAYS = 30;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date (rejects 2026-02-30). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * `date` plus `days` calendar days. Arithmetic is on the calendar (UTC midday), so a
 * daylight-saving change or a month or year boundary cannot move the answer.
 */
export function addDays(date: string, days: number): string {
  if (!isCalendarDate(date)) throw new Error(`addDays: not a calendar date: ${String(date)}`);
  const t = Date.parse(`${date}T12:00:00Z`) + Math.trunc(days) * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function isOpenStatus(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

export type DueBucket = "overdue" | "today" | "upcoming" | "later" | "none";

/**
 * Where a due date sits relative to today. This says nothing about status: a completed task
 * can have a "past" bucket, but it is not overdue (see `isOverdue`).
 */
export function dueBucket(due: string | null | undefined, today: string, upcomingDays: number = UPCOMING_DAYS): DueBucket {
  const n = daysFromToday(due, today);
  if (n === null) return "none";
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  if (n <= upcomingDays) return "upcoming";
  return "later";
}

/** Overdue means due before today AND still open. A completed or cancelled task is never overdue. */
export function isOverdue(status: TaskStatus, due: string | null | undefined, today: string): boolean {
  return isOpenStatus(status) && dueBucket(due, today) === "overdue";
}

/** True when a date the person is about to save has already passed (a warning, not an error). */
export function isPastDate(due: string | null | undefined, today: string): boolean {
  const n = daysFromToday(due, today);
  return n !== null && n < 0;
}

/** "1 day overdue", "5 days overdue". Empty when the date is not in the past. */
export function overdueLabel(due: string | null | undefined, today: string): string {
  const n = daysFromToday(due, today);
  if (n === null || n >= 0) return "";
  return n === -1 ? "1 day overdue" : `${-n} days overdue`;
}

/**
 * The inclusive range of dates the Upcoming view covers: tomorrow through today + 14.
 * (Today has its own view.)
 */
export function upcomingRange(today: string, upcomingDays: number = UPCOMING_DAYS): { from: string; to: string } {
  return { from: addDays(today, 1), to: addDays(today, upcomingDays) };
}

/**
 * The instant before which a completed task is "older". Completion is stamped by the
 * database as a timestamp, so this is a timestamp window, not a calendar one.
 */
export function completedCutoff(now: Date, days: number = COMPLETED_RECENT_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

// ════════════════════════════════════════════════════════════
// 2. Priority
// ════════════════════════════════════════════════════════════

export const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

/** Higher is more pressing. An unknown value ranks below everything. */
export function priorityRank(priority: string | null | undefined): number {
  return priority && priority in PRIORITY_RANK ? PRIORITY_RANK[priority as TaskPriority] : -1;
}

/** Comparator: most pressing first. */
export function comparePriorityDesc(a: string, b: string): number {
  return priorityRank(b) - priorityRank(a);
}

/** The priorities from most to least pressing: urgent, high, normal, low. */
export const PRIORITIES_DESC: readonly TaskPriority[] = [...ALL_PRIORITIES].reverse();

// ════════════════════════════════════════════════════════════
// 3. Status transitions
// ════════════════════════════════════════════════════════════

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  to_do: ["in_progress", "waiting", "completed", "cancelled"],
  in_progress: ["to_do", "waiting", "completed", "cancelled"],
  waiting: ["to_do", "in_progress", "completed", "cancelled"],
  completed: ["to_do", "in_progress"],
  cancelled: ["to_do"],
};

export function allowedTransitions(from: TaskStatus): readonly TaskStatus[] {
  return ALLOWED[from];
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function isOpen(status: TaskStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Completed or cancelled. */
export function isClosed(status: TaskStatus): boolean {
  return !isOpen(status);
}

/** Where "Reopen" puts a closed task. */
export const REOPEN_STATUS: TaskStatus = "to_do";

/** The status a quick "tick" on the list moves a task to: complete an open one, reopen a closed one. */
export function quickToggleTarget(from: TaskStatus): TaskStatus {
  return isOpen(from) ? "completed" : REOPEN_STATUS;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (ALL_STATUSES as readonly string[]).includes(value);
}

// ════════════════════════════════════════════════════════════
// 4. Views
// ════════════════════════════════════════════════════════════

export const TASK_VIEW_KEYS = ["mine", "today", "overdue", "upcoming", "waiting", "team", "delegated", "completed", "all"] as const;
export type TaskViewKey = (typeof TASK_VIEW_KEYS)[number];

export const SORT_KEYS = ["due", "priority", "created", "completed"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** Whose tasks: mine, everyone's but mine (and nobody's), or any. */
export type AssigneeScope = "me" | "not_me" | "any";
export type DueScope = "today" | "overdue" | "upcoming";

export type TaskViewDef = {
  key: TaskViewKey;
  label: string;
  /** Who is OFFERED the tab. read_all = holds tasks.read_all; no_read_all = does not. */
  audience: "everyone" | "read_all" | "no_read_all";
  /** The statuses the view lists when no status filter is chosen. */
  statuses: readonly TaskStatus[];
  /** The statuses the Status filter may pick from. Empty hides the filter. */
  statusChoices: readonly TaskStatus[];
  assignee: AssigneeScope;
  /** Whether the person may narrow to one assignee (Team, All). */
  assigneeFilter: boolean;
  /** Only tasks the person created (Assigned by me). */
  createdByMe: boolean;
  due: DueScope | null;
  /** Completed in the last 30 days, unless "show older" is on. */
  recentCompleted: boolean;
  defaultSort: SortKey;
  /** One line under the tabs that says what the view is. */
  description: string;
  empty: { title: string; body: string };
};

const OPEN: readonly TaskStatus[] = OPEN_STATUSES;

export const TASK_VIEWS: Record<TaskViewKey, TaskViewDef> = {
  mine: {
    key: "mine",
    label: "My tasks",
    audience: "everyone",
    statuses: OPEN,
    statusChoices: OPEN,
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: null,
    recentCompleted: false,
    defaultSort: "due",
    description: "Open tasks assigned to you.",
    empty: { title: "You have no tasks", body: "Create one to keep track of a follow-up, a call or anything else that needs doing." },
  },
  today: {
    key: "today",
    label: "Due today",
    audience: "everyone",
    statuses: OPEN,
    statusChoices: OPEN,
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: "today",
    recentCompleted: false,
    defaultSort: "priority",
    description: "Your open tasks that are due today.",
    empty: { title: "Nothing due today", body: "Tasks with today's date as their due date appear here." },
  },
  overdue: {
    key: "overdue",
    label: "Overdue",
    audience: "everyone",
    statuses: OPEN,
    statusChoices: OPEN,
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: "overdue",
    recentCompleted: false,
    defaultSort: "due",
    description: "Your open tasks that are past their due date, oldest first.",
    empty: { title: "No overdue tasks", body: "Everything of yours with a due date is on time." },
  },
  upcoming: {
    key: "upcoming",
    label: "Upcoming",
    audience: "everyone",
    statuses: OPEN,
    statusChoices: OPEN,
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: "upcoming",
    recentCompleted: false,
    defaultSort: "due",
    description: `Your open tasks due in the next ${UPCOMING_DAYS} days, starting tomorrow.`,
    empty: { title: `Nothing due in the next ${UPCOMING_DAYS} days`, body: "Tasks with a due date from tomorrow onwards appear here." },
  },
  waiting: {
    key: "waiting",
    label: "Waiting",
    audience: "everyone",
    statuses: ["waiting"],
    statusChoices: [],
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: null,
    recentCompleted: false,
    defaultSort: "due",
    description: "Your tasks that are waiting on someone or something else.",
    empty: { title: "Nothing is waiting", body: "Set a task to Waiting when you need something from someone else, and it appears here." },
  },
  team: {
    key: "team",
    label: "Team tasks",
    audience: "read_all",
    statuses: OPEN,
    statusChoices: ALL_STATUSES,
    assignee: "not_me",
    assigneeFilter: true,
    createdByMe: false,
    due: null,
    recentCompleted: false,
    defaultSort: "due",
    description: "Open tasks assigned to other people, and tasks nobody has picked up yet.",
    empty: { title: "No open tasks for the team", body: "Open tasks assigned to other people, and tasks with no assignee, appear here." },
  },
  delegated: {
    key: "delegated",
    label: "Assigned by me",
    audience: "no_read_all",
    statuses: OPEN,
    statusChoices: ALL_STATUSES,
    assignee: "not_me",
    assigneeFilter: false,
    createdByMe: true,
    due: null,
    recentCompleted: false,
    defaultSort: "due",
    description: "Tasks you created and gave to someone else.",
    empty: { title: "You haven't given anyone a task", body: "When you create a task and assign it to a colleague, you can follow it here." },
  },
  completed: {
    key: "completed",
    label: "Completed",
    audience: "everyone",
    statuses: ["completed"],
    statusChoices: [],
    assignee: "me",
    assigneeFilter: false,
    createdByMe: false,
    due: null,
    recentCompleted: true,
    defaultSort: "completed",
    description: "Tasks assigned to you that you finished in the last 30 days.",
    empty: { title: "No completed tasks", body: "Tasks you complete appear here for 30 days." },
  },
  all: {
    key: "all",
    label: "All tasks",
    audience: "read_all",
    statuses: ALL_STATUSES,
    statusChoices: ALL_STATUSES,
    assignee: "any",
    assigneeFilter: true,
    createdByMe: false,
    due: null,
    recentCompleted: false,
    defaultSort: "created",
    description: "Every task you can see, whatever its status, newest first.",
    empty: { title: "No tasks yet", body: "Every task in HQ that you can see appears here." },
  },
};

export function isViewKey(value: unknown): value is TaskViewKey {
  return typeof value === "string" && (TASK_VIEW_KEYS as readonly string[]).includes(value);
}

/** Whether a view is offered to a person who does or does not hold tasks.read_all. */
export function viewOffered(def: TaskViewDef, canReadAll: boolean): boolean {
  if (def.audience === "everyone") return true;
  return def.audience === "read_all" ? canReadAll : !canReadAll;
}

/** The tabs, in display order, for this person. */
export function viewsFor(canReadAll: boolean): TaskViewDef[] {
  return TASK_VIEW_KEYS.map((k) => TASK_VIEWS[k]).filter((d) => viewOffered(d, canReadAll));
}

/** A requested view, or "My tasks" when it is unknown or not offered to this person. */
export function resolveView(value: unknown, canReadAll: boolean): TaskViewKey {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!isViewKey(raw)) return "mine";
  return viewOffered(TASK_VIEWS[raw], canReadAll) ? raw : "mine";
}

// ════════════════════════════════════════════════════════════
// 5. List query, predicate and ordering
// ════════════════════════════════════════════════════════════

export const LIST_PAGE_SIZE = 25;
export const Q_MAX = 100;

export const RELATED_FILTERS = ["contact", "organisation", "referral", "opportunity", "contractor", "none"] as const;
export type RelatedFilter = (typeof RELATED_FILTERS)[number];
export const RELATED_FILTER_LABEL: Record<RelatedFilter, string> = {
  contact: "Linked to a contact",
  organisation: "Linked to an organisation",
  referral: "Linked to a referral",
  opportunity: "Linked to an opportunity",
  contractor: "Linked to a contractor",
  none: "Not linked to anything",
};

export type SearchParamsObject = Record<string, string | string[] | undefined>;

export type TaskListQuery = {
  view: TaskViewKey;
  /** Title search, trimmed and bounded. Empty when none. */
  q: string;
  priority: TaskPriority | null;
  status: TaskStatus | null;
  related: RelatedFilter | null;
  /** "me", "none", or a staff id. Only some views honour it. */
  assignee: string | null;
  sort: SortKey;
  dir: SortDir;
  page: number;
  /** Completed view: include tasks finished more than 30 days ago. */
  older: boolean;
  /** Whether any filter the person chose is applied (shows "Clear filters"). */
  filtered: boolean;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function allowed<T extends string>(list: readonly T[], value: string): T | null {
  return (list as readonly string[]).includes(value) ? (value as T) : null;
}

/** The direction a column starts in: urgent first, soonest first, newest first. */
export function defaultDirFor(sort: SortKey): SortDir {
  return sort === "due" ? "asc" : "desc";
}

export function parseTaskListQuery(sp: SearchParamsObject, opts: { canReadAll: boolean; /** Whether the "linked records" filter is offered (growth.read). Default true. */ canFilterRelated?: boolean }): TaskListQuery {
  const view = resolveView(sp.view, opts.canReadAll);
  const def = TASK_VIEWS[view];

  const q = strParam(sp.q, Q_MAX).replace(/\s+/g, " ");
  const priority = allowed(ALL_PRIORITIES, first(sp.priority));
  const status = allowed(ALL_STATUSES, first(sp.status));
  const related = opts.canFilterRelated === false ? null : allowed(RELATED_FILTERS, first(sp.related));

  const rawAssignee = first(sp.assignee).trim().toLowerCase();
  const assignee = rawAssignee === "me" || rawAssignee === "none" ? rawAssignee : isUuid(rawAssignee) ? rawAssignee : null;

  const sort = allowed(SORT_KEYS, first(sp.sort)) ?? def.defaultSort;
  const dir = allowed(["asc", "desc"] as const, first(sp.dir)) ?? defaultDirFor(sort);
  const page = intParam(sp.page, 1, 1, 10_000);
  const older = first(sp.older) === "1";

  // Only the filters this view actually offers count as "applied".
  const statusApplies = status !== null && def.statusChoices.includes(status);
  const assigneeApplies = assignee !== null && def.assigneeFilter;
  const filtered = q !== "" || priority !== null || statusApplies || related !== null || assigneeApplies;

  return { view, q, priority, status, related, assignee, sort, dir, page, older, filtered };
}

/** The query for a view with nothing chosen: what its tab count is computed from. */
export function plainQuery(view: TaskViewKey): TaskListQuery {
  const def = TASK_VIEWS[view];
  return {
    view,
    q: "",
    priority: null,
    status: null,
    related: null,
    assignee: null,
    sort: def.defaultSort,
    dir: defaultDirFor(def.defaultSort),
    page: 1,
    older: false,
    filtered: false,
  };
}

// ── the predicate ────────────────────────────────────────────

export type AssigneePredicate =
  | { kind: "any" }
  | { kind: "is"; id: string }
  /** Assigned to someone other than `id`, or to nobody. */
  | { kind: "not"; id: string }
  | { kind: "none" };

export type DuePredicate = { eq?: string; lt?: string; gt?: string; lte?: string };

export type TaskPredicate = {
  statuses: TaskStatus[];
  assignee: AssigneePredicate;
  /** Only tasks this person created. */
  createdBy: string | null;
  due: DuePredicate | null;
  /** completed_at on or after this instant. */
  completedSince: string | null;
  priority: TaskPriority | null;
  related: RelatedFilter | null;
  /** Raw title text; the query layer escapes it. */
  title: string | null;
};

export type PredicateContext = {
  /** The signed-in person's id, from the session. */
  meId: string;
  /** Their today, as YYYY-MM-DD. */
  today: string;
  now: Date;
};

function dueFor(def: TaskViewDef, today: string): DuePredicate | null {
  switch (def.due) {
    case "today":
      return { eq: today };
    case "overdue":
      return { lt: today };
    case "upcoming":
      return { gt: today, lte: addDays(today, UPCOMING_DAYS) };
    default:
      return null;
  }
}

function assigneeFor(def: TaskViewDef, q: TaskListQuery, meId: string): AssigneePredicate {
  const me = meId.toLowerCase();
  const chosen = def.assigneeFilter ? q.assignee : null;
  switch (def.assignee) {
    case "me":
      return { kind: "is", id: me };
    case "not_me":
      if (chosen === "none") return { kind: "none" };
      // "Me" is not a choice in Team (it is the other tab); picking oneself changes nothing.
      if (chosen && chosen !== "me" && chosen !== me) return { kind: "is", id: chosen };
      return { kind: "not", id: me };
    case "any":
      if (chosen === "none") return { kind: "none" };
      if (chosen === "me") return { kind: "is", id: me };
      if (chosen) return { kind: "is", id: chosen };
      return { kind: "any" };
  }
}

/** One database predicate for a view plus whatever filters the person chose. */
export function buildPredicate(query: TaskListQuery, ctx: PredicateContext): TaskPredicate {
  const def = TASK_VIEWS[query.view];
  const statuses = query.status && def.statusChoices.includes(query.status) ? [query.status] : [...def.statuses];
  return {
    statuses,
    assignee: assigneeFor(def, query, ctx.meId),
    createdBy: def.createdByMe ? ctx.meId.toLowerCase() : null,
    due: dueFor(def, ctx.today),
    completedSince: def.recentCompleted && !query.older ? completedCutoff(ctx.now) : null,
    priority: query.priority,
    related: query.related,
    title: query.q || null,
  };
}

// ── ordering ─────────────────────────────────────────────────

export type OrderTerm = {
  column: "due_date" | "priority" | "created_at" | "completed_at" | "id";
  ascending: boolean;
  /** A missing date always sorts last, whichever way the column runs. */
  nullsFirst: boolean;
};

const term = (column: OrderTerm["column"], ascending: boolean): OrderTerm => ({ column, ascending, nullsFirst: false });

/**
 * The ORDER BY for a sort. `priority` sorts by the enum's declared order (see priority.ts), so
 * descending is urgent, high, normal, low. The id is always the last term, so a page boundary
 * never repeats or skips a row when the sort column ties.
 */
export function taskOrdering(sort: SortKey, dir: SortDir): OrderTerm[] {
  const asc = dir === "asc";
  switch (sort) {
    case "due":
      return [term("due_date", asc), term("priority", false), term("created_at", false), term("id", true)];
    case "priority":
      return [term("priority", asc), term("due_date", true), term("created_at", false), term("id", true)];
    case "created":
      return [term("created_at", asc), term("id", true)];
    case "completed":
      return [term("completed_at", asc), term("id", true)];
  }
}

// ════════════════════════════════════════════════════════════
// 6. The New task link contract
// ════════════════════════════════════════════════════════════

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;

export type NewTaskPrefill = {
  contact: string | null;
  contractor: string | null;
  organisation: string | null;
  referral: string | null;
  opportunity: string | null;
  title: string | null;
  due: string | null;
  /** A safe /hq path to go back to once the task is saved, or null. */
  returnTo: string | null;
};

type Params = Record<string, string | string[] | undefined>;

function uuidParam(value: string | string[] | undefined): string | null {
  const v = first(value).trim();
  return isUuid(v) ? v.toLowerCase() : null;
}

/** Control characters out, whitespace collapsed, cut to the title limit. */
export function cleanTitle(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
}

/**
 * Reads the contract query. `safePath` is what decides whether `return` is acceptable: it is
 * passed in (lib/hq/tasks/return-path.ts supplies the real one, built on lib/hq/next-path.ts)
 * because this file cannot import it. It must return a same-origin /hq path, or null.
 */
export function parseNewTaskQuery(sp: Params, safePath: (value: unknown) => string | null): NewTaskPrefill {
  const title = cleanTitle(first(sp.title));
  const due = first(sp.due).trim();
  return {
    contact: uuidParam(sp.contact),
    contractor: uuidParam(sp.contractor),
    organisation: uuidParam(sp.organisation),
    referral: uuidParam(sp.referral),
    opportunity: uuidParam(sp.opportunity),
    title: title === "" ? null : title,
    due: isCalendarDate(due) ? due : null,
    returnTo: safePath(first(sp.return)),
  };
}

/** Builds a contract URL: used by tests and by anything inside this feature that links to New task. */
export function newTaskHref(prefill: Partial<NewTaskPrefill> = {}): string {
  const params = new URLSearchParams();
  if (prefill.contact) params.set("contact", prefill.contact);
  if (prefill.contractor) params.set("contractor", prefill.contractor);
  if (prefill.organisation) params.set("organisation", prefill.organisation);
  if (prefill.referral) params.set("referral", prefill.referral);
  if (prefill.opportunity) params.set("opportunity", prefill.opportunity);
  if (prefill.title) params.set("title", prefill.title);
  if (prefill.due) params.set("due", prefill.due);
  if (prefill.returnTo) params.set("return", prefill.returnTo);
  const qs = params.toString();
  return qs ? `/hq/operations/tasks/new?${qs}` : "/hq/operations/tasks/new";
}

// ════════════════════════════════════════════════════════════
// 7. The task form's fields
// ════════════════════════════════════════════════════════════

export type TaskFormValues = {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  /** null = unassigned */
  assignedTo: string | null;
  contactId: string | null;
  organisationId: string | null;
  referralId: string | null;
  opportunityId: string | null;
  /** Phase 2: the contractor the task is about. */
  contractorId: string | null;
};

/** The labels the form summary uses for each field. */
export const TASK_FORM_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  due_date: "Due date",
  priority: "Priority",
  assigned_to: "Assigned to",
  related_contact_id: "Contact",
  related_organisation_id: "Organisation",
  related_referral_id: "Referral",
  related_opportunity_id: "Opportunity",
  related_contractor_id: "Contractor",
};

/**
 * Reads the task form from a FormReader (`new FormReader(formData)`, from lib/hq/forms.ts), which
 * is passed in because this file cannot import it. Field errors collect on `f.errors`.
 */
export function readTaskFields(f: FormReader): TaskFormValues {
  const title = f.requiredText("title", { max: TITLE_MAX, label: "Title" });
  const description = f.text("description", { max: DESCRIPTION_MAX, label: "Description" });
  const dueDate = f.date("due_date");
  const priority = f.oneOf("priority", ALL_PRIORITIES, { fallback: "normal" }) ?? "normal";
  const assignedTo = f.uuid("assigned_to");
  const contactId = f.uuid("related_contact_id");
  const organisationId = f.uuid("related_organisation_id");
  const referralId = f.uuid("related_referral_id");
  const opportunityId = f.uuid("related_opportunity_id");
  const contractorId = f.uuid("related_contractor_id");
  return {
    title,
    description,
    dueDate,
    priority,
    assignedTo: assignedTo ? assignedTo.toLowerCase() : null,
    contactId: contactId ? contactId.toLowerCase() : null,
    organisationId: organisationId ? organisationId.toLowerCase() : null,
    referralId: referralId ? referralId.toLowerCase() : null,
    opportunityId: opportunityId ? opportunityId.toLowerCase() : null,
    contractorId: contractorId ? contractorId.toLowerCase() : null,
  };
}

/** What the form can be handed to start with (create with a prefill, or edit). */
export type TaskFormInitial = {
  title: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
  assignedTo: string;
  contactId: string;
  organisationId: string;
  referralId: string;
  opportunityId: string;
  contractorId: string;
};
