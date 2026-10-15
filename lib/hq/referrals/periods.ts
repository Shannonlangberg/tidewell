/*
 * The reporting window for the Growth overview (hq.growth_summary's `p_since`).
 *
 * Calendar dates only: the caller supplies today's date in the person's own timezone, so no
 * timezone maths happens here. "Financial year" is the Australian one, 1 July to 30 June.
 *
 * growth_summary takes only a start date ("since"), so every window runs from its start to
 * now. That is also why "this month" means "month to date".
 *
 * Pure and dependency-free (no value imports), so `node --test` can run it.
 */

export const GROWTH_PERIODS = ["month", "30d", "fy", "all"] as const;
export type GrowthPeriod = (typeof GROWTH_PERIODS)[number];

export const DEFAULT_GROWTH_PERIOD: GrowthPeriod = "30d";

export const GROWTH_PERIOD_LABEL: Record<GrowthPeriod, string> = {
  month: "This month",
  "30d": "Last 30 days",
  fy: "This financial year",
  all: "All time",
};

/** The earliest date HQ will ever hold. "All time" starts here. */
export const ALL_TIME_START = "2000-01-01";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDate(date: string): [number, number, number] {
  const m = ISO.exec(date);
  if (!m) throw new RangeError("Expected a YYYY-MM-DD date");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError("Expected a real calendar date");
  }
  return [y, mo, d];
}

/** `date` (YYYY-MM-DD) plus `days`, which may be negative. */
export function shiftDays(date: string, days: number): string {
  assertDate(date);
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The first day of the month `date` falls in. */
export function monthStart(date: string): string {
  const [y, m] = assertDate(date);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
}

/** 1 July of the Australian financial year that contains `date`. */
export function financialYearStart(date: string): string {
  const [y, m] = assertDate(date);
  const year = m >= 7 ? y : y - 1;
  return `${String(year).padStart(4, "0")}-07-01`;
}

/** "2026–27" for the financial year that contains `date` (an en dash, as Australian style guides write it). */
export function financialYearLabel(date: string): string {
  const start = Number(financialYearStart(date).slice(0, 4));
  return `${start}–${String((start + 1) % 100).padStart(2, "0")}`;
}

export function parseGrowthPeriod(value: unknown): GrowthPeriod {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && (GROWTH_PERIODS as readonly string[]).includes(v) ? (v as GrowthPeriod) : DEFAULT_GROWTH_PERIOD;
}

/**
 * The first day of the window. "Last 30 days" starts 30 days before today, which is also what
 * hq.growth_summary does when it is given no date, so the dashboard and this page agree.
 */
export function growthPeriodStart(period: GrowthPeriod, today: string): string {
  switch (period) {
    case "month":
      return monthStart(today);
    case "30d":
      return shiftDays(today, -30);
    case "fy":
      return financialYearStart(today);
    case "all":
      return ALL_TIME_START;
  }
}

/** The label with the financial year spelled out: "This financial year (2026–27)". */
export function growthPeriodTitle(period: GrowthPeriod, today: string): string {
  return period === "fy" ? `${GROWTH_PERIOD_LABEL.fy} (${financialYearLabel(today)})` : GROWTH_PERIOD_LABEL[period];
}
