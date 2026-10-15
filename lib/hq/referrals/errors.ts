/*
 * Turns a Postgres / PostgREST error from the referral RPCs into something a Server Action can
 * act on, without ever showing the raw message to a person or writing personal data to a log.
 *
 * The RPCs raise plain, structural messages ("a lost opportunity needs a reason"), so a message
 * is MATCHED here but never SHOWN: people read our wording, not the database's. The `details` of a
 * unique violation holds the offending VALUES (a name, a reference): it is never read here and
 * must never be logged.
 *
 * Pure and dependency-free, so `node --test` can run it.
 */

export type DbError = { code?: string | null; message?: string | null } | null | undefined;

export type ReferralErrorKind =
  | "permission"
  | "not_found"
  | "partner_not_found"
  | "duplicate_claim"
  | "duplicate_reference"
  | "attribution_conflict"
  | "attributed_source"
  | "prospect_required"
  | "assignee_inactive"
  | "lost_reason_required"
  | "leave_signed_forbidden"
  | "partner_required"
  | "partner_mismatch"
  | "value_on_claim"
  | "not_a_claim"
  | "invalid"
  | "other";

function has(message: string, ...needles: string[]): boolean {
  return needles.some((n) => message.includes(n));
}

export function classifyReferralError(error: DbError): ReferralErrorKind {
  const code = error?.code ?? "";
  const m = (error?.message ?? "").toLowerCase();

  if (code === "42501") return has(m, "move an opportunity out of management_signed") ? "leave_signed_forbidden" : "permission";

  if (code === "23505") {
    if (has(m, "opportunities_management_reference_uq")) return "duplicate_reference";
    if (has(m, "referrals_one_attributed_uq")) return "attribution_conflict";
    // record_referral raises unique_violation itself for a partner that already has a claim.
    if (has(m, "already has a referral")) return "duplicate_claim";
    return "other";
  }

  if (code === "P0002" || code === "PGRST116") {
    if (has(m, "contact not found", "organisation not found")) return "partner_not_found";
    return "not_found";
  }

  if (code === "23514") {
    if (has(m, "attributed source")) return "attributed_source";
    if (has(m, "none is attributed")) return "attribution_conflict";
    return "invalid";
  }

  if (code === "22023") {
    if (has(m, "prospect name is required")) return "prospect_required";
    if (has(m, "active member of staff")) return "assignee_inactive";
    if (has(m, "lost opportunity needs a reason")) return "lost_reason_required";
    if (has(m, "needs a referring contact or organisation", "needs a receiving contact or organisation")) return "partner_required";
    if (has(m, "does not belong")) return "partner_mismatch";
    if (has(m, "estimated value belongs to the opportunity", "creates no opportunity")) return "value_on_claim";
    if (has(m, "not a received referral for this opportunity")) return "not_a_claim";
    return "invalid";
  }

  if (code === "22P02" || code === "23502" || code === "23503") return "invalid";
  return "other";
}

/** Safe to log: the code and, for a unique violation, the constraint name. Never the message body or details. */
export function logTag(error: DbError): string {
  const code = error?.code ?? "unknown";
  const message = error?.message ?? "";
  const constraint = ["opportunities_management_reference_uq", "referrals_one_attributed_uq"].find((n) => message.includes(n));
  return constraint ? `${code} ${constraint}` : String(code);
}
