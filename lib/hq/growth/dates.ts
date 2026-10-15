/*
 * Date rules for the relationship CRM: the "when" of a call, the follow-up date, and the
 * relative wording ("3 days overdue", "2 weeks ago").
 *
 * Pure and dependency-free (no value imports), so it runs under `node --test`. Everything that
 * depends on "now" or "today" takes it as an argument.
 *
 * Time zones: a person types a call time as local wall-clock time in THEIR time zone
 * (staff.timezone). The database stores an instant. `zonedLocalToDate` converts between the two
 * without a library, including across daylight-saving changes (Adelaide moves between +09:30
 * and +10:30).
 */

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function partsIn(date: Date, timezone: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(f.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Today's calendar date, YYYY-MM-DD, in `timezone`. */
export function todayInZone(timezone: string, now: Date = new Date()): string {
  const p = partsIn(now, timezone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** The value for an <input type="datetime-local">: "YYYY-MM-DDTHH:mm" wall-clock time in `timezone`. */
export function nowLocalInput(timezone: string, now: Date = new Date()): string {
  const p = partsIn(now, timezone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes that `timezone` is ahead of UTC at the instant `date` (+630 for Adelaide in summer). */
function offsetMinutes(timezone: string, date: Date): number {
  const p = partsIn(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const real = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - real) / 60_000);
}

/**
 * The instant for a wall-clock time typed in `timezone` ("2026-10-15T14:30"), or null when the
 * text is not a real date and time. A time that does not exist (the hour skipped when clocks go
 * forward) is moved to the nearest real instant rather than rejected.
 */
export function zonedLocalToDate(local: string, timezone: string): Date | null {
  const m = LOCAL_INPUT.exec(local);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(asUtc);
  // Reject 31 February, 25:00 and the like: the parts must survive a round trip.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }
  // Two passes: the offset at the guess may differ from the offset at the answer near a DST change.
  let t = asUtc - offsetMinutes(timezone, new Date(asUtc)) * 60_000;
  t = asUtc - offsetMinutes(timezone, new Date(t)) * 60_000;
  return new Date(t);
}

// ── calendar-date arithmetic (dates are YYYY-MM-DD, with no time zone of their own) ──

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// ── follow-up rules ──────────────────────────────────────────

/** A follow-up can be set up to this far ahead. */
export const FOLLOW_UP_MAX_DAYS = 730;

export type DateCheck = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Rules for a follow-up date typed by a person: optional; a real date; today or later in their
 * time zone (a follow-up in the past would be overdue the moment it is saved); not more than
 * two years away.
 */
export function checkFollowUpDate(value: string | null | undefined, today: string): DateCheck {
  const v = (value ?? "").trim();
  if (!v) return { ok: true, value: null };
  if (!isCalendarDate(v)) return { ok: false, message: "Enter a valid date." };
  if (v < today) return { ok: false, message: "The follow-up date can't be in the past." };
  if (daysBetween(today, v) > FOLLOW_UP_MAX_DAYS) return { ok: false, message: "Choose a follow-up date within the next two years." };
  return { ok: true, value: v };
}

/** Whether "create a follow-up task" may be honoured: it needs a follow-up date to give the task its due date. */
export function taskNeedsDate(createTask: boolean, followUpDate: string | null): boolean {
  return createTask && !followUpDate;
}

export const EARLIEST_INTERACTION = "2000-01-01T00:00:00Z";

/** A call or meeting may be back-dated but never future-dated (one minute of slack for clock drift). */
export function checkOccurredAt(when: Date | null, now: Date = new Date()): { ok: true } | { ok: false; message: string } {
  if (!when) return { ok: false, message: "Enter a valid date and time." };
  if (when.getTime() > now.getTime() + 60_000) return { ok: false, message: "The time can't be in the future." };
  if (when.getTime() < Date.parse(EARLIEST_INTERACTION)) return { ok: false, message: "That date is too far in the past." };
  return { ok: true };
}

// ── how a follow-up reads ────────────────────────────────────

export type FollowUpState =
  | { kind: "none" }
  | { kind: "overdue"; days: number }
  | { kind: "today" }
  | { kind: "upcoming"; days: number };

export function followUpState(date: string | null | undefined, today: string): FollowUpState {
  if (!date || !isCalendarDate(date.slice(0, 10))) return { kind: "none" };
  const n = daysBetween(today, date.slice(0, 10));
  if (n < 0) return { kind: "overdue", days: -n };
  if (n === 0) return { kind: "today" };
  return { kind: "upcoming", days: n };
}

/** "1 day overdue", "5 days overdue". */
export function overdueLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} overdue`;
}

/**
 * How long ago a timestamp was, in calendar days in `timezone`: "Today", "Yesterday",
 * "5 days ago", "3 weeks ago", "4 months ago", "2 years ago". Null for no timestamp.
 */
export function agoLabel(timestamp: string | Date | null | undefined, timezone: string, now: Date = new Date()): string | null {
  if (!timestamp) return null;
  const d = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(d.getTime())) return null;
  const days = daysBetween(todayInZone(timezone, d), todayInZone(timezone, now));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}

/** Whole calendar days since a timestamp (0 for today), or null. */
export function daysAgo(timestamp: string | Date | null | undefined, timezone: string, now: Date = new Date()): number | null {
  if (!timestamp) return null;
  const d = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, daysBetween(todayInZone(timezone, d), todayInZone(timezone, now)));
}

/**
 * "Tue 20 Oct" for a calendar date, with the year added when it is not the current year
 * ("Tue 20 Oct 2027"). A bare date is shown as written, in no time zone.
 */
export function formatDay(date: string | null | undefined, today: string): string {
  if (!date || !isCalendarDate(date.slice(0, 10))) return "";
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  const part = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", ...opts }).formatToParts(d).find((p) => p.type === type)?.value ?? "";
  const weekday = part({ weekday: "short" }, "weekday");
  const day = part({ day: "numeric" }, "day");
  const month = part({ month: "short" }, "month");
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `${weekday} ${day} ${month}${sameYear ? "" : ` ${date.slice(0, 4)}`}`;
}
