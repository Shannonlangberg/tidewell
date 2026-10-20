/*
 * Input schemas for the portfolio MCP tools (zod raw shapes). Kept apart from schemas.ts so the
 * portfolio and the leads pipeline could be built in parallel. Imports only zod: the enum lists are
 * written out and pinned to lib/hq/portfolio/rules.ts by portfolio-schemas.test.mts.
 *
 * These are the first gate, not the last: the tools re-check the portfolio rules and the database
 * (RLS, RPC checks, constraints) decides in the end.
 */
import { z } from "zod";

export const SERVICE_TYPE_VALUES = ["long_term_residential", "short_term_accommodation"] as const;
export const FEE_BASIS_VALUES = ["percent_of_rent", "flat_fee", "other"] as const;
export const MANAGED_STATUS_VALUES = ["onboarding", "active", "offboarding", "ended"] as const;
export const START_STATUS_VALUES = ["onboarding", "active"] as const;
export const AILO_STATUS_VALUES = ["not_started", "set_up", "live"] as const;
export const HANDOVER_STEP_VALUES = [
  "owner_onboarded", "management_agreement_signed", "owner_id_verified", "bank_and_payment_details_in_ailo", "property_created_in_ailo",
  "owner_invited_to_ailo", "condition_report_or_inspection_scheduled", "keys_and_access_arranged", "welcome_pack_sent",
] as const;
export const HANDOVER_STEP_STATUS_VALUES = ["not_started", "in_progress", "done", "not_applicable"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = (what: string) => z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe(`${what} (YYYY-MM-DD).`);
const limit = z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10).");
const propertyRef = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(`${what}: its number as people say it (MP-0001), its id from an earlier result, or words of its address (if several match you get candidates to choose from).`);
const percent = z.number().min(0).max(100).optional().describe("Optional. The management fee as a percentage of rent, 0 to 100 (for example 8.8). Sets the fee basis to percent_of_rent.");

export const listManagedPropertiesShape = {
  query: z.string().trim().max(100).optional().describe("Optional. Words of the address, suburb, owner or Ailo reference, or a number like MP-0001."),
  status: z.enum(MANAGED_STATUS_VALUES).optional().describe("Optional. Only properties with this status: onboarding, active, offboarding or ended."),
  service_type: z.enum(SERVICE_TYPE_VALUES).optional().describe("Optional. long_term_residential or short_term_accommodation (a separate service)."),
  ailo_status: z.enum(AILO_STATUS_VALUES).optional().describe("Optional. Only properties at this Ailo set-up stage: not_started, set_up or live."),
  handover_open: z.boolean().optional().describe("Optional. true: only properties whose nine-step handover is not finished."),
  limit,
};

export const getManagedPropertyShape = { property: propertyRef("The managed property") };

export const createManagedPropertyShape = {
  opportunity: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The SIGNED lead this property comes from: the prospect's name, a referral number like REF-0007, or the opportunity id. Only a lead at management_signed can become a managed property, once."),
  service_type: z.enum(SERVICE_TYPE_VALUES).describe("long_term_residential or short_term_accommodation."),
  property_address: z.string().trim().max(300).optional().describe("Optional. Leave out to use the lead's address (typed once, never twice)."),
  suburb: z.string().trim().max(120).optional().describe("Optional. Leave out to use the lead's suburb."),
  owner_name: z.string().trim().max(200).optional().describe("Optional. The owner's name when they are not a contact; leave out to use the lead's landlord contact or prospect name."),
  fee_percent: percent,
  fee_basis: z.enum(FEE_BASIS_VALUES).optional().describe("Optional. percent_of_rent (needs fee_percent), flat_fee or other."),
  fee_notes: z.string().trim().max(500).optional().describe("Optional. Fee notes, for example a flat fee amount."),
  managed_from: optDate("Optional. When management starts or started"),
  status: z.enum(START_STATUS_VALUES).optional().describe("Optional. onboarding (default) or active (needs managed_from, today or earlier)."),
  ailo_reference: z.string().trim().max(100).optional().describe("Optional. The property's reference in Ailo, if it already has one (typed by a person, never invented)."),
  notes: z.string().trim().max(5000).optional().describe("Optional. Business notes. Tenancy, rent and maintenance stay in Ailo."),
};

export const updateManagedPropertyShape = {
  property: propertyRef("The managed property to change"),
  status: z
    .enum(MANAGED_STATUS_VALUES)
    .optional()
    .describe("Optional. New status. active needs managed_from (today or earlier); ended needs ended_on; reopening an ended property needs a director or administrator."),
  managed_from: optDate("Optional. When management started"),
  ended_on: optDate("Optional. When management ended (only with status ended)"),
  ailo_reference: z.string().trim().max(100).optional().describe('Optional. The property\'s Ailo reference as shown in Ailo, or "none" to clear it (not while Ailo status is live).'),
  ailo_status: z.enum(AILO_STATUS_VALUES).optional().describe("Optional. not_started, set_up or live (live needs an Ailo reference)."),
  service_type: z.enum(SERVICE_TYPE_VALUES).optional().describe("Optional. long_term_residential or short_term_accommodation."),
  fee_percent: percent,
  fee_basis: z.enum(FEE_BASIS_VALUES).optional().describe("Optional. percent_of_rent, flat_fee or other (any but percent_of_rent clears the percentage)."),
  fee_notes: z.string().trim().max(500).optional().describe('Optional. Fee notes, or "none" to clear.'),
  property_address: z.string().trim().min(1).max(300).optional().describe("Optional. A corrected address."),
  suburb: z.string().trim().max(120).optional().describe('Optional. A corrected suburb, or "none" to clear.'),
  owner_name: z.string().trim().max(200).optional().describe("Optional. The owner's name (when they are not a contact)."),
  notes: z.string().trim().max(5000).optional().describe('Optional. Replaces the notes (the old text stays in the audit log), or "none" to clear.'),
  note: z.string().trim().max(1000).optional().describe("Optional. Why it changed (kept in the audit log)."),
};

export const setHandoverStepShape = {
  property: propertyRef("The managed property"),
  step: z
    .enum(HANDOVER_STEP_VALUES)
    .describe(
      "The handover step: owner_onboarded, management_agreement_signed, owner_id_verified, bank_and_payment_details_in_ailo, property_created_in_ailo, owner_invited_to_ailo, condition_report_or_inspection_scheduled, keys_and_access_arranged or welcome_pack_sent.",
    ),
  status: z.enum(HANDOVER_STEP_STATUS_VALUES).describe("not_started, in_progress, done or not_applicable (not_applicable needs a note)."),
  note: z.string().trim().max(1000).optional().describe("Optional, but required for not_applicable: a short note kept on the step. Leaving it out clears any earlier note."),
};

export const businessSummaryShape = {};
