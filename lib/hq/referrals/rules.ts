/*
 * Rules a person's input must meet before it is sent to the database, and the one place that
 * decides which pages a Server Action may send them back to.
 *
 * The database remains the arbiter: these exist so the person gets a clear, field-level message
 * instead of a failed save.
 *
 * Pure and dependency-free (no value imports), so `node --test` can run it.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Nothing in HQ is dated before this. */
export const EARLIEST_DATE = "2000-01-01";

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type DateCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * A date that has already happened (or is today, in the person's timezone): a referral date or the
 * date a management was signed. `label` is the start of the sentence ("The referral date").
 */
export function checkPastOrToday(value: string | null | undefined, today: string, label: string): DateCheck {
  const v = (value ?? "").trim();
  if (!v) return { ok: false, message: `${label} is required.` };
  if (!isRealDate(v)) return { ok: false, message: "Enter a valid date." };
  if (v > today) return { ok: false, message: `${label} can't be in the future.` };
  if (v < EARLIEST_DATE) return { ok: false, message: "That date is too far in the past." };
  return { ok: true, value: v };
}

export type Partner = { contactId: string | null; organisationId: string | null };

export type PartnerCheck =
  | { ok: true; partner: Partner }
  | { ok: false; field: "partner_contact" | "partner_organisation"; message: string };

/**
 * A referral needs a partner: a contact, an organisation, or both. When both are given the contact
 * must belong to that organisation (`contactOrganisationId` is the organisation the contact is at,
 * or null for an independent), because the database refuses a mismatch.
 */
export function checkPartner(input: { contactId: string | null; organisationId: string | null; contactOrganisationId: string | null }): PartnerCheck {
  const { contactId, organisationId, contactOrganisationId } = input;
  if (!contactId && !organisationId) {
    return { ok: false, field: "partner_organisation", message: "Choose the partner: an organisation, a contact, or both." };
  }
  if (contactId && organisationId && contactOrganisationId && contactOrganisationId !== organisationId) {
    return {
      ok: false,
      field: "partner_contact",
      message: "That contact works at a different organisation. Choose their organisation, or leave the organisation blank.",
    };
  }
  return { ok: true, partner: { contactId, organisationId } };
}

// ── where a Server Action may send a person afterwards ───────

const RETURN_PATH = /^\/hq\/growth\/(?:pipeline|referrals(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?)(?:\?[A-Za-z0-9_=&%.,~+:-]{0,300})?$/i;

/**
 * Only the pipeline, the referral register and one referral's page are valid places to return to,
 * with an optional plain query string (filters). Anything else, including another origin or a
 * path outside those, becomes `fallback`. Never redirect to a raw form value.
 */
export function safeReturnPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  return RETURN_PATH.test(v) ? v : fallback;
}

/** The title a follow-up task link carries. It names the reference, never the prospect: names do not go in URLs. */
export function followUpTitle(refLabel: string): string {
  return `Follow up on ${refLabel}`;
}
