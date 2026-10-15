/*
 * What a person is told when a contractor RPC fails (vetting, documents, reviews, reminders).
 *
 * Pure, no imports. The raw database error is never shown and never logged beyond its code.
 * The one exception: SQLSTATE 22023 and 23514 are raised by OUR functions with a plain-English
 * message written for people (docs/hq-phase-2.md 11.5: "The message text is safe to show"),
 * for example "a note is required when a step is not applicable". Those are passed through,
 * trimmed and length-limited; every other error becomes a generic sentence.
 */

export type RpcError = { code?: string | null; message?: string | null } | null | undefined;

export const GENERIC_FAILURE = "Something went wrong and nothing was changed. Try again in a moment.";
export const NOT_PERMITTED = "You don't have permission to do that.";

const SAFE_RULE_CODES = new Set(["22023", "23514"]);

/** A message that is plain English and short enough to show: no SQL, no stack, no id soup. */
function looksPlain(message: string): boolean {
  if (message.length === 0 || message.length > 200) return false;
  if (/\b(select|insert|update|delete|violates|constraint|relation|column|function|schema|policy)\b/i.test(message)) return false;
  return /^[\x20-\x7E‘’“”]+$/.test(message);
}

export function failureMessage(error: RpcError, fallback: string = GENERIC_FAILURE): string {
  const code = error?.code ?? "";
  if (code === "42501") return NOT_PERMITTED;
  if (code === "P0002" || code === "PGRST116") return "That could not be found. It may have been archived.";
  if (code === "23505") return "That already exists.";
  if (SAFE_RULE_CODES.has(code)) {
    const message = (error?.message ?? "").trim();
    if (looksPlain(message)) return message.charAt(0).toUpperCase() + message.slice(1) + (/[.!?]$/.test(message) ? "" : ".");
  }
  return fallback;
}

/** Safe to log: the code only. */
export function logCode(error: RpcError): string {
  return String(error?.code ?? "unknown");
}
