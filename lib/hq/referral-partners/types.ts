/*
 * The Referral partners read model as plain data. The view declares every column nullable, so the
 * mapper decides what "missing" means once, here. Types and a pure function only: safe to import
 * from Client Components.
 */

import type { ViewRow } from "../db";
import type { PartnerCategory, RelationshipStatus } from "../constants";

export type ReferralPartner = {
  kind: "organisation" | "independent";
  /** The organisation id, or (independent) the contact id. */
  id: string;
  organisationId: string | null;
  contactId: string | null;
  name: string;
  categories: PartnerCategory[];
  ownerId: string | null;
  ownerName: string | null;
  primaryContactId: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  primaryContactEmail: string | null;
  contactCount: number;
  /** null = never contacted. */
  lastContactedAt: string | null;
  daysSinceContact: number | null;
  nextFollowUpDate: string | null;
  followUpOverdue: boolean;
  /** The most advanced status among the partner's contacts; null when an organisation has none. */
  status: RelationshipStatus | null;
  needsVerification: boolean;
  received: number;
  sent: number;
  qualified: number;
  signed: number;
  conversion: number | null;
  valueSignedCents: number;
  reciprocal: boolean;
  lastReferralDate: string | null;
};

export function toReferralPartner(r: ViewRow<"referral_partner_overview">): ReferralPartner | null {
  if (!r.id || !r.name || (r.partner_kind !== "organisation" && r.partner_kind !== "independent")) return null;
  return {
    kind: r.partner_kind,
    id: r.id,
    organisationId: r.organisation_id,
    contactId: r.contact_id,
    name: r.name,
    categories: r.categories ?? [],
    ownerId: r.relationship_owner_id,
    ownerName: r.relationship_owner_name,
    primaryContactId: r.primary_contact_id,
    primaryContactName: r.primary_contact_name,
    primaryContactPhone: r.primary_contact_phone,
    primaryContactEmail: r.primary_contact_email,
    contactCount: Number(r.contact_count ?? 0),
    lastContactedAt: r.last_contacted_at,
    daysSinceContact: r.days_since_contact === null ? null : Number(r.days_since_contact),
    nextFollowUpDate: r.next_follow_up_date,
    followUpOverdue: Boolean(r.follow_up_overdue),
    status: r.relationship_status,
    needsVerification: Boolean(r.needs_verification),
    received: Number(r.referrals_received ?? 0),
    sent: Number(r.referrals_sent ?? 0),
    qualified: Number(r.referrals_qualified ?? 0),
    signed: Number(r.managements_signed ?? 0),
    conversion: r.conversion === null ? null : Number(r.conversion),
    valueSignedCents: Number(r.estimated_value_signed_cents ?? 0),
    reciprocal: Boolean(r.reciprocal),
    lastReferralDate: r.last_referral_date,
  };
}

/** Where a partner's row leads: the organisation page, or an independent contact's profile. */
export function partnerHref(p: Pick<ReferralPartner, "kind" | "id">): string {
  return p.kind === "organisation" ? `/hq/growth/organisations/${p.id}` : `/hq/growth/contacts/${p.id}`;
}
