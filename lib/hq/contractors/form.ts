/*
 * Reads and validates the add / edit contractor form from a FormReader. Pure: `FormReader` is a
 * type import only (the caller constructs it), and the category list is passed in, so
 * `node --test` can run this against a FormData.
 *
 * Rules the database also enforces, repeated here only so the message lands beside the field:
 * at least one trade, an ABN that passes the modulus-89 check, money that is blank (unknown) or a
 * non-negative amount. Unknown stays unknown: a blank rate is null, "Not known" for emergency
 * availability is null, a blank ABN is null.
 *
 * Status is deliberately NOT here. A contractor is created as a prospect, and every status move
 * goes through its own action and RPC (set_contractor_status, approve_contractor, ...).
 */

import type { FormReader } from "../forms";
import type { ParsedDollars } from "./money";

export const LIMITS = {
  businessName: 200,
  contactName: 200,
  hours: 300,
  terms: 500,
  details: 1000,
  notes: 4000,
  suburbs: 80,
  placeLength: 80,
} as const;

export type ContractorFormValues = {
  id: string | null;
  /** The updated_at the person was looking at when they opened the edit form. */
  version: string | null;
  businessName: string;
  primaryContactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** 11 digits without spaces, or null. */
  abn: string | null;
  categories: string[];
  serviceSuburbs: string[];
  serviceRegions: string[];
  /** true / false / null (not known). */
  emergencyAvailable: boolean | null;
  businessHours: string | null;
  hourlyRateCents: number | null;
  calloutFeeCents: number | null;
  afterHoursFeeCents: number | null;
  minimumChargeCents: number | null;
  invoiceTerms: string | null;
  licenceDetails: string | null;
  licenceExpiresOn: string | null;
  insuranceDetails: string | null;
  insuranceExpiresOn: string | null;
  ownerId: string | null;
  internalNotes: string | null;
  lastJobDate: string | null;
};

/** Field -> label, for the form summary. */
export const CONTRACTOR_FORM_LABELS: Record<string, string> = {
  business_name: "Business name",
  primary_contact_name: "Contact person",
  phone: "Phone",
  email: "Email",
  website: "Website",
  abn: "ABN",
  categories: "Trades",
  service_suburbs: "Suburbs serviced",
  service_regions: "Regions serviced",
  emergency_available: "Emergency call-outs",
  business_hours: "Business hours",
  hourly_rate: "Hourly rate",
  callout_fee: "Call-out fee",
  after_hours_fee: "After-hours fee",
  minimum_charge: "Minimum charge",
  invoice_terms: "Invoice terms",
  licence_details: "Licence details",
  licence_expires_on: "Licence expiry",
  insurance_details: "Insurance details",
  insurance_expires_on: "Insurance expiry",
  relationship_owner_id: "Relationship owner",
  internal_notes: "Internal notes",
  last_job_date: "Last job",
};

const PLACE = /^[\p{L}\p{N} '’.-]+$/u;

/**
 * "Moonta, Moonta Bay; Wallaroo" or one per line -> a clean list. Blank entries dropped, repeats
 * (any case) dropped keeping the first spelling. Returns the list and, when something is wrong, a message.
 */
export function parsePlaceList(raw: string | null, label: string): { items: string[]; error: string | null } {
  if (!raw) return { items: [], error: null };
  const seen = new Set<string>();
  const items: string[] = [];
  for (const piece of raw.split(/[\n,;]+/)) {
    const t = piece.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > LIMITS.placeLength) return { items: [], error: `Each ${label} name must be ${LIMITS.placeLength} characters or fewer.` };
    if (!PLACE.test(t)) return { items: [], error: `Names can use letters, numbers, spaces, apostrophes, full stops and hyphens. Separate them with commas or new lines.` };
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t);
  }
  if (items.length > LIMITS.suburbs) return { items: [], error: `That is more than ${LIMITS.suburbs} places. List the main ones.` };
  return { items, error: null };
}

/** The list back as text for the textarea: one per line. */
export function placeListText(items: readonly string[]): string {
  return items.join("\n");
}

