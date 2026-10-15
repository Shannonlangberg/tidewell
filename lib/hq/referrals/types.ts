/*
 * Plain-data shapes for referrals and the pipeline, and the mappers that turn a database row
 * into one. The views declare every column nullable, so the mappers decide what "missing" means
 * once, here, and the rest of the code reads clean types.
 *
 * Importable from Client Components (types and pure functions only: `import type` is erased, so
 * nothing from the server-only database module reaches the browser).
 */

import type { Enum, ViewRow } from "../db";
import type { ReferralDirection, SentOutcome } from "../constants";

export type Stage = Enum<"opportunity_stage">;

/** A result that may have failed to load. Pages show a quiet message for a failed secondary panel. */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** One row of the referral register. Carries no prospect phone, email or address. */
export type ReferralListItem = {
  id: string;
  refLabel: string;
  direction: ReferralDirection;
  referralDate: string;
  isAttributed: boolean;
  sentOutcome: SentOutcome | null;
  partnerOrganisationId: string | null;
  partnerOrganisationName: string | null;
  partnerContactId: string | null;
  partnerContactName: string | null;
  opportunityId: string | null;
  prospectName: string | null;
  propertySuburb: string | null;
  stage: Stage | null;
  estimateCents: number | null;
  signedAt: string | null;
  assignedToName: string | null;
};

export type ListRow = Pick<
  ViewRow<"referral_overview">,
  | "id"
  | "ref_label"
  | "direction"
  | "referral_date"
  | "is_attributed"
  | "sent_outcome"
  | "partner_organisation_id"
  | "partner_organisation_name"
  | "partner_contact_id"
  | "partner_contact_name"
  | "opportunity_id"
  | "prospect_name"
  | "property_suburb"
  | "stage"
  | "estimated_annual_value_cents"
  | "signed_at"
  | "assigned_to_name"
>;

/** The columns the register selects. No contact details of the prospect. */
export const LIST_COLUMNS =
  "id, ref_label, direction, referral_date, is_attributed, sent_outcome, partner_organisation_id, partner_organisation_name, partner_contact_id, partner_contact_name, opportunity_id, prospect_name, property_suburb, stage, estimated_annual_value_cents, signed_at, assigned_to_name" as const;

export function toListItem(r: ListRow): ReferralListItem | null {
  if (!r.id || !r.ref_label || !r.direction || !r.referral_date) return null;
  return {
    id: r.id,
    refLabel: r.ref_label,
    direction: r.direction,
    referralDate: r.referral_date,
    isAttributed: r.is_attributed ?? false,
    sentOutcome: r.sent_outcome,
    partnerOrganisationId: r.partner_organisation_id,
    partnerOrganisationName: r.partner_organisation_name,
    partnerContactId: r.partner_contact_id,
    partnerContactName: r.partner_contact_name,
    opportunityId: r.opportunity_id,
    prospectName: r.prospect_name,
    propertySuburb: r.property_suburb,
    stage: r.stage,
    estimateCents: r.estimated_annual_value_cents === null ? null : Number(r.estimated_annual_value_cents),
    signedAt: r.signed_at,
    assignedToName: r.assigned_to_name,
  };
}

export type PartnerPerformanceRow = {
  organisationId: string;
  name: string;
  categories: Enum<"partner_category">[];
  received: number;
  sent: number;
  qualified: number;
  signed: number;
  /** signed / received, or null when nothing was received. */
  conversion: number | null;
  estimatedValueSignedCents: number;
  reciprocal: boolean;
};

export function toPartnerRow(r: ViewRow<"partner_performance">): PartnerPerformanceRow | null {
  if (!r.organisation_id || !r.organisation_name) return null;
  return {
    organisationId: r.organisation_id,
    name: r.organisation_name,
    categories: r.categories ?? [],
    received: Number(r.received ?? 0),
    sent: Number(r.sent ?? 0),
    qualified: Number(r.qualified ?? 0),
    signed: Number(r.signed ?? 0),
    conversion: r.conversion === null || r.conversion === undefined ? null : Number(r.conversion),
    estimatedValueSignedCents: Number(r.estimated_value_signed_cents ?? 0),
    reciprocal: r.reciprocal ?? false,
  };
}

/** The opportunity behind a received referral: the prospective management. */
export type OpportunityDetail = {
  id: string;
  number: number;
  prospectName: string;
  prospectPhone: string | null;
  prospectEmail: string | null;
  propertySuburb: string | null;
  propertyAddress: string | null;
  stage: Stage;
  stageChangedAt: string;
  estimateCents: number | null;
  assignedToId: string | null;
  assignedToName: string | null;
  signedAt: string | null;
  managementReference: string | null;
  lostReason: string | null;
  notes: string | null;
};

export type StageHistoryItem = {
  id: number;
  fromStage: Stage | null;
  toStage: Stage;
  changedAt: string;
  changedByName: string | null;
  note: string | null;
};

/** One of the received referrals for an opportunity: the credited one, or a further claim. */
export type ClaimItem = {
  id: string;
  refLabel: string;
  referralDate: string;
  isAttributed: boolean;
  partnerOrganisationId: string | null;
  partnerOrganisationName: string | null;
  partnerContactId: string | null;
  partnerContactName: string | null;
};

/** The single referral a detail page is about. */
export type ReferralDetail = {
  id: string;
  refNumber: number;
  refLabel: string;
  direction: ReferralDirection;
  referralDate: string;
  isAttributed: boolean;
  sentOutcome: SentOutcome | null;
  partnerOrganisationId: string | null;
  partnerOrganisationName: string | null;
  partnerContactId: string | null;
  partnerContactName: string | null;
  opportunityId: string | null;
  prospectName: string | null;
  prospectPhone: string | null;
  prospectEmail: string | null;
  propertySuburb: string | null;
  propertyAddress: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
  createdAt: string | null;
};

/** One card on the pipeline board. */
export type PipelineCard = {
  /** The attributed referral's id: the card links to its page. */
  referralId: string;
  refLabel: string;
  opportunityId: string;
  prospectName: string;
  propertySuburb: string | null;
  stage: Stage;
  stageChangedAt: string | null;
  estimateCents: number | null;
  signedAt: string | null;
  partnerOrganisationName: string | null;
  partnerContactName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  /** Other partners who also claim this prospect (not credited). */
  otherClaims: number;
};
