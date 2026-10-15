/*
 * Plain-data shapes for the relationship CRM (contacts, organisations, interactions), and the
 * mappers that turn a database row into one. The views declare every column nullable, so the
 * mappers decide what "missing" means once, here, and the rest of the code reads clean types.
 *
 * Importable from Client Components (types and pure functions only: no server imports at
 * runtime; `import type` is erased).
 */

import type { ViewRow } from "../db";
import type { InteractionType, OrgContactRole, PartnerCategory, Priority, RelationshipStatus, TaskStatus } from "../constants";

export type Contact = {
  id: string;
  fullName: string;
  position: string | null;
  organisationId: string | null;
  organisationName: string | null;
  categories: PartnerCategory[];
  phone: string | null;
  email: string | null;
  website: string | null;
  location: string | null;
  serviceRegion: string | null;
  orgContactRole: OrgContactRole;
  ownerId: string | null;
  ownerName: string | null;
  status: RelationshipStatus;
  priority: Priority;
  lastContactAt: string | null;
  nextFollowUpDate: string | null;
  followUpOverdue: boolean;
  notes: string | null;
  source: string | null;
  needsVerification: boolean;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  referralsReceived: number;
  referralsSent: number;
};

export function toContact(r: ViewRow<"contact_directory">): Contact | null {
  if (!r.id || !r.full_name) return null;
  return {
    id: r.id,
    fullName: r.full_name,
    position: r.position,
    organisationId: r.organisation_id,
    organisationName: r.organisation_name,
    categories: r.categories ?? [],
    phone: r.phone,
    email: r.email,
    website: r.website,
    location: r.location,
    serviceRegion: r.service_region,
    orgContactRole: r.org_contact_role ?? "secondary",
    ownerId: r.relationship_owner_id,
    ownerName: r.relationship_owner_name,
    status: r.relationship_status ?? "identified",
    priority: r.priority ?? "medium",
    lastContactAt: r.last_contact_at,
    nextFollowUpDate: r.next_follow_up_date,
    followUpOverdue: r.follow_up_overdue ?? false,
    notes: r.notes,
    source: r.source,
    needsVerification: r.needs_verification ?? false,
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    referralsReceived: Number(r.referrals_received ?? 0),
    referralsSent: Number(r.referrals_sent ?? 0),
  };
}

export type Organisation = {
  id: string;
  name: string;
  categories: PartnerCategory[];
  website: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  serviceRegion: string | null;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  source: string | null;
  needsVerification: boolean;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  contactCount: number;
  primaryContactId: string | null;
  primaryContactName: string | null;
  lastContactAt: string | null;
  nextFollowUpDate: string | null;
};

export function toOrganisation(r: ViewRow<"organisation_directory">): Organisation | null {
  if (!r.id || !r.name) return null;
  return {
    id: r.id,
    name: r.name,
    categories: r.categories ?? [],
    website: r.website,
    phone: r.phone,
    email: r.email,
    location: r.location,
    serviceRegion: r.service_region,
    ownerId: r.relationship_owner_id,
    ownerName: r.relationship_owner_name,
    notes: r.notes,
    source: r.source,
    needsVerification: r.needs_verification ?? false,
    verifiedAt: r.verified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    contactCount: Number(r.contact_count ?? 0),
    primaryContactId: r.primary_contact_id,
    primaryContactName: r.primary_contact_name,
    lastContactAt: r.last_contact_at,
    nextFollowUpDate: r.next_follow_up_date,
  };
}

export type InteractionItem = {
  id: string;
  type: InteractionType;
  occurredAt: string;
  summary: string;
  nextAction: string | null;
  followUpDate: string | null;
  taskId: string | null;
  staffName: string | null;
  contactId: string | null;
  contactName: string | null;
};

export type ReferralItem = {
  id: string;
  refLabel: string;
  direction: "received" | "sent";
  referralDate: string | null;
  prospectName: string | null;
  stage: string | null;
  sentOutcome: string | null;
  partnerContactName: string | null;
};

export type ReferralSummary = {
  received: number;
  sent: number;
  signed: number;
  recent: ReferralItem[];
};

export type TaskItem = {
  id: string;
  title: string;
  dueDate: string | null;
  status: TaskStatus;
  assigneeName: string | null;
};

/** A result that may have failed to load. Pages show a quiet message for a failed secondary panel. */
export type Loaded<T> = { ok: true; data: T } | { ok: false };
