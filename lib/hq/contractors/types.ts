/*
 * Plain-data shapes for the contractor screens and the mapper from a hq.contractor_directory
 * row. The view declares every column nullable and its derived states as plain strings, so the
 * mapper decides once what "missing" means and narrows the states. Everything unknown stays
 * null: a missing rate is not $0, a missing emergency answer is not "no".
 *
 * Client-safe: types and pure functions only; `import type` is erased.
 */

import type { ViewRow } from "../db";
import type { ContractorExpiryState, ContractorStatus } from "../constants";

export type Loaded<T> = { ok: true; data: T } | { ok: false };

const EXPIRY_STATES: readonly string[] = ["not_recorded", "unverified", "current", "expiring_soon", "expired"];
const STATUSES: readonly string[] = ["prospect", "contacted", "vetting", "approved", "preferred", "suspended", "inactive"];

export function narrowExpiryState(value: string | null | undefined): ContractorExpiryState {
  return value && EXPIRY_STATES.includes(value) ? (value as ContractorExpiryState) : "not_recorded";
}

export type Contractor = {
  id: string;
  businessName: string;
  primaryContactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  abn: string | null;
  /** Trade slugs (hq.trades.slug), in the order chosen. */
  categories: string[];
  /** The trades' current labels, in the same order (renamed by the owner on the Trades page). */
  tradeLabels: string[];
  serviceSuburbs: string[];
  serviceRegions: string[];
  /** null means unknown, which is different from "no". */
  emergencyAvailable: boolean | null;
  businessHours: string | null;
  hourlyRateCents: number | null;
  calloutFeeCents: number | null;
  afterHoursFeeCents: number | null;
  minimumChargeCents: number | null;
  invoiceTerms: string | null;
  licenceDetails: string | null;
  licenceVerifiedAt: string | null;
  licenceExpiresOn: string | null;
  licenceState: ContractorExpiryState;
  licenceDaysRemaining: number | null;
  insuranceDetails: string | null;
  insuranceVerifiedAt: string | null;
  insuranceExpiresOn: string | null;
  insuranceState: ContractorExpiryState;
  insuranceDaysRemaining: number | null;
  status: ContractorStatus;
  statusReason: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  internalNotes: string | null;
  lastJobDate: string | null;
  source: string | null;
  needsVerification: boolean;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  vettingDoneCount: number;
  reviewCount: number;
  ratedReviewCount: number;
  ratingThreshold: number;
  /** null unless there is enough rated feedback. Never a placeholder. */
  rating: number | null;
  documentCount: number;
  openTaskCount: number;
  lastContactedAt: string | null;
};

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export function toContractor(r: ViewRow<"contractor_directory">): Contractor | null {
  if (!r.id || !r.business_name) return null;
  const status = r.status && STATUSES.includes(r.status) ? (r.status as ContractorStatus) : "prospect";
  return {
    id: r.id,
    businessName: r.business_name,
    primaryContactName: r.primary_contact_name,
    phone: r.phone,
    email: r.email,
    website: r.website,
    abn: r.abn,
    categories: r.categories ?? [],
    tradeLabels: r.trade_labels ?? (r.categories ?? []).map((s) => s.replace(/_/g, " ")),
    serviceSuburbs: r.service_suburbs ?? [],
    serviceRegions: r.service_regions ?? [],
    emergencyAvailable: r.emergency_available,
    businessHours: r.business_hours,
    hourlyRateCents: num(r.hourly_rate_cents),
    calloutFeeCents: num(r.callout_fee_cents),
    afterHoursFeeCents: num(r.after_hours_fee_cents),
    minimumChargeCents: num(r.minimum_charge_cents),
    invoiceTerms: r.invoice_terms,
    licenceDetails: r.licence_details,
    licenceVerifiedAt: r.licence_verified_at,
    licenceExpiresOn: r.licence_expires_on,
    licenceState: narrowExpiryState(r.licence_state),
    licenceDaysRemaining: num(r.licence_days_remaining),
    insuranceDetails: r.insurance_details,
    insuranceVerifiedAt: r.insurance_verified_at,
    insuranceExpiresOn: r.insurance_expires_on,
    insuranceState: narrowExpiryState(r.insurance_state),
    insuranceDaysRemaining: num(r.insurance_days_remaining),
    status,
    statusReason: r.status_reason,
    approvedAt: r.approved_at,
    approvedByName: r.approved_by_name,
    ownerId: r.relationship_owner_id,
    ownerName: r.relationship_owner_name,
    internalNotes: r.internal_notes,
    lastJobDate: r.last_job_date,
    source: r.source,
    needsVerification: r.needs_verification ?? false,
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    vettingDoneCount: Number(r.vetting_done_count ?? 0),
    reviewCount: Number(r.review_count ?? 0),
    ratedReviewCount: Number(r.rated_review_count ?? 0),
    ratingThreshold: Number(r.rating_threshold ?? 3),
    rating: num(r.rating),
    documentCount: Number(r.document_count ?? 0),
    openTaskCount: Number(r.open_task_count ?? 0),
    lastContactedAt: r.last_contacted_at,
  };
}

/** "Not enough feedback yet (1 of 3)" until the rule is met, otherwise the figure. Never a placeholder star. */
export function ratingText(c: Pick<Contractor, "rating" | "ratedReviewCount" | "ratingThreshold">): string {
  if (c.rating === null) return `Not enough feedback yet (${c.ratedReviewCount} of ${c.ratingThreshold})`;
  return `${c.rating.toFixed(1)} out of 5`;
}

/** "5 of 9" */
export function vettingProgressText(done: number): string {
  return `${Math.max(0, Math.min(9, done))} of 9`;
}

/** True for an approved or preferred contractor whose insurance or licence has run out: flagged loudly, never auto-changed. */
export function clearedButExpired(c: Pick<Contractor, "status" | "insuranceState" | "licenceState">): boolean {
  return (c.status === "approved" || c.status === "preferred") && (c.insuranceState === "expired" || c.licenceState === "expired");
}
