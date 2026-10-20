/*
 * Timeline geometry for the project Timeline view. Pure, no value imports (see rules.ts).
 *
 * Months run across; positions are percentages of the visible range, so the drawing is plain CSS
 * (left/width in %) and scales with the screen. Tasks only have a due date, so a bar runs from
 * when the work could start to when it is due: the later of the day the task was created and
 * the latest due date of the tasks it waits on (its "after X"), never later than its due date.
 * A task with no due date is not drawn (it is listed under the chart instead).
 */

import type { TaskStatus } from "../constants";

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OPEN: readonly TaskStatus[] = ["to_do", "in_progress", "waiting"];

const toMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const valid = (d: string | null | undefined): d is string => typeof d === "string" && ISO.test(d.slice(0, 10)) && !Number.isNaN(toMs(d));

export type TimelineTaskInput = {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: string | null;
  /** YYYY-MM-DD the task was created (or any timestamp; the date part is used). */
  createdAt: string;
  milestoneId: string | null;
  /** Titles and due dates of the tasks this one waits on. */
  after: { title: string; dueDate: string | null }[];
};

export type TimelineMilestoneInput = { id: string; name: string; dueDate: string | null; done: boolean };

export type TimelineMonth = { key: string; label: string; left: number; width: number };
export type TimelineBar = {
  id: string;
  title: string;
  status: TaskStatus;
  start: string;
  due: string;
  left: number;
  width: number;
  overdue: boolean;
  done: boolean;
  /** "After Licence application" (the first open, or the latest, dependency) */
  afterLabel: string | null;
};
export type TimelineMarker = { id: string; name: string; due: string; left: number; done: boolean; overdue: boolean };
export type TimelineLane = { key: string; label: string; marker: TimelineMarker | null; bars: TimelineBar[] };

export type TimelineModel = {
  from: string;
  /** Exclusive: the first day after the range. */
  to: string;
  months: TimelineMonth[];
  /** null when today is outside the range */
  todayLeft: number | null;
  lanes: TimelineLane[];
  /** Tasks with no due date, which the chart cannot place. */
  undated: { id: string; title: string }[];
  /** The minimum width, as a %, a bar is drawn at so a same-day task is still visible. */
  minWidth: number;
};

export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function nextMonthStart(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function percentOf(date: string, from: string, to: string): number {
  const span = toMs(to) - toMs(from);
  if (span <= 0) return 0;
  const p = ((toMs(date) - toMs(from)) / span) * 100;
  return Math.max(0, Math.min(100, Math.round(p * 100) / 100));
}

/** The start of a bar: the later of its creation date and its dependencies' latest due date, never after its due date. */
export function barStart(t: Pick<TimelineTaskInput, "createdAt" | "dueDate" | "after">): string | null {
  if (!valid(t.dueDate)) return null;
  let start = valid(t.createdAt) ? t.createdAt.slice(0, 10) : t.dueDate;
  for (const a of t.after) if (valid(a.dueDate) && a.dueDate > start) start = a.dueDate;
  return start > t.dueDate ? t.dueDate : start;
}

/**
 * Builds the model. The range covers the project's start and target, every milestone and dated
 * task, and today, rounded out to whole months, at least `minMonths` wide.
 */
export function buildTimeline(input: {
  projectStart: string | null;
  projectTarget: string | null;
  today: string;
  milestones: readonly TimelineMilestoneInput[];
  tasks: readonly TimelineTaskInput[];
  minMonths?: number;
}): TimelineModel {
  const { today } = input;
  const minMonths = input.minMonths ?? 3;
  const dates: string[] = [today];
  if (valid(input.projectStart)) dates.push(input.projectStart);
  if (valid(input.projectTarget)) dates.push(input.projectTarget);
  for (const m of input.milestones) if (valid(m.dueDate)) dates.push(m.dueDate);
  const starts = new Map<string, string>();
  for (const t of input.tasks) {
    const s = barStart(t);
    if (s && valid(t.dueDate)) {
      starts.set(t.id, s);
      dates.push(s, t.dueDate);
    }
  }
  dates.sort();
  const from = monthStart(dates[0]);
  let to = nextMonthStart(dates[dates.length - 1]);
  const months: { key: string; start: string; end: string }[] = [];
  for (let m = from; m < to || months.length < minMonths; m = nextMonthStart(m)) {
    months.push({ key: m.slice(0, 7), start: m, end: nextMonthStart(m) });
    if (months.length > 120) break; // ten years is plenty for one project
  }
  to = months[months.length - 1].end;

  const pct = (d: string) => percentOf(d, from, to);
  const totalDays = Math.max(1, (toMs(to) - toMs(from)) / DAY);
  const minWidth = Math.max(0.6, Math.round((100 / totalDays) * 100) / 100);

  const monthModels: TimelineMonth[] = months.map((m, i) => {
    const y = m.start.slice(0, 4);
    const label = MONTHS[Number(m.start.slice(5, 7)) - 1] + (i === 0 || m.start.slice(5, 7) === "01" ? ` ${y}` : "");
    const left = pct(m.start);
    return { key: m.key, label, left, width: Math.round((pct(m.end) - left) * 100) / 100 };
  });

  const markerOf = (m: TimelineMilestoneInput): TimelineMarker | null =>
    valid(m.dueDate) ? { id: m.id, name: m.name, due: m.dueDate, left: pct(m.dueDate), done: m.done, overdue: !m.done && m.dueDate < today } : null;

  const barOf = (t: TimelineTaskInput): TimelineBar | null => {
    const start = starts.get(t.id);
    if (!start || !valid(t.dueDate)) return null;
    const left = pct(start);
    // The bar ends at the END of its due day.
    const end = pct(toIso(toMs(t.dueDate) + DAY));
    const open = OPEN.includes(t.status);
    const pending = t.after.find((a) => valid(a.dueDate) && a.dueDate === start) ?? t.after[0];
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      start,
      due: t.dueDate,
      left,
      width: Math.max(minWidth, Math.round((end - left) * 100) / 100),
      overdue: open && t.dueDate < today,
      done: t.status === "completed",
      afterLabel: pending ? `After ${pending.title}` : null,
    };
  };

  const byDue = (a: TimelineBar, b: TimelineBar) => (a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const known = new Set(input.milestones.map((m) => m.id));
  const lanes: TimelineLane[] = input.milestones.map((m) => ({
    key: m.id,
    label: m.name,
    marker: markerOf(m),
    bars: input.tasks
      .filter((t) => t.milestoneId === m.id)
      .map(barOf)
      .filter((b): b is TimelineBar => b !== null)
      .sort(byDue),
  }));
  const loose = input.tasks
    .filter((t) => !t.milestoneId || !known.has(t.milestoneId))
    .map(barOf)
    .filter((b): b is TimelineBar => b !== null)
    .sort(byDue);
  if (loose.length > 0) lanes.push({ key: "none", label: input.milestones.length ? "No milestone" : "Tasks", marker: null, bars: loose });

  return {
    from,
    to,
    months: monthModels,
    todayLeft: today >= from && today < to ? pct(today) : null,
    lanes,
    undated: input.tasks.filter((t) => !valid(t.dueDate)).map((t) => ({ id: t.id, title: t.title })),
    minWidth,
  };
}
