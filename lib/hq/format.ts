/*
 * Australian formatting for HQ. Dates are formatted in an explicit timezone
 * (default Australia/Adelaide) because staff elsewhere will need their own later.
 * Never use the server's local zone: Netlify runs in UTC.
 *
 * Pure and dependency-free so it can be unit tested with `node --test`.
 */

export const DEFAULT_TIMEZONE = "Australia/Adelaide";

type DateLike = string | Date | null | undefined;

function toDate(value: DateLike): Date | null {
  if (!value) return null;
  // A bare calendar date (YYYY-MM-DD) means that day wherever you are: anchor it at
  // midday UTC so no timezone can push it to the neighbouring day.
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today's calendar date as YYYY-MM-DD in `timezone`. */
export function todayIn(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "15 Oct 2026". Bare dates are shown as written, timestamps are shown in `timezone`. */
export function formatDate(value: DateLike, timezone: string = DEFAULT_TIMEZONE): string {
  const d = toDate(value);
  if (!d) return "";
  const bare = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: bare ? "UTC" : timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** "Thu 15 Oct, 2:30 pm" */
export function formatDateTime(value: DateLike, timezone: string = DEFAULT_TIMEZONE): string {
  const d = toDate(value);
  if (!d) return "";
  // Assembled from parts: the punctuation ICU puts between them differs between
  // Node versions, and a timestamp that changes shape would break snapshots and layouts.
  const part = (opts: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat("en-AU", { timeZone: timezone, hour12: true, ...opts })
      .formatToParts(d)
      .find((p) => p.type === type)?.value ?? "";
  const weekday = part({ weekday: "short" }, "weekday");
  const day = part({ day: "numeric" }, "day");
  const month = part({ month: "short" }, "month");
  const hour = part({ hour: "numeric" }, "hour");
  const minute = part({ minute: "2-digit" }, "minute").padStart(2, "0"); // a lone minute field is not zero-padded
  const dayPeriod = part({ hour: "numeric" }, "dayPeriod").toLowerCase().replace(/[.\s]/g, "");
  return `${weekday} ${day} ${month}, ${hour}:${minute} ${dayPeriod}`;
}

/** Whole calendar days from `today` to `date`: negative when `date` is in the past. */
export function daysFromToday(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** "Today", "Tomorrow", "Yesterday", "in 3 days", "5 days overdue". */
export function relativeDay(date: string | null | undefined, today: string): string {
  const n = daysFromToday(date, today);
  if (n === null) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days overdue`;
}

/** Whole days since a timestamp, in calendar terms for `timezone`. */
export function daysSince(timestamp: DateLike, timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): number | null {
  const d = toDate(timestamp);
  if (!d) return null;
  const then = todayIn(timezone, d);
  return -(daysFromToday(then, todayIn(timezone, now)) ?? 0) || 0;
}

/** Whole dollars, no cents: "$12,500". Used for estimates, never for ledger amounts. */
export function formatAud(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const n = typeof cents === "string" ? Number(cents) : cents;
  if (!Number.isFinite(n)) return "";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n / 100);
}

/** "REF-0007" */
export function refNumber(n: number | string | null | undefined, prefix = "REF"): string {
  if (n === null || n === undefined) return "";
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/** "Jane Citizen" -> "JC" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** "1 contact", "3 contacts". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
