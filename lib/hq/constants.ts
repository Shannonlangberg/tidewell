/*
 * Planted HQ: vocabulary shared by the database contract, the validators and the UI.
 * Values here MUST match the enums in supabase/migrations (schema `hq`). Labels are
 * what people read; values are what the database stores.
 *
 * Client-safe: no server imports.
 */

export const HQ_BASE = "/hq";

// ── staff and permissions ────────────────────────────────────

export const STAFF_ROLES = [
  "director",
  "administrator",
  "senior_property_manager",
  "property_manager",
  "junior_property_manager",
  "business_development_manager",
  "virtual_assistant",
  "read_only",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  director: "Director",
  administrator: "Administrator",
  senior_property_manager: "Senior Property Manager",
  property_manager: "Property Manager",
  junior_property_manager: "Junior Property Manager",
  business_development_manager: "Business Development Manager",
  virtual_assistant: "Virtual Assistant",
  read_only: "Read-only",
};

export const CAPABILITIES = [
  "growth.read",
  "growth.write",
  "growth.delete",
  "tasks.read_all",
  "tasks.write",
  "people.read",
  "people.admin",
  "audit.read",
  "import.run",
  "settings.admin",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "ended"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_LABEL: Record<EmploymentStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  ended: "Ended",
};

// ── growth: partners ─────────────────────────────────────────

export const PARTNER_CATEGORIES = [
  "real_estate_sales",
  "mortgage_broker",
  "conveyancer",
  "lawyer",
  "accountant",
  "bank_lending",
  "buyers_agent",
  "property_developer",
  "builder",
  "financial_adviser",
  "other",
] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<PartnerCategory, string> = {
  real_estate_sales: "Real estate sales",
  mortgage_broker: "Mortgage broker",
  conveyancer: "Conveyancer",
  lawyer: "Lawyer",
  accountant: "Accountant",
  bank_lending: "Bank lending",
  buyers_agent: "Buyers agent",
  property_developer: "Property developer",
  builder: "Builder",
  financial_adviser: "Financial adviser",
  other: "Other",
};

export const RELATIONSHIP_STATUSES = [
  "identified",
  "contacted",
  "meeting_booked",
  "met",
  "active_relationship",
  "referring_partner",
  "inactive",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_LABEL: Record<RelationshipStatus, string> = {
  identified: "Identified",
  contacted: "Contacted",
  meeting_booked: "Meeting booked",
  met: "Met",
  active_relationship: "Active relationship",
  referring_partner: "Referring partner",
  inactive: "Inactive",
};

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

export const ORG_CONTACT_ROLES = ["primary", "secondary", "other"] as const;
export type OrgContactRole = (typeof ORG_CONTACT_ROLES)[number];
export const ORG_CONTACT_ROLE_LABEL: Record<OrgContactRole, string> = {
  primary: "Primary contact",
  secondary: "Secondary contact",
  other: "Other",
};

/** Suggestions for the free-text service region field. Not exhaustive and not enforced. */
export const REGION_SUGGESTIONS = ["Copper Coast", "Adelaide", "Regional South Australia"] as const;

// ── growth: interactions ─────────────────────────────────────

export const INTERACTION_TYPES = ["phone_call", "coffee_meeting", "office_meeting", "email", "message", "note"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];
export const INTERACTION_LABEL: Record<InteractionType, string> = {
  phone_call: "Phone call",
  coffee_meeting: "Coffee meeting",
  office_meeting: "Office meeting",
  email: "Email",
  message: "Message",
  note: "Note",
};

// ── growth: referrals and the pipeline ───────────────────────

export const REFERRAL_DIRECTIONS = ["received", "sent"] as const;
export type ReferralDirection = (typeof REFERRAL_DIRECTIONS)[number];
export const DIRECTION_LABEL: Record<ReferralDirection, string> = { received: "Received", sent: "Sent" };

/** In pipeline order. */
export const OPPORTUNITY_STAGES = [
  "introduction_received",
  "contacted",
  "qualified",
  "appraisal_requested",
  "appraisal_completed",
  "proposal_sent",
  "management_signed",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  introduction_received: "Introduction received",
  contacted: "Contacted",
  qualified: "Qualified",
  appraisal_requested: "Appraisal requested",
  appraisal_completed: "Appraisal completed",
  proposal_sent: "Proposal sent",
  management_signed: "Management signed",
  lost: "Lost / did not proceed",
};

/** Stages that still need work. */
export const OPEN_STAGES: readonly OpportunityStage[] = OPPORTUNITY_STAGES.filter(
  (s) => s !== "management_signed" && s !== "lost",
);

/** Stages that count as "qualified" for reporting: the opportunity reached `qualified` at some point. */
export const QUALIFIED_OR_BEYOND: readonly OpportunityStage[] = [
  "qualified",
  "appraisal_requested",
  "appraisal_completed",
  "proposal_sent",
  "management_signed",
];

export const SENT_OUTCOMES = ["sent", "acknowledged", "converted", "no_outcome"] as const;
export type SentOutcome = (typeof SENT_OUTCOMES)[number];
export const SENT_OUTCOME_LABEL: Record<SentOutcome, string> = {
  sent: "Sent",
  acknowledged: "Acknowledged",
  converted: "Converted",
  no_outcome: "No outcome",
};

// ── operations: tasks ────────────────────────────────────────

export const TASK_STATUSES = ["to_do", "in_progress", "waiting", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Statuses that mean "still to do". */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = ["to_do", "in_progress", "waiting"];

// ── tiny helpers ─────────────────────────────────────────────

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
