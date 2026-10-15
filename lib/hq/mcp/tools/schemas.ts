/*
 * Input schemas for every MCP tool (zod raw shapes, as the MCP SDK takes them). Every field says
 * what it is with .describe(), because that text is all a chat client knows about it.
 *
 * Imports only zod: the enum lists are written out (and pinned to lib/hq/constants.ts by
 * schemas.test.mts) so the tests can load this file under Node's type stripping.
 *
 * These schemas are the first gate, not the last: every write is validated again with the HQ form
 * validators, and the database (RLS, RPC checks, constraints) decides in the end.
 */
import { z } from "zod";

// ── vocabulary (pinned to constants.ts by a test) ────────────

export const CONTRACTOR_CATEGORY_VALUES = [
  "plumbing", "electrical", "general_maintenance", "handyman", "carpentry", "cleaning", "carpet_cleaning", "gardening",
  "landscaping", "pest_control", "locksmith", "painting", "roofing", "guttering", "air_conditioning", "appliance_repairs",
  "garage_doors", "glazing", "tree_services", "building", "emergency_restoration", "other",
] as const;
export const CONTRACTOR_STATUS_VALUES = ["prospect", "contacted", "vetting", "approved", "preferred", "suspended", "inactive"] as const;
export const PARTNER_CATEGORY_VALUES = [
  "real_estate_sales", "mortgage_broker", "conveyancer", "lawyer", "accountant", "bank_lending", "buyers_agent",
  "property_developer", "builder", "financial_adviser", "other",
] as const;
export const RELATIONSHIP_STATUS_VALUES = ["identified", "contacted", "meeting_booked", "met", "active_relationship", "referring_partner", "inactive"] as const;
export const PRIORITY_VALUES = ["high", "medium", "low"] as const;
export const INTERACTION_TYPE_VALUES = ["phone_call", "coffee_meeting", "office_meeting", "email", "message", "note"] as const;
export const OPPORTUNITY_STAGE_VALUES = [
  "introduction_received", "contacted", "qualified", "appraisal_requested", "appraisal_completed", "proposal_sent", "management_signed", "lost",
] as const;
export const TASK_STATUS_VALUES = ["to_do", "in_progress", "waiting", "completed", "cancelled"] as const;
export const TASK_PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;
export const TASK_VIEW_VALUES = ["mine", "today", "overdue", "upcoming", "waiting", "team", "delegated", "completed", "all"] as const;
/** Steps 1 to 8. Step 9 (review_and_approve) is completed only by approving, on the HQ screen. */
export const SETTABLE_VETTING_STEPS = ["identity", "abn", "licence", "insurance", "service_areas", "pricing", "emergency_availability", "communication"] as const;
export const VETTING_STEP_STATUS_VALUES = ["not_started", "in_progress", "done", "not_applicable"] as const;
export const TENANT_FEEDBACK_VALUES = ["positive", "neutral", "negative", "none_received"] as const;
export const GROWTH_PERIOD_VALUES = ["month", "30d", "fy", "all"] as const;
export const EXPIRY_FILTER_VALUES = ["expired", "expiring_soon", "all"] as const;

// ── building blocks ──────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const ref = (noun: string) =>
  z.string().trim().min(1).max(200).describe(`The ${noun}: its name as people say it, or its id from an earlier result (ids are exact; names are matched and, if several match, you get candidates to choose from).`);
const optRef = (noun: string, extra = "") => ref(noun).optional().describe(`Optional. The ${noun}: its name, or its id from an earlier result.${extra ? ` ${extra}` : ""}`);
const optDate = (what: string) => z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe(`${what} (YYYY-MM-DD, in the person's own timezone).`);
const limit = z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10).");
const text = (what: string, max: number) => z.string().trim().min(1).max(max).describe(`${what} (at most ${max} characters).`);
const dollars = (what: string) =>
  z.number().min(0).max(100_000).optional().describe(`Optional. ${what}, in Australian dollars (for example 95 or 95.5). Stored in cents. Leave out if unknown: unknown is not zero.`);

// ── read tools ───────────────────────────────────────────────

