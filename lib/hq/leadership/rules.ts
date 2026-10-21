/*
 * The command center's rules (docs/hq-command-center.md): the Workboard lanes, the focus score and its
 * reasons, launch readiness, the week plan and the relationship stages. Pure and with NO value imports
 * (the unit tests run under Node's type stripping, as lib/hq/projects/rules.ts).
 *
 * The principle behind every function here: it READS official fields (status, priority, due date,
 * dependencies, milestones) and explains what it concluded. Nothing here writes. A lane is a view
 * worked out from the task, never a new status; a score is a suggestion with its reasons, never a
 * change of priority. The only field a person moves to rearrange their own week is planned_for.
 *
 * Parts: 1 dates, 2 waiting, 3 lanes, 4 the focus score, 5 focus and today, 6 launch readiness,
 * 7 the week plan, 8 relationship stages.
 */

import type { TaskPriority, TaskStatus } from "../constants";
import type { LeaderTask, LaunchMilestone, Lane, PlanningItem, PlanningKind, PlanningStatus } from "./types";

// ════════════════════════════════════════════════════════════
// 1. Dates ("YYYY-MM-DD", calendar days, no timezone: today comes from hq.today())
// ════════════════════════════════════════════════════════════

const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(ms(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `today` to `date` (negative in the past); null for no date. */
export function daysFrom(today: string, date: string | null | undefined): number | null {
  if (!date) return null;
  const a = ms(date);
  const b = ms(today);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** 0 Sunday .. 6 Saturday. */
export function weekday(date: string): number {
  return new Date(ms(date)).getUTCDay();
}

/** The Monday of the week AFTER the one `today` is in (today a Sunday: tomorrow). */
export function nextMonday(today: string): string {
  const d = weekday(today);
  return addDays(today, d === 0 ? 1 : 8 - d);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "today", "tomorrow", "yesterday", "Mon 27 Oct" (with the year when it is not this year's). */
export function dayWords(date: string, today: string): string {
  const n = daysFrom(today, date);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  const d = new Date(ms(date));
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`;
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}${year}`;
}

export function isOpen(status: TaskStatus): boolean {
  return status === "to_do" || status === "in_progress" || status === "waiting";
}

// ════════════════════════════════════════════════════════════
// 2. Waiting: what a task is held up by, from the fields that say so
// ════════════════════════════════════════════════════════════

export type WaitKind = "dependency" | "planning" | "external" | "held" | "status";
export type Wait = { kind: WaitKind; text: string };

const LIVE_PLANNING: readonly PlanningStatus[] = ["anticipated", "confirmed"];

/**
 * Everything holding a task up, most specific first: another task (a dependency still open), a planning
 * item such as the anticipated funding, an outside party in words, a held-up reason, or simply the
 * waiting status with nothing recorded. Empty for a task that is free to move. A closed task waits on
 * nothing.
 */
export function waitsOf(t: LeaderTask): Wait[] {
  if (!isOpen(t.status)) return [];
  const out: Wait[] = [];
  if (t.isBlocked) out.push({ kind: "dependency", text: t.openDependencyCount === 1 ? "Waits for another task to finish" : `Waits for ${t.openDependencyCount} tasks to finish` });
  if (t.planningItemId && (t.planningItemStatus === null || LIVE_PLANNING.includes(t.planningItemStatus))) out.push({ kind: "planning", text: `Waiting on ${t.planningItemTitle ?? "a planning item"}` });
  if (t.waitingOn) out.push({ kind: "external", text: `Waiting on ${t.waitingOn}` });
  if (t.blockedReason) out.push({ kind: "held", text: `Held up: ${t.blockedReason}` });
  if (out.length === 0 && t.status === "waiting") out.push({ kind: "status", text: "Waiting (nothing recorded about what on)" });
  return out;
}

// ════════════════════════════════════════════════════════════
// 3. Lanes: Do now, In motion, Waiting, Coming next (a view, never a status)
// ════════════════════════════════════════════════════════════

export const LANES: readonly Lane[] = ["do_now", "in_motion", "waiting", "coming_next"];
export const LANE_LABEL: Record<Lane, string> = { do_now: "Do now", in_motion: "In motion", waiting: "Waiting", coming_next: "Coming next" };
export const LANE_HINT: Record<Lane, string> = {
  do_now: "Free to start and needed now",
  in_motion: "Started and moving",
  waiting: "Held up by someone or something",
  coming_next: "Free to start, not yet pressing",
};

/** How close a due date has to be before a task counts as "now": today and the next two days. */
export const DO_NOW_DAYS = 2;

/**
 * The lane, first rule that matches:
 *   closed (completed, cancelled)                      none
 *   anything holding it up (waitsOf)                    waiting
 *   status in_progress                                  in_motion
 *   overdue                                             do_now (an overdue task never hides in a later lane)
 *   planned for a later day                             coming_next (the person's own plan wins over "due soon")
 *   planned for today or earlier                        do_now
 *   due within DO_NOW_DAYS, or priority urgent          do_now
 *   otherwise                                           coming_next
 */
export function laneOf(t: LeaderTask, today: string): Lane | null {
  if (!isOpen(t.status)) return null;
  if (waitsOf(t).length > 0) return "waiting";
  if (t.status === "in_progress") return "in_motion";
  const due = daysFrom(today, t.dueDate);
  if (due !== null && due < 0) return "do_now";
  const planned = daysFrom(today, t.plannedFor);
  if (planned !== null) return planned > 0 ? "coming_next" : "do_now";
  if ((due !== null && due <= DO_NOW_DAYS) || t.priority === "urgent") return "do_now";
  return "coming_next";
}

/** Why the task is in its lane, in a few words (the first matching rule of laneOf). */
export function laneWhy(t: LeaderTask, today: string): string {
  const lane = laneOf(t, today);
  if (lane === null) return t.status === "completed" ? "Completed" : "Cancelled";
  if (lane === "waiting") return waitsOf(t)[0].text;
  if (lane === "in_motion") return "In progress";
  const due = daysFrom(today, t.dueDate);
  if (due !== null && due < 0) return due === -1 ? "Overdue by 1 day" : `Overdue by ${-due} days`;
  const planned = daysFrom(today, t.plannedFor);
  if (planned !== null) return planned > 0 ? `Planned for ${dayWords(t.plannedFor!, today)}` : planned === 0 ? "Planned for today" : `Planned for ${dayWords(t.plannedFor!, today)}`;
  if (due !== null && due <= DO_NOW_DAYS) return `Due ${dayWords(t.dueDate!, today)}`;
  if (t.priority === "urgent") return "Urgent";
  return t.dueDate ? `Due ${dayWords(t.dueDate, today)}` : "No date yet";
}

export function groupByLane(tasks: readonly LeaderTask[], today: string): Record<Lane, LeaderTask[]> {
  const out: Record<Lane, LeaderTask[]> = { do_now: [], in_motion: [], waiting: [], coming_next: [] };
  for (const t of tasks) {
    const l = laneOf(t, today);
    if (l) out[l].push(t);
  }
  for (const l of LANES) out[l].sort((a, b) => compareByScore(a, b, today));
  return out;
}

/**
 * What moving a card to a lane CHANGES (the patch for update_project_task), or a refusal. Moving never
 * touches priority or due date:
 *   do_now       status to_do (from waiting: what it waited on clears), planned_for today
 *   in_motion    status in_progress
 *   waiting      status waiting, with what it waits on (required unless the task already records it)
 *   coming_next  status to_do, planned_for the given day (default next Monday)
 * A task waiting on another unfinished task stays in Waiting whatever its status: that is said, not hidden.
 */
export type LanePatch = Record<string, string | null>;
export function laneMove(t: LeaderTask, to: Lane, today: string, opts: { waitingOn?: string | null; plannedFor?: string | null } = {}): { ok: true; patch: LanePatch; note: string | null } | { ok: false; message: string } {
  if (!isOpen(t.status)) return { ok: false, message: "That task is closed. Reopen it on its page first." };
  const note = t.isBlocked && to !== "waiting" ? "It still waits for another task to finish, so it stays in Waiting until that is done." : null;
  if (to === "do_now") return { ok: true, patch: { status: "to_do", planned_for: today }, note };
  if (to === "in_motion") return { ok: true, patch: { status: "in_progress" }, note };
  if (to === "coming_next") {
    const day = opts.plannedFor ?? nextMonday(today);
    if ((daysFrom(today, day) ?? 0) <= 0) return { ok: false, message: "Choose a day after today for Coming next." };
    return { ok: true, patch: { status: "to_do", planned_for: day }, note };
  }
  const words = opts.waitingOn?.trim() || null;
  if (!words && !t.waitingOn && !t.planningItemId && !t.isBlocked && !t.blockedReason) {
    return { ok: false, message: "Say what it is waiting on (for example \"Ailo to reply\")." };
  }
  return { ok: true, patch: words ? { status: "waiting", waiting_on: words } : { status: "waiting" }, note: null };
}

// ════════════════════════════════════════════════════════════
// 4. The focus score: points with reasons, explainable line by line
// ════════════════════════════════════════════════════════════

export type Factor = { key: string; label: string; points: number };
export type Scored = { score: number; factors: Factor[]; important: boolean; pressing: boolean };

/** The points, in one place so the page, the chat tools and the docs say the same thing. */
export const POINTS = {
  overdueBase: 40,
  overduePerDay: 2,
  overdueDayCap: 14,
  dueToday: 35,
  dueTomorrow: 28,
  dueIn3: 20,
  dueIn7: 10,
  plannedToday: 25,
  priority: { urgent: 30, high: 18, normal: 6, low: 0 } as Record<TaskPriority, number>,
  projectPriority: { urgent: 8, high: 4, normal: 0, low: 0 } as Record<TaskPriority, number>,
  launchGate: 10,
  milestoneOverdue: 12,
  milestoneSoon: 8,
  unblocksEach: 6,
  unblocksCap: 18,
  relationship: 6,
  pipeline: 6,
  inMotion: 5,
} as const;

/**
 * The deterministic score of an OPEN task for the person whose focus it is. Every point has a reason:
 *   time       overdue (40 + 2 a day, up to 14 days); due today 35, tomorrow 28, within 3 days 20,
 *              within 7 days 10; planned by you for today or earlier 25
 *   priority   the official priority: urgent 30, high 18, normal 6, low 0; the project's priority
 *              urgent +8, high +4
 *   milestones a milestone required to open +10; its milestone overdue +12, or due within 14 days +8
 *   unblocks   +6 for each open task waiting on it (at most +18)
 *   growth     linked to a contact, organisation or referral (a relationship follow-up) +6; linked to
 *              a lead (business development) +6
 *   momentum   already in progress +5
 * important = official priority high or urgent, a launch requirement, a high or urgent project, or it
 * unblocks others. pressing = something about TIME (overdue, due within 3 days, planned for today).
 * A task can be important without being pressing; the page says which.
 */
export function scoreTask(t: LeaderTask, today: string): Scored {
  const f: Factor[] = [];
  const due = daysFrom(today, t.dueDate);
  if (due !== null && due < 0) {
    const d = Math.min(-due, POINTS.overdueDayCap);
    f.push({ key: "overdue", label: -due === 1 ? "Overdue by 1 day" : `Overdue by ${-due} days`, points: POINTS.overdueBase + d * POINTS.overduePerDay });
  } else if (due === 0) f.push({ key: "due", label: "Due today", points: POINTS.dueToday });
  else if (due === 1) f.push({ key: "due", label: "Due tomorrow", points: POINTS.dueTomorrow });
  else if (due !== null && due <= 3) f.push({ key: "due", label: `Due in ${due} days`, points: POINTS.dueIn3 });
  else if (due !== null && due <= 7) f.push({ key: "due", label: `Due ${dayWords(t.dueDate!, today)}`, points: POINTS.dueIn7 });
  const planned = daysFrom(today, t.plannedFor);
  if (planned !== null && planned <= 0) f.push({ key: "planned", label: "You planned it for today", points: POINTS.plannedToday });

  const pp = POINTS.priority[t.priority] ?? 0;
  if (t.priority === "urgent" || t.priority === "high") f.push({ key: "priority", label: t.priority === "urgent" ? "Urgent" : "High priority", points: pp });
  else if (pp > 0) f.push({ key: "priority", label: "Normal priority", points: pp });
  const prp = t.projectPriority ? (POINTS.projectPriority[t.projectPriority] ?? 0) : 0;
  if (prp > 0) f.push({ key: "project", label: `${t.projectPriority === "urgent" ? "Urgent" : "High-priority"} project`, points: prp });

  if (t.milestoneLaunchGate) f.push({ key: "launch", label: "Required to open", points: POINTS.launchGate });
  const md = daysFrom(today, t.milestoneDue);
  if (t.milestoneName && md !== null && md < 0) f.push({ key: "milestone", label: `${t.milestoneName} is past due`, points: POINTS.milestoneOverdue });
  else if (t.milestoneName && md !== null && md <= 14) f.push({ key: "milestone", label: `${t.milestoneName} due ${dayWords(t.milestoneDue!, today)}`, points: POINTS.milestoneSoon });

  if (t.blockingCount > 0) f.push({ key: "unblocks", label: t.blockingCount === 1 ? "Unblocks 1 task" : `Unblocks ${t.blockingCount} tasks`, points: Math.min(t.blockingCount * POINTS.unblocksEach, POINTS.unblocksCap) });
  if (t.relationship) f.push({ key: "relationship", label: "Relationship follow-up", points: POINTS.relationship });
  if (t.pipeline) f.push({ key: "pipeline", label: "Business development", points: POINTS.pipeline });
  if (t.status === "in_progress") f.push({ key: "momentum", label: "Already in progress", points: POINTS.inMotion });

  f.sort((a, b) => b.points - a.points);
  const score = f.reduce((n, x) => n + x.points, 0);
  const important = t.priority === "urgent" || t.priority === "high" || t.milestoneLaunchGate || t.projectPriority === "urgent" || t.projectPriority === "high" || t.blockingCount > 0;
  const pressing = f.some((x) => x.key === "overdue" || x.key === "planned" || (x.key === "due" && due !== null && due <= 3));
  return { score, factors: f, important, pressing };
}

/** Highest score first; then the earlier due date (none last), then the older task, then id. */
export function compareByScore(a: LeaderTask, b: LeaderTask, today: string): number {
  const d = scoreTask(b, today).score - scoreTask(a, today).score;
  if (d !== 0) return d;
  if (a.dueDate !== b.dueDate) return a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/** "Important, not urgent" and friends: whether to treat it as today's work or as important work to plan. */
export function weightWords(s: Scored): string {
  if (s.important && s.pressing) return "Important and due now";
  if (s.pressing) return "Due now";
  if (s.important) return "Important, not pressing";
  return "Next up";
}

/** The reasons as one short line: the top three factors by points. */
export function whyLine(s: Scored): string {
  return s.factors.length ? s.factors.slice(0, 3).map((x) => x.label).join(" · ") : "Next up";
}

// ════════════════════════════════════════════════════════════
// 5. Focus (at most three) and the rest of today
// ════════════════════════════════════════════════════════════

export const FOCUS_MAX = 3;

export type FocusPick = { task: LeaderTask; scored: Scored; why: string; weight: string; lane: Lane };

/**
 * The person's focus: their OWN open tasks that can move now (not waiting, not a parent whose open
 * subtasks are the work), highest score first, at most `n` (3). Waiting tasks are never focus: they are
 * shown under Waiting On with their next follow-up instead. A task the person has planned for a LATER day
 * is not today's focus either (they moved it on purpose), unless it is overdue.
 */
export function pickFocus(tasks: readonly LeaderTask[], today: string, meId: string, n: number = FOCUS_MAX): FocusPick[] {
  return tasks
    .filter((t) => t.assignedTo === meId && t.subtaskOpen === 0)
    .map((t) => ({ t, lane: laneOf(t, today) }))
    .filter((x): x is { t: LeaderTask; lane: Lane } => x.lane !== null && x.lane !== "waiting")
    .filter(({ t }) => !((daysFrom(today, t.plannedFor) ?? 0) > 0 && !((daysFrom(today, t.dueDate) ?? 0) < 0)))
    .sort((a, b) => compareByScore(a.t, b.t, today))
    .slice(0, Math.max(0, n))
    .map(({ t, lane }) => {
      const scored = scoreTask(t, today);
      return { task: t, scored, why: whyLine(scored), weight: weightWords(scored), lane };
    });
}

/** The person's other open tasks due today or overdue (not already in focus), most pressing first. */
export function alsoDueToday(tasks: readonly LeaderTask[], today: string, meId: string, focusIds: ReadonlySet<string>): LeaderTask[] {
  return tasks
    .filter((t) => t.assignedTo === meId && isOpen(t.status) && !focusIds.has(t.id) && t.dueDate !== null && (daysFrom(today, t.dueDate) ?? 1) <= 0)
    .sort((a, b) => compareByScore(a, b, today));
}

// ════════════════════════════════════════════════════════════
// 6. Launch readiness: requirements met, apart from tasks done
// ════════════════════════════════════════════════════════════

export type Readiness = {
  /** Milestones marked "required to open": done of total. total 0 = none marked yet (no figure is shown). */
  gatesDone: number;
  gatesTotal: number;
  /** Top-level, non-cancelled tasks: done of total (the database's own progress figures). */
  tasksDone: number;
  tasksTotal: number;
  /** The first open milestone (by due date, then order), and the best next task in it, if any. */
  nextMilestone: LaunchMilestone | null;
  nextAction: LeaderTask | null;
  /** Open requirements still to meet, in order. */
  openGates: LaunchMilestone[];
};

export function launchReadiness(milestones: readonly LaunchMilestone[], tasks: readonly LeaderTask[], progress: { done: number; total: number }, today: string): Readiness {
  const ordered = [...milestones].sort(compareMilestone);
  const gates = ordered.filter((m) => m.launchGate);
  const open = ordered.filter((m) => m.status === "open");
  const movable = (t: LeaderTask) => {
    const l = laneOf(t, today);
    return l !== null && l !== "waiting" && t.subtaskOpen === 0;
  };
  // The next actionable milestone: the first open one with a task that can move now (else simply the first open one).
  const nextMilestone = open.find((m) => tasks.some((t) => t.milestoneId === m.id && movable(t))) ?? open[0] ?? null;
  const pool = tasks.filter((t) => movable(t) && (nextMilestone ? t.milestoneId === nextMilestone.id : true));
  const nextAction = [...(pool.length ? pool : tasks.filter(movable))].sort((a, b) => compareByScore(a, b, today))[0] ?? null;
  return {
    gatesDone: gates.filter((m) => m.status === "done").length,
    gatesTotal: gates.length,
    tasksDone: progress.done,
    tasksTotal: progress.total,
    nextMilestone,
    nextAction,
    openGates: gates.filter((m) => m.status === "open"),
  };
}

/** Open milestones and dated open tasks due from today to `days` ahead (and overdue ones), soonest first. */
export function upcomingCommitments(milestones: readonly LaunchMilestone[], tasks: readonly LeaderTask[], today: string, days = 21): Array<{ kind: "milestone" | "task"; id: string; title: string; date: string; overdue: boolean; launchGate: boolean }> {
  const out: Array<{ kind: "milestone" | "task"; id: string; title: string; date: string; overdue: boolean; launchGate: boolean }> = [];
  for (const m of milestones) {
    const n = daysFrom(today, m.dueDate);
    if (m.status === "open" && n !== null && n <= days) out.push({ kind: "milestone", id: m.id, title: m.name, date: m.dueDate!, overdue: n < 0, launchGate: m.launchGate });
  }
  for (const t of tasks) {
    const n = daysFrom(today, t.dueDate);
    if (isOpen(t.status) && t.parentId === null && n !== null && n <= days) out.push({ kind: "task", id: t.id, title: t.title, date: t.dueDate!, overdue: n < 0, launchGate: t.milestoneLaunchGate });
  }
  return out.sort((a, b) => (a.date === b.date ? (a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === "milestone" ? -1 : 1) : a.date < b.date ? -1 : 1));
}

export function compareMilestone(a: LaunchMilestone, b: LaunchMilestone): number {
  if (a.dueDate !== b.dueDate) return a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1;
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** The timeline's state for one milestone. */
export function milestoneState(m: LaunchMilestone, today: string): "done" | "overdue" | "next" | "open" {
  if (m.status === "done") return "done";
  const n = daysFrom(today, m.dueDate);
  return n !== null && n < 0 ? "overdue" : "open";
}

// ════════════════════════════════════════════════════════════
// 7. The week plan ("organise my tasks for next week"): a PROPOSAL of planned_for days
// ════════════════════════════════════════════════════════════

export type WeekPlanEntry = { taskId: string; title: string; plannedFor: string; dueDate: string | null; why: string };
export type WeekPlan = {
  weekStart: string;
  days: string[];
  entries: WeekPlanEntry[];
  /** Due before the week starts: this week's work, not moved. */
  dueBefore: LeaderTask[];
  /** More than the week holds at `perDay`: left in Coming next. */
  overflow: LeaderTask[];
  /** Waiting tasks, with their follow-up day if one falls in the week. */
  waiting: Array<{ task: LeaderTask; followUpInWeek: boolean }>;
};

/**
 * Spreads the person's movable open tasks across Monday to Friday of the week starting `weekStart`
 * (default: next Monday), at most `perDay` a day (default 4), highest score first. A task with a due date
 * in the week goes on the earliest day with room that is not after its due date (else the earliest day
 * with room, and the reason says it is tight). Tasks due before the week starts are listed, not moved.
 * Waiting tasks are never planned; they are listed with whether their follow-up falls in the week.
 * Only planned_for would change if applied: no status, priority or due date.
 */
export function planWeek(tasks: readonly LeaderTask[], today: string, meId: string, opts: { weekStart?: string; perDay?: number } = {}): WeekPlan {
  const weekStart = opts.weekStart ?? nextMonday(today);
  const perDay = Math.min(Math.max(opts.perDay ?? 4, 1), 12);
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
  const load = new Map(days.map((d) => [d, 0]));
  const mine = tasks.filter((t) => t.assignedTo === meId && isOpen(t.status) && t.subtaskOpen === 0);
  const waiting = mine.filter((t) => laneOf(t, today) === "waiting").map((task) => ({ task, followUpInWeek: !!task.nextFollowUp && task.nextFollowUp >= days[0] && task.nextFollowUp <= days[4] }));
  const movable = mine.filter((t) => laneOf(t, today) !== "waiting");
  const dueBefore = movable.filter((t) => t.dueDate !== null && t.dueDate < weekStart).sort((a, b) => compareByScore(a, b, today));
  const rest = movable.filter((t) => !(t.dueDate !== null && t.dueDate < weekStart)).sort((a, b) => compareByScore(a, b, weekStart));
  const entries: WeekPlanEntry[] = [];
  const overflow: LeaderTask[] = [];
  for (const t of rest) {
    const room = days.filter((d) => (load.get(d) ?? 0) < perDay);
    if (room.length === 0) {
      overflow.push(t);
      continue;
    }
    const fit = t.dueDate && t.dueDate <= days[4] ? room.find((d) => d <= t.dueDate!) : room[0];
    const day = fit ?? room[0];
    load.set(day, (load.get(day) ?? 0) + 1);
    const s = scoreTask(t, weekStart);
    const tight = t.dueDate !== null && day > t.dueDate;
    entries.push({ taskId: t.id, title: t.title, plannedFor: day, dueDate: t.dueDate, why: tight ? `Due ${dayWords(t.dueDate!, today)}: the days before it are full` : whyLine(s) });
  }
  entries.sort((a, b) => (a.plannedFor === b.plannedFor ? 0 : a.plannedFor < b.plannedFor ? -1 : 1));
  return { weekStart, days, entries, dueBefore, overflow, waiting };
}

// ════════════════════════════════════════════════════════════
// 8. Relationship stages: Connect, Cultivate, Champion (a reading of relationship_status)
// ════════════════════════════════════════════════════════════

export type RelationshipStage = "connect" | "cultivate" | "champion";
export const STAGE_LABEL: Record<RelationshipStage, string> = { connect: "Connect", cultivate: "Cultivate", champion: "Champion" };
export const STAGE_HINT: Record<RelationshipStage, string> = {
  connect: "Identified, contacted or meeting booked",
  cultivate: "Met, or an active relationship",
  champion: "Referring to us",
};

/** identified, contacted, meeting_booked = connect; met, active_relationship = cultivate; referring_partner = champion; inactive or none = not counted. */
export function stageOf(status: string | null | undefined): RelationshipStage | null {
  switch (status) {
    case "identified":
    case "contacted":
    case "meeting_booked":
      return "connect";
    case "met":
    case "active_relationship":
      return "cultivate";
    case "referring_partner":
      return "champion";
    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════
// 9. Planning items: how to SAY them (a planning figure is never a balance)
// ════════════════════════════════════════════════════════════

export const PLANNING_KIND_LABEL: Record<PlanningKind, string> = { funding: "Funding", dependency: "Outside dependency", context: "Context" };

export function planningStatusLabel(kind: PlanningKind, status: PlanningStatus): string {
  if (kind === "context") return status === "closed" ? "No longer current" : "Current";
  switch (status) {
    case "anticipated":
      return kind === "funding" ? "Anticipated, not confirmed" : "Awaited";
    case "confirmed":
      return kind === "funding" ? "Confirmed, not yet received" : "Confirmed";
    case "received":
      return kind === "funding" ? "Received" : "Arrived";
    default:
      return "Closed";
  }
}

/** "about $25,000" for a whole-dollar figure; never with cents (it is a planning figure). */
export function planningAmount(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return `about $${Math.round(amount).toLocaleString("en-AU")}`;
}

/** True while tasks can still be waiting on it. */
export function planningIsLive(p: Pick<PlanningItem, "kind" | "status">): boolean {
  return p.kind !== "context" && (p.status === "anticipated" || p.status === "confirmed");
}
