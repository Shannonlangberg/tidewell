/*
 * Timezones a person may choose, and how a typed one is validated.
 *
 * A timezone is used in two places that must BOTH accept it: Intl (every date HQ shows
 * is formatted with it; an unknown name throws RangeError and would break the page)
 * and Postgres (hq.update_staff checks it against pg_timezone_names). So a free-text
 * zone is checked here with Intl first and canonicalised, and the database has the
 * last word. The BUSINESS timezone (hq.settings) is limited to the list below: hq.today()
 * feeds every overdue flag, so a name Postgres did not know would break HQ for everyone.
 *
 * Pure and dependency-free (no project imports), so `node --test` can run it.
 */

export type TimezoneOption = { value: string; label: string };

/** The mainland states and Tasmania, by their IANA names. */
export const AU_TIMEZONES: readonly TimezoneOption[] = [
  { value: "Australia/Adelaide", label: "Adelaide (South Australia)" },
  { value: "Australia/Brisbane", label: "Brisbane (Queensland)" },
  { value: "Australia/Darwin", label: "Darwin (Northern Territory)" },
  { value: "Australia/Hobart", label: "Hobart (Tasmania)" },
  { value: "Australia/Melbourne", label: "Melbourne (Victoria)" },
  { value: "Australia/Perth", label: "Perth (Western Australia)" },
  { value: "Australia/Sydney", label: "Sydney and Canberra (NSW, ACT)" },
];

/** The select value that means "use the free-text box". */
export const OTHER_TIMEZONE = "other";

export function isAustralianTimezone(value: unknown): value is string {
  return typeof value === "string" && AU_TIMEZONES.some((z) => z.value === value);
}

/** Looks like an IANA name: "Area/Location" (one or two levels), or UTC. */
const IANA_SHAPE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

/**
 * The canonical IANA name for `value`, or null when it is not a timezone Intl knows.
 * "australia/adelaide" becomes "Australia/Adelaide".
 */
export function canonicalTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 64 || !IANA_SHAPE.test(v)) return null;
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: v }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function isValidTimezone(value: unknown): boolean {
  return canonicalTimezone(value) !== null;
}

export type TimezoneChoice =
  | { ok: true; timezone: string }
  | { ok: false; field: "timezone" | "timezoneOther"; message: string };

/**
 * Reads the pair of form fields: a select (an Australian zone, or "other") and a free-text
 * box used only when "other" is chosen.
 */
export function resolveTimezoneChoice(choice: string, other: string): TimezoneChoice {
  const picked = choice.trim();
  if (!picked) return { ok: false, field: "timezone", message: "Choose a timezone." };
  if (picked !== OTHER_TIMEZONE) {
    return isAustralianTimezone(picked)
      ? { ok: true, timezone: picked }
      : { ok: false, field: "timezone", message: "Choose one of the options." };
  }
  const typed = other.trim();
  if (!typed) return { ok: false, field: "timezoneOther", message: "Enter a timezone name, like Pacific/Auckland." };
  const canonical = canonicalTimezone(typed);
  return canonical
    ? { ok: true, timezone: canonical }
    : { ok: false, field: "timezoneOther", message: "That is not a timezone name we recognise. Use a name like Pacific/Auckland." };
}
