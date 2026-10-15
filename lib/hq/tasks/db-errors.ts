/*
 * Turns a Postgres or PostgREST error into something a Server Action can act on, without ever
 * showing the raw message to a person or writing personal data to a log.
 *
 * Pure and dependency-free. `logTag` is the only thing that may be logged: the error code and,
 * for a constraint, its name. The message and `details` of a Postgres error can contain the
 * offending VALUES (a title, a name), so they are never read for logging.
 */

export type DbError = { code?: string | null; message?: string | null } | null | undefined;

export type DbErrorKind = "permission" | "not_found" | "foreign_key" | "invalid" | "range" | "other";

export function classifyDbError(error: DbError): DbErrorKind {
  const code = error?.code ?? "";
  // 42501 insufficient_privilege: a policy or a guard refused (also "new row violates row-level security policy")
  if (code === "42501") return "permission";
  // P0002 no_data_found (raised by archive_record), PGRST116 no rows for .single()
  if (code === "P0002" || code === "PGRST116") return "not_found";
  // 23503 foreign_key_violation: a related id or the assignee does not exist
  if (code === "23503") return "foreign_key";
  // 22023 invalid_parameter_value, 22P02 bad text for a type, 23514 check, 23502 not null
  if (code === "22023" || code === "22P02" || code === "23514" || code === "23502") return "invalid";
  if (code === "PGRST103") return "range";
  return "other";
}

const CONSTRAINT = /(tasks_[a-z_]+)/;

/** Safe to log: the code and, when the message names one, the task constraint. Never the message body. */
export function logTag(error: DbError): string {
  const code = error?.code ?? "unknown";
  const constraint = error?.message?.match(CONSTRAINT)?.[1];
  return constraint ? `${code} ${constraint}` : String(code);
}
