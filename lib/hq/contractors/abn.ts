/*
 * ABN checks, in plain language. Pure and import-free so `node --test` runs it.
 *
 * This is the ATO's published modulus-89 checksum and nothing more: it proves an ABN is
 * well formed, NOT that it is registered, active or belongs to the business named. HQ never
 * looks an ABN up in the ABR. The database applies the same rule (contractors_abn_valid), so
 * this only exists to give a person a helpful message before the save.
 *
 * The rule: take the 11 digits, subtract 1 from the first, multiply each digit by its weight
 * (10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19), add them up; the total must divide by 89.
 */

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;

/** Whitespace removed, as the database does. Nothing else is touched, so "51-824-753-556" still fails. */
export function stripAbn(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/** True for 11 digits, first digit 1 to 9, passing the modulus-89 check. */
export function isValidAbn(raw: string): boolean {
  const s = stripAbn(raw);
  if (!/^[1-9]\d{10}$/.test(s)) return false;
  const digits = [...s].map(Number);
  digits[0] -= 1;
  const sum = digits.reduce((total, d, i) => total + d * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** "51824753556" -> "51 824 753 556". Anything that is not 11 digits is returned unchanged. */
export function formatAbn(abn: string | null | undefined): string {
  if (!abn) return "";
  const s = stripAbn(abn);
  return /^\d{11}$/.test(s) ? `${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 8)} ${s.slice(8)}` : abn;
}

/**
 * Why an ABN is not acceptable, in a sentence a person can act on, or null when it is fine.
 * An empty value is fine: the ABN is optional, and unknown stays unknown.
 */
export function abnProblem(raw: string | null | undefined): string | null {
  const s = stripAbn(raw ?? "");
  if (s === "") return null;
  if (/\D/.test(s)) return "An ABN is 11 digits. Use only numbers, with spaces if you like.";
  if (s.length !== 11) return `An ABN has 11 digits, and this has ${s.length}. Check it against the contractor's invoice or quote.`;
  if (s.startsWith("0")) return "An ABN can't start with 0. Check it against the contractor's invoice or quote.";
  if (!isValidAbn(s)) return "That ABN doesn't pass the ABN check, so a digit is probably wrong. Check it against the contractor's invoice or quote.";
  return null;
}
