/*
 * Turns a Postgres / PostgREST error into something a Server Action can act on, without ever
 * showing the raw message to a person or writing personal data to a log.
 *
 * Pure and dependency-free so it runs under `node --test`.
 *
 * Constraint names come from the migrations (0102): they are structural, not personal, so it is
 * safe to read them and to log them. The `details` text of a unique violation contains the
 * offending VALUES (a name, an email): it is never read here and must never be logged.
 */

export type DbError = { code?: string | null; message?: string | null } | null | undefined;

export type DbErrorKind =
  | "duplicate_contact_name"
  | "duplicate_contact_email"
  | "duplicate_organisation_name"
  | "duplicate_primary"
  | "duplicate_other"
  | "permission"
  | "not_found"
  | "invalid"
  | "range"
  | "other";

const CONSTRAINT_KIND: Array<[string, DbErrorKind]> = [
  ["contacts_org_name_key_uq", "duplicate_contact_name"],
  ["contacts_email_uq", "duplicate_contact_email"],
  ["organisations_name_key_uq", "duplicate_organisation_name"],
  ["contacts_one_primary_uq", "duplicate_primary"],
];

export function classifyDbError(error: DbError): DbErrorKind {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "23505") {
    for (const [name, kind] of CONSTRAINT_KIND) if (message.includes(name)) return kind;
    return "duplicate_other";
  }
  if (code === "42501") return "permission";
  if (code === "P0002" || code === "PGRST116") return "not_found";
  if (code === "PGRST103") return "range";
  // 22023 invalid_parameter_value (raised by our RPCs), 22P02 bad text for a type, 23514 check, 23502 not null, 23503 foreign key.
  if (code === "22023" || code === "22P02" || code === "23514" || code === "23502" || code === "23503") return "invalid";
  return "other";
}

/** Safe to log: the code and, for a unique violation, the constraint name. Never the message body or the details. */
export function logTag(error: DbError): string {
  const code = error?.code ?? "unknown";
  const message = error?.message ?? "";
  const constraint = CONSTRAINT_KIND.find(([name]) => message.includes(name))?.[0];
  return constraint ? `${code} ${constraint}` : String(code);
}
