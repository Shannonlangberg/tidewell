/*
 * The rules behind the Today screen (/hq): which sections a person gets, in what order, and the
 * few plain phrases the rows use. The data itself is loaded in components/hq/features/today; this
 * file is pure (type-only imports) so `node --test` can run it.
 *
 * Who sees what is decided from CAPABILITIES (the same strings the database checks), and only the
 * ORDER comes from the role: a property manager sees the operations sections first, everyone else
 * sees growth first. Hiding a section is a courtesy; row level security is the control.
 */

import type { StaffRole } from "./constants";

/** Roles whose day starts with tasks, paperwork and contractors rather than partners. */
const PROPERTY_MANAGER_ROLES: readonly StaffRole[] = ["senior_property_manager", "property_manager", "junior_property_manager"];

export function isPropertyManagerRole(role: StaffRole): boolean {
  return PROPERTY_MANAGER_ROLES.includes(role);
}

export type TodayView = "growth" | "operations";

export type TodayPlan = {
  /** The views this person gets, in the order they appear. */
  views: TodayView[];
  /** Follow-ups, partners gone quiet, new referrals. */
  growth: boolean;
  /** Their tasks (and the team's, with tasks.read_all). */
  tasks: boolean;
  /** Paperwork expiring, trades with no approved contractor, not used lately. */
  contractors: boolean;
  /** May log a call or snooze a follow-up. */
  canLogCalls: boolean;
  /** May complete a task. */
  canCompleteTasks: boolean;
  /** Sees everyone's tasks, not only their own. */
  seesTeamTasks: boolean;
};

export function todayPlan(role: StaffRole, capabilities: readonly string[]): TodayPlan {
  const has = (c: string) => capabilities.includes(c);
  const growth = has("growth.read");
  const tasks = has("tasks.write") || has("tasks.read_all");
  const contractors = has("contractors.read");
  const operations = tasks || contractors;
  const order: TodayView[] = isPropertyManagerRole(role) ? ["operations", "growth"] : ["growth", "operations"];
  return {
    views: order.filter((v) => (v === "growth" ? growth : operations)),
    growth,
    tasks,
    contractors,
    canLogCalls: has("growth.write"),
    canCompleteTasks: has("tasks.write"),
    seesTeamTasks: has("tasks.read_all"),
  };
}

/** Whole calendar days from `today` to `date` (both YYYY-MM-DD); negative when `date` is past. */
export function daysUntil(date: string, today: string): number | null {
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** "3 days overdue" for a past date, null for today or later (the section heading already says "today"). */
export function overdueText(date: string, today: string): string | null {
  const n = daysUntil(date, today);
  if (n === null || n >= 0) return null;
  return n === -1 ? "1 day overdue" : `${-n} days overdue`;
}

/** "Last spoke 3 days ago", "Last spoke today", or null when never. */
export function lastSpokeText(days: number | null): string | null {
  if (days === null || days < 0) return null;
  if (days === 0) return "Last spoke today";
  if (days === 1) return "Last spoke yesterday";
  if (days < 60) return `Last spoke ${days} days ago`;
  const months = Math.floor(days / 30.4375);
  return `Last spoke ${months} months ago`;
}

/** How far a snoozed follow-up moves: one week. */
export const SNOOZE_DAYS = 7;

/** "Expired 3 Oct" / "Expires today" / "Expires in 12 days" for a licence, insurance or document. */
export function expiryText(expiresOn: string, today: string): string {
  const n = daysUntil(expiresOn, today);
  if (n === null) return `Expires ${expiresOn}`;
  if (n < 0) return n === -1 ? "Expired yesterday" : `Expired ${-n} days ago`;
  if (n === 0) return "Expires today";
  if (n === 1) return "Expires tomorrow";
  return `Expires in ${n} days`;
}

/** A contractor counts as "not used lately" after this many days since its last recorded job. */
export const NOT_USED_DAYS = 90;

export type Figure = { key: string; text: string; href: string };

/**
 * The short row of figures under the greeting: only the non-zero ones, at most four, each a link to
 * its section. Zero says nothing useful here (the section itself already says "nothing due").
 */
export function todayFigures(counts: Partial<Record<"call" | "tasksOverdue" | "tasksToday" | "expiring" | "referrals", number | null>>): Figure[] {
  const out: Figure[] = [];
  const add = (key: string, n: number | null | undefined, one: string, many: string, href: string) => {
    if (typeof n === "number" && n > 0) out.push({ key, text: `${n} ${n === 1 ? one : many}`, href });
  };
  add("call", counts.call, "follow-up due", "follow-ups due", "#call-today");
  add("tasksOverdue", counts.tasksOverdue, "task overdue", "tasks overdue", "#tasks-today");
  add("tasksToday", counts.tasksToday, "task due today", "tasks due today", "#tasks-today");
  add("expiring", counts.expiring, "document expiring", "documents expiring", "#paperwork");
  add("referrals", counts.referrals, "new referral", "new referrals", "#new-referrals");
  return out.slice(0, 4);
}

/** A `tel:` / `sms:` target from a phone number as people type it, or null when there is no usable number. */
export function phoneHref(phone: string | null | undefined, scheme: "tel" | "sms"): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 6) return null;
  return `${scheme}:${digits}`;
}