export const searchShape = {
  query: z.string().trim().min(2).max(100).describe("What to look for: a name, business, trade, suburb, task title or referral number (2 to 100 characters)."),
};

export const fetchShape = {
  id: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .describe("A record id exactly as `search` returned it: contact:<uuid>, organisation:<uuid>, contractor:<uuid>, task:<uuid> or referral:<uuid>."),
};

export const searchContractorsShape = {
  query: z.string().trim().max(100).optional().describe("Optional. Words to match in the business name, contact person, trade or suburb."),
  trade: z.enum(CONTRACTOR_CATEGORY_VALUES).optional().describe("Optional. Only contractors with this trade."),
  suburb: z.string().trim().max(80).optional().describe("Optional. Only contractors who list this suburb as serviced (exact suburb name, any case)."),
  region: z.string().trim().max(80).optional().describe("Optional. Only contractors who list this service region (exact name, any case)."),
  status: z.enum(CONTRACTOR_STATUS_VALUES).optional().describe("Optional. Only contractors with this status."),
  cleared_only: z.boolean().optional().describe("Optional. true = only approved or preferred contractors (the ones cleared to be sent to a property)."),
  emergency: z.boolean().optional().describe("Optional. true = only contractors recorded as available for emergency call-outs."),
  limit,
};

export const getContractorShape = { contractor: ref("contractor (business name)") };

export const contractorExpiriesShape = {
  state: z.enum(EXPIRY_FILTER_VALUES).optional().describe("Optional. expired, expiring_soon, or all (default all)."),
  limit,
};

export const searchContactsShape = {
  query: z.string().trim().max(100).optional().describe("Optional. Words to match in the person's name, position, email or organisation."),
  organisation: optRef("organisation", "Only contacts at this organisation."),
  status: z.enum(RELATIONSHIP_STATUS_VALUES).optional().describe("Optional. Only contacts with this relationship status."),
  owner: z.string().trim().max(200).optional().describe('Optional. Only contacts this staff member owns: "me", a staff name, or a staff id.'),
  follow_up_due: z.boolean().optional().describe("Optional. true = only contacts whose next follow-up date is today or earlier."),
  limit,
};

export const getContactShape = {
  contact: ref("contact (person)"),
  organisation: optRef("organisation", "Use it to tell apart two people with the same name."),
};

export const searchOrganisationsShape = {
  query: z.string().trim().max(100).optional().describe("Optional. Words to match in the organisation's name or location."),
  category: z.enum(PARTNER_CATEGORY_VALUES).optional().describe("Optional. Only organisations in this partner category."),
  limit,
};

export const listTasksShape = {
  view: z
    .enum(TASK_VIEW_VALUES)
    .optional()
    .describe(
      "Optional. Which list, as on the HQ tasks screen: mine (default: my open tasks), today, overdue, upcoming (next 14 days), waiting, completed (last 30 days), team (others' open tasks; needs tasks.read_all), delegated (tasks I gave to others), all (needs tasks.read_all).",
    ),
  query: z.string().trim().max(100).optional().describe("Optional. Words to match in the task title."),
  priority: z.enum(TASK_PRIORITY_VALUES).optional().describe("Optional. Only tasks with this priority."),
  status: z.enum(TASK_STATUS_VALUES).optional().describe("Optional. Narrow to one status where the view allows it."),
  limit,
};

export const listReferralsShape = {
  direction: z.enum(["received", "sent"]).optional().describe("Optional. received (introductions to Planted) or sent (Planted's referrals out)."),
  stage: z.enum(OPPORTUNITY_STAGE_VALUES).optional().describe("Optional. Only received referrals whose prospect is at this pipeline stage."),
  partner: optRef("partner organisation", "Only referrals with this partner."),
  since: optDate("Optional. Only referrals dated on or after this day"),
  limit,
};

export const pipelineSummaryShape = {};

export const whoToContactShape = {
  days: z.number().int().min(7).max(365).optional().describe("Optional. Also list active contacts not contacted in this many days (default 30)."),
  mine_only: z.boolean().optional().describe("Optional. true = only contacts I own."),
  limit,
};

