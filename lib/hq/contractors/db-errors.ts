/*
 * Turns a Postgres / PostgREST error from a contractor write into something an action can act on,
 * without ever showing the raw message to a person or writing personal data to a log. Pure and
 * import-free.
 *
 * Constraint names come from migrations 0112 to 0118: structural, not personal, so it is safe to
 * read and log them. The `details` text of a unique violation holds the offending VALUES (a
 * business name, an ABN): it is never read here and must never be logged.
 */

export type DbError = { code?: string | null; message?: string | null } | null | undefined;

export type ContractorErrorKind =
  | "abn_invalid"
  | "abn_duplicate"
  | "name_duplicate"
  | "categories_empty"
  | "email_shape"
  | "rates_negative"
  | "suspended_needs_reason"
  | "name_blank"
  | "duplicate_other"
  | "permission"
  | "not_found"
  | "refused"
  | "invalid"
  | "range"
  | "other";

const CONSTRAINTS: Array<[string, ContractorErrorKind]> = [
  ["contractors_abn_valid", "abn_invalid"],
  ["contractors_abn_uq", "abn_duplicate"],
  ["contractors_name_key_uq", "name_duplicate"],
  ["contractors_categories_not_empty", "categories_empty"],
  ["contractors_email_shape", "email_shape"],
  ["contractors_rates_not_negative", "rates_negative"],
  ["contractors_suspended_needs_reason", "suspended_needs_reason"],
  ["contractors_business_name_not_blank", "name_blank"],
];

export function classifyContractorError(error: DbError): ContractorErrorKind {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  for (const [name, kind] of CONSTRAINTS) if (message.includes(name)) return kind;
  if (code === "23505") return "duplicate_other";
  if (code === "42501") return "permission";
  if (code === "P0002" || code === "PGRST116") return "not_found";
  if (code === "PGRST103") return "range";
  // 23514: a rule in the database refused it (the RPCs write their reason in plain English).
  if (code === "23514") return "refused";
  if (code === "22023" || code === "22P02" || code === "23502" || code === "23503") return "invalid";
  return "other";
}

/** Safe to log: the code and, for a constraint violation, the constraint name. Never the message body or the details. */
export function logTag(error: DbError): string {
  const code = error?.code ?? "unknown";
  const message = error?.message ?? "";
  const constraint = CONSTRAINTS.find(([name]) => message.includes(name))?.[0];
  return constraint ? `${code} ${constraint}` : String(code);
}
