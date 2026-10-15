/*
 * What to tell a person when a people RPC (add_staff, update_staff, deactivate_staff) or a
 * write to pods or settings is refused. The database says WHY with a Postgres error code and
 * a short message; people never see either. They get a sentence that says what to do, chosen
 * here. Unknown errors get the caller's own generic fallback.
 *
 * Postgres codes in play (set by the RPCs in 0108_hq_rpc_access.sql and the guard triggers):
 *   42501 insufficient_privilege   not allowed (a director rule, or your own role)
 *   23514 check_violation          the last active director cannot be removed
 *   23505 unique_violation         already exists
 *   22023 invalid_parameter_value  a bad pod, timezone or other argument
 *   P0002 no_data_found            no such person
 *
 * Pure: no imports, so `node --test` can run it.
 */

export type DbErrorLike = { code?: string | null; message?: string | null } | null | undefined;

export function staffErrorMessage(error: DbErrorLike, fallback: string): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  const text = (error.message ?? "").toLowerCase();

  if (code === "42501") {
    if (text.includes("only a director")) return "Only a director can add, change or deactivate a director.";
    if (text.includes("your own role") || text.includes("yourself")) {
      return "You cannot change your own role or status, or deactivate yourself. Ask another administrator.";
    }
    return "You do not have permission to do that.";
  }
  if (code === "23514" || text.includes("at least one active director")) {
    return "At least one active director must remain, so that change was not made.";
  }
  if (code === "23505") {
    if (text.includes("pods_name")) return "A pod with that name already exists.";
    return "That person already has an HQ profile.";
  }
  if (code === "P0002") return "We could not find that person.";
  if (code === "22023") {
    if (text.includes("pod")) return "That pod is not available. Choose another.";
    if (text.includes("timezone")) return "That timezone is not recognised.";
    return "Check the details and try again.";
  }
  return fallback;
}