export const teamDirectoryShape = {};

// ── reports ──────────────────────────────────────────────────

export const dailyBriefShape = {};
export const growthReportShape = {
  period: z.enum(GROWTH_PERIOD_VALUES).optional().describe("Optional. month (this month to date), 30d (last 30 days, default), fy (Australian financial year to date), all (all time)."),
};
export const contractorReportShape = {};
export const weeklyReportShape = {};

// ── write tools ──────────────────────────────────────────────

export const createTaskShape = {
  title: text("What needs doing", 200),
  description: z.string().trim().max(4000).optional().describe("Optional. More detail (at most 4000 characters)."),
  due_date: optDate("Optional. When it is due"),
  priority: z.enum(TASK_PRIORITY_VALUES).optional().describe("Optional. low, normal (default), high or urgent."),
  assignee: z.string().trim().max(200).optional().describe('Optional. Who does it: "me" (default), a staff member\'s name, or their id. Use "nobody" to leave it unassigned.'),
  contact: optRef("contact this task is about"),
  organisation: optRef("organisation this task is about"),
  contractor: optRef("contractor this task is about"),
};

export const updateTaskShape = {
  task: ref("task (its title words or id)"),
  status: z.enum(TASK_STATUS_VALUES).optional().describe("Optional. New status: to_do, in_progress, waiting, completed or cancelled. A completed or cancelled task must be reopened (to_do) before it can move elsewhere."),
  due_date: z
    .union([z.string().regex(DATE, "Use YYYY-MM-DD."), z.literal("none")])
    .optional()
    .describe('Optional. New due date (YYYY-MM-DD), or "none" to clear it.'),
  priority: z.enum(TASK_PRIORITY_VALUES).optional().describe("Optional. New priority."),
  assignee: z.string().trim().max(200).optional().describe('Optional. New assignee: "me", a staff name, a staff id, or "nobody".'),
  description: z.string().trim().max(4000).optional().describe("Optional. Replaces the task's description (the previous text is shown in the result)."),
};

export const logInteractionShape = {
  contact: optRef("contact (person) it was with"),
  organisation: optRef("organisation it was with", "Give a contact, an organisation (or both, if the person works there), or a contractor."),
  contractor: optRef("contractor it was with", "Needs contractors.write as well."),
  type: z.enum(INTERACTION_TYPE_VALUES).describe("What it was: phone_call, coffee_meeting, office_meeting, email, message or note."),
  summary: text("What was said or agreed", 4000),
  occurred_at: z
    .string()
    .regex(LOCAL_TIME, "Use YYYY-MM-DDTHH:mm.")
    .optional()
    .describe("Optional. When it happened, as local wall-clock time in the person's timezone (YYYY-MM-DDTHH:mm). Default now. Never in the future."),
  next_action: z.string().trim().max(500).optional().describe("Optional. The next step (also the follow-up task's title)."),
  follow_up_date: optDate("Optional. When to follow up (today or later)"),
  create_task: z.boolean().optional().describe("Optional. true = also create a follow-up task due on follow_up_date (needs follow_up_date and tasks.write)."),
  task_assignee: z.string().trim().max(200).optional().describe('Optional. Who the follow-up task is for: "me" (default), a staff name or id.'),
  new_relationship_status: z.enum(RELATIONSHIP_STATUS_VALUES).optional().describe("Optional, contacts only. Move the contact's relationship status."),
  mark_contacted: z.boolean().optional().describe("Optional, contractors only. true = move a prospect contractor to contacted (never further)."),
};

export const logContractorContactShape = {
  contractor: ref("contractor (business name)"),
  type: logInteractionShape.type,
  summary: logInteractionShape.summary,
  occurred_at: logInteractionShape.occurred_at,
  next_action: logInteractionShape.next_action,
  follow_up_date: logInteractionShape.follow_up_date,
  create_task: logInteractionShape.create_task,
  task_assignee: logInteractionShape.task_assignee,
  mark_contacted: logInteractionShape.mark_contacted,
};