/**
 * What the reader needs from its neighbours, passed in because a tested module cannot import a sibling
 * (Node's type stripping needs a ".ts" extension that the project's tsconfig refuses). The caller hands in
 * abnProblem / stripAbn (abn.ts) and parseDollars (money.ts).
 */
export type FormHelpers = {
  categories: readonly string[];
  abnProblem: (raw: string) => string | null;
  stripAbn: (raw: string) => string;
  parseDollars: (raw: string | null) => ParsedDollars;
};

export function readContractorFields(f: FormReader, h: FormHelpers): ContractorFormValues {
  const { abnProblem, stripAbn, parseDollars } = h;
  const categoryList = h.categories;
  const id = f.uuid("id");
  const version = f.text("version", { max: 64 });
  const businessName = f.requiredText("business_name", { label: "Business name", max: LIMITS.businessName });
  const primaryContactName = f.text("primary_contact_name", { label: "Contact person", max: LIMITS.contactName });
  const phone = f.phone("phone");
  const email = f.email("email");
  const website = f.url("website");

  const abnText = f.text("abn", { label: "The ABN", max: 40 });
  let abn: string | null = null;
  if (abnText) {
    const problem = abnProblem(abnText);
    if (problem) f.errors.abn = problem;
    else abn = stripAbn(abnText);
  }

  const categories = f.manyOf("categories", categoryList);
  if (categories.length === 0 && !f.errors.categories) f.errors.categories = "Choose at least one trade.";

  const suburbs = parsePlaceList(f.text("service_suburbs", { max: 4000, label: "Suburbs" }), "suburb");
  if (suburbs.error) f.errors.service_suburbs = suburbs.error;
  const regions = parsePlaceList(f.text("service_regions", { max: 2000, label: "Regions" }), "region");
  if (regions.error) f.errors.service_regions = regions.error;

  const emergencyRaw = f.oneOf("emergency_available", ["yes", "no", "unknown"] as const, { fallback: "unknown" }) ?? "unknown";
  const emergencyAvailable = emergencyRaw === "yes" ? true : emergencyRaw === "no" ? false : null;

  const businessHours = f.text("business_hours", { label: "Business hours", max: LIMITS.hours });

  const money = (name: string): number | null => {
    const parsed = parseDollars(f.text(name, { max: 30, label: "The amount" }));
    if (!parsed.ok) {
      f.errors[name] = parsed.message;
      return null;
    }
    return parsed.cents;
  };
  const hourlyRateCents = money("hourly_rate");
  const calloutFeeCents = money("callout_fee");
  const afterHoursFeeCents = money("after_hours_fee");
  const minimumChargeCents = money("minimum_charge");

  const invoiceTerms = f.text("invoice_terms", { label: "Invoice terms", max: LIMITS.terms });
  const licenceDetails = f.text("licence_details", { label: "Licence details", max: LIMITS.details });
  const licenceExpiresOn = f.date("licence_expires_on");
  const insuranceDetails = f.text("insurance_details", { label: "Insurance details", max: LIMITS.details });
  const insuranceExpiresOn = f.date("insurance_expires_on");
  const ownerId = f.uuid("relationship_owner_id");
  const internalNotes = f.text("internal_notes", { label: "Internal notes", max: LIMITS.notes });
  const lastJobDate = f.date("last_job_date");

  return {
    id,
    version,
    businessName,
    primaryContactName,
    phone,
    email,
    website,
    abn,
    categories,
    serviceSuburbs: suburbs.items,
    serviceRegions: regions.items,
    emergencyAvailable,
    businessHours,
    hourlyRateCents,
    calloutFeeCents,
    afterHoursFeeCents,
    minimumChargeCents,
    invoiceTerms,
    licenceDetails,
    licenceExpiresOn,
    insuranceDetails,
    insuranceExpiresOn,
    ownerId: ownerId ? ownerId.toLowerCase() : null,
    internalNotes,
    lastJobDate,
  };
}
