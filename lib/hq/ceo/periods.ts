/*
 * The CEO Command Centre's date range and the period it is compared with (docs/hq-ceo-command-centre.md).
 *
 * A period never reaches past today. A period that is still running (this month, this quarter, the
 * financial year) is compared with the SAME NUMBER OF DAYS from the start of the previous one, never with
 * the whole of it: three days of November against three days of October, not against all of October.
 * Rolling and custom periods are compared with the same number of days immediately before.
 *
 * Dates are "YYYY-MM-DD" calendar days; today comes from hq.today() (the business timezone). Pure and with
 * NO imports, so the unit tests run under Node's type stripping.
 */

export const PERIODS = ["month", "30d", "quarter", "fy", "custom"] as const;
export type PeriodKey = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: PeriodKey = "month";
export const PERIOD_LABEL: Record<PeriodKey, string> = {
  month: "This month",
  "30d": "Last 30 days",
  quarter: "This quarter",
  fy: "Financial year",
  custom: "Custom",
};
/** The longest period the database accepts (ceo_overview), in days between start and end. */
export const MAX_SPAN_DAYS = 1100;

export type Range = { from: string; to: string };
export type Period = Range & {
  key: PeriodKey;
  /** "November 2026 so far", "Last 30 days", "1 Jul 2026 to 3 Nov 2026". */
  title: string;
  /** Days in the period, both ends counted. */
  days: number;
  /** The period has ended (no more days will be added to it). */
  complete: boolean;
  /** What it is compared with, and how that is said; null when there is nothing earlier to compare. */
  previous: (Range & { title: string }) | null;
  /** Set when a custom range was corrected (for example an end after today). */
  adjusted: string | null;
};

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = ms(v);
  return Number.isFinite(t) && iso(t) === v;
}

export function addDays(d: string, n: number): string {
  return iso(ms(d) + n * 86_400_000);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

const ymd = (y: number, m: number, day: number) => iso(Date.UTC(y, m, day));
const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, day: Number(d.slice(8, 10)) });

export function monthStart(d: string): string {
  const { y, m } = parts(d);
  return ymd(y, m, 1);
}

export function monthEnd(d: string): string {
  const { y, m } = parts(d);
  return ymd(y, m + 1, 0);
}

/** The first day of the month `n` months from the month `d` is in. */
export function addMonths(d: string, n: number): string {
  const { y, m } = parts(d);
  return ymd(y, m + n, 1);
}

export function quarterStart(d: string): string {
  const { y, m } = parts(d);
  return ymd(y, m - (m % 3), 1);
}

/** 1 July of the Australian financial year `d` is in. */
export function financialYearStart(d: string): string {
  const { y, m } = parts(d);
  return ymd(m >= 6 ? y : y - 1, 6, 1);
}

/** "3 Nov 2026" */
export function shortDate(d: string): string {
  const { y, m, day } = parts(d);
  return `${day} ${MONTH[m]} ${y}`;
}

/** "Nov 2026" */
export function monthLabel(d: string): string {
  const { y, m } = parts(d);
  return `${MONTH[m]} ${y}`;
}

/**
 * The same number of days from `prevStart`, but never past the end of the earlier period
 * (the 31st of a month compared with a 30-day month stops at the 30th).
 */
function sameSpan(prevStart: string, prevEnd: string, days: number): Range {
  const to = addDays(prevStart, days - 1);
  return { from: prevStart, to: to > prevEnd ? prevEnd : to };
}

/**
 * The period for `key`, as of `today`. A custom range needs both dates; it is put in order, its end is
 * clipped to today and its length to MAX_SPAN_DAYS, and `adjusted` says so. A custom range with a missing or
 * bad date falls back to this month (adjusted says that too).
 */
export function resolvePeriod(key: PeriodKey, today: string, custom: { from?: string | null; to?: string | null } = {}): Period {
  if (key === "custom") {
    if (!isDate(custom.from) || !isDate(custom.to)) {
      return { ...resolvePeriod("month", today), adjusted: "Choose a start and an end date for a custom range. Showing this month." };
    }
    let from = custom.from;
    let to = custom.to;
    let adjusted: string | null = null;
    if (from > to) [from, to] = [to, from];
    if (from > today) return { ...resolvePeriod("month", today), adjusted: "A custom range cannot start after today. Showing this month." };
    if (to > today) {
      to = today;
      adjusted = "The range ends today: there are no records after it.";
    }
    if (daysBetween(from, to) > MAX_SPAN_DAYS) {
      from = addDays(to, -MAX_SPAN_DAYS);
      adjusted = "A range is at most three years, so it starts later.";
    }
    const days = daysBetween(from, to) + 1;
    const prevTo = addDays(from, -1);
    return {
      key,
      from,
      to,
      days,
      complete: to < today,
      title: `${shortDate(from)} to ${shortDate(to)}`,
      previous: { from: addDays(prevTo, -(days - 1)), to: prevTo, title: `the ${days} days before` },
      adjusted,
    };
  }

  if (key === "30d") {
    const from = addDays(today, -29);
    const prevTo = addDays(from, -1);
    return { key, from, to: today, days: 30, complete: false, title: "Last 30 days", previous: { from: addDays(prevTo, -29), to: prevTo, title: "the 30 days before" }, adjusted: null };
  }

  const start = key === "month" ? monthStart(today) : key === "quarter" ? quarterStart(today) : financialYearStart(today);
  const length = key === "month" ? 1 : key === "quarter" ? 3 : 12;
  const end = addDays(addMonths(start, length), -1);
  const days = daysBetween(start, today) + 1;
  const prevStart = addMonths(start, -length);
  const prevEnd = addDays(start, -1);
  const span = sameSpan(prevStart, prevEnd, days);
  const complete = today === end;
  const { y, m } = parts(start);
  const title =
    key === "month"
      ? `${MONTH_LONG[m]} ${y}${complete ? "" : " so far"}`
      : key === "quarter"
        ? `${MONTH[m]} to ${MONTH[(m + 2) % 12]} ${y}${complete ? "" : " so far"}`
        : `Financial year ${y}-${String((y + 1) % 100).padStart(2, "0")}${complete ? "" : " so far"}`;
  const prevTitle = complete
    ? key === "month"
      ? MONTH_LONG[parts(prevStart).m]
      : key === "quarter"
        ? "the previous quarter"
        : "the previous financial year"
    : key === "month"
      ? `the same ${days === 1 ? "day" : `${days} days`} of ${MONTH_LONG[parts(prevStart).m]}`
      : key === "quarter"
        ? `the same ${days} days of the previous quarter`
        : `the same ${days} days of the previous financial year`;
  return { key, from: start, to: today, days, complete, title, previous: { ...span, title: prevTitle }, adjusted: null };
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** ?period=quarter, or ?period=custom&from=2026-07-01&to=2026-09-30. Anything else is the default. */
export function parsePeriodParams(sp: Params): { key: PeriodKey; from: string | null; to: string | null } {
  const raw = first(sp.period);
  const key = (PERIODS as readonly string[]).includes(raw) ? (raw as PeriodKey) : DEFAULT_PERIOD;
  const from = first(sp.from);
  const to = first(sp.to);
  return { key, from: isDate(from) ? from : null, to: isDate(to) ? to : null };
}

/** Monday of the week `d` is in. */
export function weekStart(d: string): string {
  const wd = new Date(ms(d)).getUTCDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}