export const createContactShape = {
  full_name: text("The person's full name", 200),
  organisation: optRef("organisation they work at", "It must already exist in HQ (use create_organisation first if not). Leave out for an independent."),
  categories: z.array(z.enum(PARTNER_CATEGORY_VALUES)).min(1).max(11).describe("At least one partner category, for example [\"mortgage_broker\"]."),
  position: z.string().trim().max(200).optional().describe("Optional. Their job title."),
  phone: z.string().trim().max(40).optional().describe("Optional. Phone number."),
  email: z.string().trim().max(254).optional().describe("Optional. Email address."),
  website: z.string().trim().max(300).optional().describe("Optional. Website."),
  location: z.string().trim().max(300).optional().describe("Optional. Where they are based."),
  service_region: z.string().trim().max(120).optional().describe("Optional. The region they serve."),
  status: z.enum(RELATIONSHIP_STATUS_VALUES).optional().describe("Optional. Relationship status (default identified)."),
  priority: z.enum(PRIORITY_VALUES).optional().describe("Optional. high, medium (default) or low."),
  owner: z.string().trim().max(200).optional().describe('Optional. Relationship owner: "me", a staff name or id.'),
  notes: z.string().trim().max(4000).optional().describe("Optional. Notes (at most 4000 characters)."),
};

export const updateContactShape = {
  contact: ref("contact (person)"),
  organisation: optRef("organisation", "Only to tell apart two people with the same name; it does not move them."),
  phone: z.string().trim().max(40).optional().describe('Optional. New phone number, or "none" to clear it.'),
  email: z.string().trim().max(254).optional().describe('Optional. New email address, or "none" to clear it.'),
  position: z.string().trim().max(200).optional().describe('Optional. New job title, or "none" to clear it.'),
  status: z.enum(RELATIONSHIP_STATUS_VALUES).optional().describe("Optional. New relationship status."),
  priority: z.enum(PRIORITY_VALUES).optional().describe("Optional. New priority."),
  next_follow_up_date: z
    .union([z.string().regex(DATE, "Use YYYY-MM-DD."), z.literal("none")])
    .optional()
    .describe('Optional. Next follow-up date (YYYY-MM-DD, today or later), or "none" to clear it.'),
  add_note: z.string().trim().min(1).max(2000).optional().describe("Optional. A note to ADD to their notes (dated and attributed; existing notes are kept)."),
};

export const createOrganisationShape = {
  name: text("The organisation's name", 200),
  categories: z.array(z.enum(PARTNER_CATEGORY_VALUES)).min(1).max(11).describe("At least one partner category, for example [\"real_estate_sales\"]."),
  website: z.string().trim().max(300).optional().describe("Optional. Website."),
  phone: z.string().trim().max(40).optional().describe("Optional. Main phone number."),
  email: z.string().trim().max(254).optional().describe("Optional. Main email address."),
  location: z.string().trim().max(300).optional().describe("Optional. Where it is."),
  service_region: z.string().trim().max(120).optional().describe("Optional. The region it serves."),
  owner: z.string().trim().max(200).optional().describe('Optional. Relationship owner: "me", a staff name or id.'),
  notes: z.string().trim().max(4000).optional().describe("Optional. Notes (at most 4000 characters)."),
};

export const updateContractorShape = {
  contractor: ref("contractor (business name)"),
  primary_contact_name: z.string().trim().max(200).optional().describe('Optional. The contact person, or "none" to clear it.'),
  phone: z.string().trim().max(40).optional().describe('Optional. Phone number, or "none" to clear it.'),
  email: z.string().trim().max(254).optional().describe('Optional. Email address, or "none" to clear it.'),
  website: z.string().trim().max(300).optional().describe('Optional. Website, or "none" to clear it.'),
  add_suburbs: z.array(z.string().trim().min(1).max(80)).max(40).optional().describe("Optional. Suburbs to ADD to the suburbs serviced."),
  remove_suburbs: z.array(z.string().trim().min(1).max(80)).max(40).optional().describe("Optional. Suburbs to REMOVE from the suburbs serviced."),
  add_regions: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Optional. Service regions to ADD."),
  remove_regions: z.array(z.string().trim().min(1).max(80)).max(20).optional().describe("Optional. Service regions to REMOVE."),
  hourly_rate: dollars("Hourly rate"),
  callout_fee: dollars("Call-out fee"),
  after_hours_fee: dollars("After-hours fee"),
  minimum_charge: dollars("Minimum charge"),
  clear_rates: z
    .array(z.enum(["hourly_rate", "callout_fee", "after_hours_fee", "minimum_charge"]))
    .max(4)
    .optional()
    .describe("Optional. Rates to set back to unknown (not recorded)."),
  add_note: z.string().trim().min(1).max(2000).optional().describe("Optional. A note to ADD to the internal notes (dated and attributed; existing notes are kept)."),
};

