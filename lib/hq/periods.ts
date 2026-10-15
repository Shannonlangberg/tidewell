/*
 * The reporting window for the dashboard's referral figures (hq.growth_summary's
 * `p_since`). Calendar dates only: the caller supplies today's date in the business
 * timezone, so no timezone maths happens here.
 *
 * "Financial year" is the Australian one: 1 July to 30 June.
 *
 * Pure and dependency-free (no project imports), so `node --test` can run it.
 */

export const PERIODS = ["30d", "90d", "fy", "all"] as const;
export type Period = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: Period = "30d";

export const PERIOD_LABEL: Record<Period, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  fy: "Financial year to date",
  all: "All time",
};

/** Short forms for tabs, where the long ones would not fit on a phone. */
export const PERIOD_SHORT_LABEL: Record<Period, string> = {
  "30d": "30 days",
  "90d": "90 days",
  fy: "Financial year",
  all: "All time",
};

export function parsePeriod(value: unknown): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v) ? (v as Period) : DEFAULT_PERIOD;
}

/** `date` (YYYY-MM-DD) plus `days` (which may be negative), as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new RangeError("addDays needs a YYYY-MM-DD date");
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** `date` (YYYY-MM-DD) minus `days`, as YYYY-MM-DD. */
export function subtractDays(date: string, days: number): string {
  return addDays(date, -days);
}

/** The first day of the window that ends today. */
export function periodStart(period: Period, today: string): string {
  switch (period) {
    case "30d":
      return subtractDays(today, 30);
    case "90d":
      return subtractDays(today, 90);
    case "fy": {
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      return `${month >= 7 ? year : year - 1}-07-01`;
    }
    case "all":
      return "2000-01-01";
  }
}
