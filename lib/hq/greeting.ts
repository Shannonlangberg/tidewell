/*
 * The dashboard greeting and date labels, worked out in the PERSON'S timezone (never the
 * server's: Netlify runs in UTC, so "Good morning" would be wrong half the day).
 *
 * Pure and dependency-free (no project imports), so `node --test` can run it.
 */

const FALLBACK_TIMEZONE = "Australia/Adelaide";

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/** An Intl formatter in `timezone`, falling back to Adelaide if the name is one Intl does not know. */
function formatterParts(timezone: string, options: Intl.DateTimeFormatOptions, date: Date): Intl.DateTimeFormatPart[] {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, ...options }).formatToParts(date);
  } catch {
    return new Intl.DateTimeFormat("en-AU", { timeZone: FALLBACK_TIMEZONE, ...options }).formatToParts(date);
  }
}

/** The hour, 0 to 23, in `timezone`. */
export function hourIn(timezone: string, now: Date = new Date()): number {
  const parts = formatterParts(timezone, { hour: "numeric", hourCycle: "h23" }, now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/** Before noon is morning, noon to 5 pm afternoon, 5 pm on evening. */
export function greetingFor(timezone: string, now: Date = new Date()): Greeting {
  const h = hourIn(timezone, now);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** "Good morning, Shannon." The full stop is part of the heading. */
export function welcomeTitle(firstName: string, timezone: string, now: Date = new Date()): string {
  const name = firstName.trim();
  return name ? `${greetingFor(timezone, now)}, ${name}.` : `${greetingFor(timezone, now)}.`;
}

/** "Thursday 15 October", assembled from parts because ICU's punctuation differs between versions. */
export function longDateIn(timezone: string, now: Date = new Date()): string {
  const parts = formatterParts(timezone, { weekday: "long", day: "numeric", month: "long" }, now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/**
 * "Fri 23 Oct" for a bare calendar date (YYYY-MM-DD). A date has no timezone, so it is
 * anchored at midday UTC and read back in UTC: no timezone can move it to a neighbouring day.
 */
export function shortDay(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return "";
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}