export const recordContractorReviewShape = {
  contractor: ref("contractor (business name)"),
  job_date: optDate("Optional. The day of the job (not in the future)"),
  job_reference: z.string().trim().max(200).optional().describe("Optional. The job reference as staff know it (free text)."),
  response_time: z.number().int().min(1).max(5).optional().describe("Optional. 1 (poor) to 5 (excellent). Leave out if not known."),
  communication: z.number().int().min(1).max(5).optional().describe("Optional. 1 (poor) to 5 (excellent)."),
  work_quality: z.number().int().min(1).max(5).optional().describe("Optional. 1 (poor) to 5 (excellent)."),
  invoice_accuracy: z.number().int().min(1).max(5).optional().describe("Optional. 1 (poor) to 5 (excellent)."),
  tenant_feedback: z.enum(TENANT_FEEDBACK_VALUES).optional().describe("Optional. positive, neutral, negative or none_received."),
  rework_required: z.boolean().optional().describe("Optional. Whether the job had to be redone."),
  notes: z.string().trim().max(2000).optional().describe("Optional. Notes. At least one rating or a note is required."),
};

export const setVettingStepShape = {
  contractor: ref("contractor (business name)"),
  step: z.enum(SETTABLE_VETTING_STEPS).describe("The checklist step (1 to 8). The final review_and_approve step happens only when a director approves on the HQ screen."),
  status: z.enum(VETTING_STEP_STATUS_VALUES).describe("not_started, in_progress, done, or not_applicable (needs a note saying why)."),
  note: z.string().trim().max(1000).optional().describe('Optional. The step\'s note. Leave out to keep the existing note; "none" clears it.'),
};

export const recordReferralShape = {
  direction: z.enum(["received", "sent"]).describe("received: a partner introduced a prospect to Planted. sent: Planted referred someone to a partner."),
  partner_contact: optRef("partner contact (person)"),
  partner_organisation: optRef("partner organisation", "A referral needs a partner contact, a partner organisation, or both."),
  referral_date: optDate("Optional. The day of the referral (default today; never in the future)"),
  prospect_name: z.string().trim().max(200).optional().describe("The prospect's name. Required for a new received referral."),
  prospect_phone: z.string().trim().max(40).optional().describe("Optional. The prospect's phone."),
  prospect_email: z.string().trim().max(254).optional().describe("Optional. The prospect's email."),
  property_suburb: z.string().trim().max(120).optional().describe("Optional. The property's suburb."),
  property_address: z.string().trim().max(300).optional().describe("Optional. The property's address."),
  estimated_annual_value: dollars("Received only: the estimated annual management value"),
  assignee: z.string().trim().max(200).optional().describe('Optional. Who handles it: "me", a staff name or id.'),
  notes: z.string().trim().max(2000).optional().describe("Optional. Notes (at most 2000 characters)."),
  existing_prospect: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Received only, optional: when this prospect is ALREADY in the pipeline, name them (or give REF-0001 / the opportunity id). The referral is then recorded as a further claim; the credit stays with the first source."),
};

export const moveOpportunityShape = {
  opportunity: ref("prospect in the pipeline (the prospect's name, a referral number like REF-0007, or the opportunity id)"),
  stage: z
    .enum(OPPORTUNITY_STAGE_VALUES)
    .describe("The stage to move to. management_signed and lost are refused here: they are done on the HQ pipeline screen."),
  note: z.string().trim().max(500).optional().describe("Optional. A note for the stage history."),
};
