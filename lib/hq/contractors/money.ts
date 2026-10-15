/*
 * Rates and fees: dollars on screen, whole cents in the database. Pure and import-free.
 *
 * Unknown is not zero. A blank box means "not recorded" and is stored as null; "0" means the
 * contractor really charges nothing (a free call-out, say) and is stored as 0.
 */

/** The most a single rate can be: a guard against a slipped decimal, not a business rule. */
export const MAX_RATE_CENTS = 10_000_000; // $100,000.00

export type ParsedDollars = { ok: true; cents: number | null } | { ok: false; message: string };

/**
 * "85", "$85.50", "1,200", " 0 " -> cents. Blank -> null (not recorded). Anything else is refused
 * with a message that says what to type. At most two decimal places, never negative.
 */
export function parseDollars(raw: string | null | undefined): ParsedDollars {
  const v = (raw ?? "").trim().replace(/[$\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (v === "") return { ok: true, cents: null };
  if (v.startsWith("-")) return { ok: false, message: "An amount can't be negative." };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { ok: false, message: "Enter an amount in dollars, like 95 or 95.50." };
  const cents = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_RATE_CENTS) return { ok: false, message: "That amount looks too large. Check the decimal point." };
  return { ok: true, cents };
}

/** The dollars to put back in an input: 8500 -> "85", 8550 -> "85.50", null -> "". */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/** "$85", "$85.50", "$1,200". Null reads as "Not recorded", never "$0". */
export function formatRate(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "Not recorded";
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}
