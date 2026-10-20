/*
 * The portfolio (managed properties, the Ailo handover checklist, the business goal): vocabulary and
 * rules shared by the screens, the Server Actions and the MCP tools. They mirror what the database
 * enforces (migrations 0129, 0130): the database is the control, these give people the same answer
 * earlier and in plain words.
 *
 * Ailo is the system of record for rent, trust accounting, tenancies, maintenance, inspections and
 * owner communications. HQ holds only a light record, the handover checklist and the Ailo reference a
 * person types in. Nothing here talks to Ailo.
 *
 * Pure, with NO value imports on purpose (the unit tests run under Node's type stripping; see
 * lib/hq/decisions/rules.ts). The FormReader is passed in; only its type is imported.
 */
import type { FormReader } from "../forms";

// ── vocabulary (values MUST match the hq enums in 0129) ──────

export const SERVICE_TYPES = ["long_term_residential", "short_term_accommodation"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  long_term_residential: "Long-term residential",
  short_term_accommodation: "Short-term accommodation",
};
/** The chip on a row: short, still plain. */
export const SERVICE_TYPE_SHORT: Record<ServiceType, string> = {
  long_term_residential: "Long-term",
  short_term_accommodation: "Short-term accommodation",
};

export const FEE_BASES = ["percent_of_rent", "flat_fee", "other"] as const;
export type FeeBasis = (typeof FEE_BASES)[number];
export const FEE_BASIS_LABEL: Record<FeeBasis, string> = {
  percent_of_rent: "Percentage of rent",
  flat_fee: "Flat fee",
  other: "Other",
};

export const MANAGED_STATUSES = ["onboarding", "active", "offboarding", "ended"] as const;
export type ManagedStatus = (typeof MANAGED_STATUSES)[number];
export const MANAGED_STATUS_LABEL: Record<ManagedStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  offboarding: "Offboarding",
  ended: "Ended",
};
/** A new property starts as one of these. */
export const START_STATUSES = ["onboarding", "active"] as const satisfies readonly ManagedStatus[];

export function managedStatusTone(s: ManagedStatus): "neutral" | "info" | "success" | "warning" | "error" {
  switch (s) {
    case "onboarding":
      return "info";
    case "active":
      return "success";
    case "offboarding":
      return "warning";
    case "ended":
      return "neutral";
  }
}

export const AILO_STATUSES = ["not_started", "set_up", "live"] as const;
export type AiloStatus = (typeof AILO_STATUSES)[number];
export const AILO_STATUS_LABEL: Record<AiloStatus, string> = {
  not_started: "Not set up",
  set_up: "Set up",
  live: "Live",
};
export function ailoStatusTone(s: AiloStatus): "neutral" | "info" | "success" {
  return s === "live" ? "success" : s === "set_up" ? "info" : "neutral";
}

export const HANDOVER_STEPS = [
  "owner_onboarded",
  "management_agreement_signed",
  "owner_id_verified",
  "bank_and_payment_details_in_ailo",
  "property_created_in_ailo",
  "owner_invited_to_ailo",
  "condition_report_or_inspection_scheduled",
  "keys_and_access_arranged",
  "welcome_pack_sent",
] as const;
export type HandoverStep = (typeof HANDOVER_STEPS)[number];
export const HANDOVER_STEP_LABEL: Record<HandoverStep, string> = {
  owner_onboarded: "Owner onboarded",
  management_agreement_signed: "Management agreement signed",
  owner_id_verified: "Owner ID verified",
  bank_and_payment_details_in_ailo: "Bank and payment details in Ailo",
  property_created_in_ailo: "Property created in Ailo",
  owner_invited_to_ailo: "Owner invited to Ailo",
  condition_report_or_inspection_scheduled: "Condition report or inspection booked",
  keys_and_access_arranged: "Keys and access arranged",
  welcome_pack_sent: "Welcome pack sent",
};
export const HANDOVER_STEP_HINT: Record<HandoverStep, string> = {
  owner_onboarded: "The owner has met us and knows what happens next.",
  management_agreement_signed: "The signed agreement is filed.",
  owner_id_verified: "The owner's identity has been checked.",
  bank_and_payment_details_in_ailo: "Entered in Ailo by a person. HQ never stores bank details.",
  property_created_in_ailo: "The property exists in Ailo. Record its Ailo reference above.",
  owner_invited_to_ailo: "The owner has their Ailo invitation.",
  condition_report_or_inspection_scheduled: "The entry condition report or first inspection is booked.",
  keys_and_access_arranged: "Keys, codes and access are sorted.",
  welcome_pack_sent: "The owner has their welcome pack.",
};

export const HANDOVER_STEP_STATUSES = ["not_started", "in_progress", "done", "not_applicable"] as const;
export type HandoverStepStatus = (typeof HANDOVER_STEP_STATUSES)[number];
export const HANDOVER_STEP_STATUS_LABEL: Record<HandoverStepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Not applicable",
};
export const HANDOVER_STEP_STATUS_TONE: Record<HandoverStepStatus, "neutral" | "info" | "success"> = {
  not_started: "neutral",
  in_progress: "info",
  done: "success",
  not_applicable: "neutral",
};

export const ADDRESS_MAX = 300;
export const SUBURB_MAX = 120;
export const OWNER_NAME_MAX = 200;
export const FEE_NOTES_MAX = 500;
export const NOTES_MAX = 5000;
export const NOTE_MAX = 1000;
export const AILO_REFERENCE_MAX = 100;
export const GOAL_MAX = 10_000;
export const HANDOVER_TOTAL = HANDOVER_STEPS.length;
export const LIST_PAGE_SIZE = 25;

export const isServiceType = (v: unknown): v is ServiceType => typeof v === "string" && (SERVICE_TYPES as readonly string[]).includes(v);
export const isManagedStatus = (v: unknown): v is ManagedStatus => typeof v === "string" && (MANAGED_STATUSES as readonly string[]).includes(v);
export const isAiloStatus = (v: unknown): v is AiloStatus => typeof v === "string" && (AILO_STATUSES as readonly string[]).includes(v);
export const isHandoverStep = (v: unknown): v is HandoverStep => typeof v === "string" && (HANDOVER_STEPS as readonly string[]).includes(v);
export const isFeeBasis = (v: unknown): v is FeeBasis => typeof v === "string" && (FEE_BASES as readonly string[]).includes(v);

// ── refs: MP-0001 ────────────────────────────────────────────

/** "MP-0007"; never truncates a long number ("MP-123456"). */
export function managedRef(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  return `MP-${String(n).padStart(4, "0")}`;
}

/** The number in "MP-0007", "mp 7", "MP7"; null when it is not a ref. */
export function parseManagedRef(input: string | null | undefined): number | null {
  const m = /^\s*mp[-\s#]*0*(\d{1,9})\s*$/i.exec(input ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── fee ──────────────────────────────────────────────────────

/** "8.8% of rent", "Flat fee: $99 a month", "Not recorded". */
export function feeText(basis: FeeBasis | null, percent: number | string | null, notes: string | null): string {
  if (basis === "percent_of_rent" && percent !== null && percent !== "") {
    const p = Number(percent);
    const shown = Number.isFinite(p) ? String(Math.round(p * 100) / 100) : String(percent);
    return `${shown}% of rent${notes ? ` (${notes})` : ""}`;
  }
  if (basis) return `${FEE_BASIS_LABEL[basis]}${notes ? `: ${notes}` : ""}`;
  return notes ? notes : "Not recorded";
}

/** A percentage typed by a person ("8.8", "8.8%"): 0 to 100, at most two decimals. */
export function parsePercent(raw: string): { value: number | null; error: string | null } {
  const v = raw.replace(/[%\s]/g, "");
  if (!v) return { value: null, error: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return { value: null, error: "Enter a percentage like 8.8 (at most two decimals)." };
  const n = Number(v);
  if (n < 0 || n > 100) return { value: null, error: "A percentage is from 0 to 100." };
  return { value: n, error: null };
}

// ── the rules on a record (as hq_private.mp_check) ───────────

export type PropertyState = {
  status: ManagedStatus;
  managedFrom: string | null;
  endedOn: string | null;
  ailoStatus: AiloStatus;
  ailoReference: string | null;
  feeBasis: FeeBasis | null;
  feePercent: number | null;
  agreementSignedOn: string | null;
};

/** Field -> plain reason, for the rules the database also enforces. Empty when all is well. */
export function propertyProblems(p: PropertyState, today: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.status === "active" && !p.managedFrom) out.managed_from = "An active property needs the date management started.";
  if (p.status === "active" && p.managedFrom && p.managedFrom > today) out.managed_from = "Management starts in the future, so keep the property onboarding until then.";
  if (p.status === "ended" && !p.endedOn) out.ended_on = "An ended property needs the date management ended.";
  if (p.status !== "ended" && p.endedOn) out.ended_on = "An end date is only recorded when the property has ended.";
  if (p.endedOn && p.endedOn > today) out.ended_on = "The end date cannot be in the future.";
  if (p.endedOn && p.managedFrom && p.endedOn < p.managedFrom) out.ended_on = "The end date cannot be before management started.";
  if (p.ailoStatus === "live" && !p.ailoReference) out.ailo_reference = "Record the Ailo reference before marking the property live in Ailo.";
  if (p.feeBasis === "percent_of_rent" && p.feePercent === null) out.fee_percent = "Enter the percentage of rent.";
  if (p.feeBasis !== "percent_of_rent" && p.feePercent !== null) out.fee_percent = "A percentage is only for a fee charged as a percentage of rent.";
  if (p.agreementSignedOn && p.agreementSignedOn > today) out.agreement_signed_on = "The agreement date cannot be in the future.";
  return out;
}

// ── the form ─────────────────────────────────────────────────

export const PROPERTY_FORM_LABELS: Record<string, string> = {
  property_address: "Property address",
  suburb: "Suburb",
  owner_contact_id: "Owner (contact)",
  owner_name: "Owner name",
  service_type: "Service",
  fee_basis: "Fee basis",
  fee_percent: "Percentage of rent",
  fee_notes: "Fee notes",
  agreement_signed_on: "Agreement signed",
  managed_from: "Managed from",
  status: "Status",
  ended_on: "Ended on",
  ailo_reference: "Ailo reference",
  ailo_status: "Ailo status",
  notes: "Notes",
  manual_origin_note: "Where this property came from",
  opportunity_id: "Signed opportunity",
  note: "Note",
};

export type PropertyFormValues = {
  propertyAddress: string | null;
  suburb: string | null;
  ownerContactId: string | null;
  ownerName: string | null;
  serviceType: ServiceType | null;
  feeBasis: FeeBasis | null;
  feePercent: number | null;
  feeNotes: string | null;
  agreementSignedOn: string | null;
  managedFrom: string | null;
  status: ManagedStatus | null;
  endedOn: string | null;
  ailoReference: string | null;
  ailoStatus: AiloStatus | null;
  notes: string | null;
  manualOriginNote: string | null;
  note: string | null;
};

/**
 * Reads the property form. Modes: "convert" (from a signed opportunity: the address and owner may be
 * left blank, the opportunity supplies them), "manual" (signed before HQ: address, owner and the
 * origin note are required) and "edit" (every field as it should be after the save).
 */
export function readPropertyFields(reader: FormReader, today: string, mode: "convert" | "manual" | "edit"): PropertyFormValues {
  const blankOk = mode === "convert";
  const propertyAddress = blankOk ? reader.text("property_address", { max: ADDRESS_MAX, label: "The address" }) : reader.requiredText("property_address", { max: ADDRESS_MAX, label: "The address" }) || null;
  const suburb = reader.text("suburb", { max: SUBURB_MAX, label: "The suburb" });
  const ownerContactRaw = reader.uuid("owner_contact_id");
  const ownerContactId = ownerContactRaw ? ownerContactRaw.toLowerCase() : null;
  const ownerName = reader.text("owner_name", { max: OWNER_NAME_MAX, label: "The owner's name" });
  if (!blankOk && !ownerContactId && !ownerName && !reader.errors.owner_name) reader.errors.owner_name = "Say who the owner is: choose a contact or type their name.";
  const serviceType = reader.oneOf("service_type", SERVICE_TYPES, { required: true });
  const feeBasis = reader.oneOf("fee_basis", FEE_BASES);
  const pct = parsePercent(reader.text("fee_percent", { max: 12, label: "The percentage" }) ?? "");
  if (pct.error) reader.errors.fee_percent = pct.error;
  // A percentage only means something for a percent-of-rent fee; another basis drops it.
  const feePercent = feeBasis && feeBasis !== "percent_of_rent" ? null : pct.value;
  const effectiveBasis = feeBasis ?? (feePercent !== null ? "percent_of_rent" : null);
  const feeNotes = reader.text("fee_notes", { max: FEE_NOTES_MAX, label: "Fee notes" });
  const agreementSignedOn = reader.date("agreement_signed_on");
  const managedFrom = reader.date("managed_from");
  const status = mode === "edit" ? reader.oneOf("status", MANAGED_STATUSES, { required: true }) : reader.oneOf("status", START_STATUSES, { fallback: "onboarding" });
  const endedOn = reader.date("ended_on");
  const ailoReference = reader.text("ailo_reference", { max: AILO_REFERENCE_MAX, label: "The Ailo reference" });
  const ailoStatus = mode === "convert" ? "not_started" : reader.oneOf("ailo_status", AILO_STATUSES, { fallback: "not_started" });
  const notes = reader.text("notes", { max: NOTES_MAX, label: "Notes" });
  const manualOriginNote = mode === "manual" ? reader.requiredText("manual_origin_note", { max: NOTE_MAX, label: "A note saying where it came from" }) || null : null;
  const note = reader.text("note", { max: NOTE_MAX, label: "The note" });

  if (status) {
    const problems = propertyProblems(
      { status, managedFrom, endedOn, ailoStatus: ailoStatus ?? "not_started", ailoReference, feeBasis: effectiveBasis, feePercent, agreementSignedOn },
      today,
    );
    for (const [k, v] of Object.entries(problems)) if (!reader.errors[k]) reader.errors[k] = v;
  }
  return {
    propertyAddress,
    suburb,
    ownerContactId,
    ownerName,
    serviceType,
    feeBasis: effectiveBasis,
    feePercent,
    feeNotes,
    agreementSignedOn,
    managedFrom,
    status,
    endedOn,
    ailoReference,
    ailoStatus,
    notes,
    manualOriginNote,
    note,
  };
}

// ── the list's URL ───────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

export type PortfolioListQuery = {
  q: string;
  status: ManagedStatus | null;
  service: ServiceType | null;
  ailo: AiloStatus | null;
  /** Only properties whose handover is still open. */
  handoverOpen: boolean;
  page: number;
  filtered: boolean;
  moreActive: boolean;
};

export function parsePortfolioListQuery(sp: Params): PortfolioListQuery {
  const q = first(sp.q).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 100);
  const status = isManagedStatus(first(sp.status)) ? (first(sp.status) as ManagedStatus) : null;
  const service = isServiceType(first(sp.service)) ? (first(sp.service) as ServiceType) : null;
  const ailo = isAiloStatus(first(sp.ailo)) ? (first(sp.ailo) as AiloStatus) : null;
  const handoverOpen = first(sp.handover) === "open";
  const pageN = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageN) ? Math.min(10_000, Math.max(1, pageN)) : 1;
  const moreActive = !!(status || service || ailo || handoverOpen);
  return { q, status, service, ailo, handoverOpen, page, filtered: moreActive || q !== "", moreActive };
}

/** Search words made safe for a PostgREST `or=(...ilike...)` filter: wildcards and filter punctuation out. */
export function searchWords(q: string): string {
  return q.replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

// ── the business summary (hq.business_summary) ───────────────

export type ServiceSplit = { managed: number; active: number; onboarding: number };

export type BusinessSummary = {
  asOf: string;
  goal: { target: number; date: string | null };
  managed: {
    managed: number;
    active: number;
    onboarding: number;
    offboarding: number;
    ended: number;
    longTerm: ServiceSplit;
    shortTerm: ServiceSplit;
    handoverOpen: number;
    recorded: number;
  } | null;
  signed: { thisMonth: number; last30Days: number; financialYear: number; financialYearStart: string } | null;
  pipeline: { open: number; byStage: Record<string, number>; estimatedYearlyValueCents: number; withEstimate: number; withoutEstimate: number } | null;
  leadsNeedingAttention: number | null;
  pace: { remaining: number; monthsLeft: number; neededPerMonth: number | null; actualPerMonth: number; goalDatePassed: boolean; targetReached: boolean } | null;
  notes: string[];
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const split = (v: unknown): ServiceSplit => {
  const o = obj(v) ?? {};
  return { managed: num(o.managed), active: num(o.active), onboarding: num(o.onboarding) };
};

/** The jsonb from hq.business_summary(), checked into a typed shape; null when it is not that shape. */
export function parseBusinessSummary(raw: unknown): BusinessSummary | null {
  const r = obj(raw);
  if (!r || typeof r.as_of !== "string") return null;
  const g = obj(r.goal) ?? {};
  const m = obj(r.managed);
  const s = obj(r.signed);
  const p = obj(r.pipeline);
  const l = obj(r.leads_needing_attention);
  const pc = obj(r.pace);
  const byStage: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(p?.by_stage) ?? {})) byStage[k] = num(v);
  return {
    asOf: r.as_of,
    goal: { target: num(g.target_managed) || 20, date: typeof g.goal_date === "string" ? g.goal_date : null },
    managed: m
      ? {
          managed: num(m.managed),
          active: num(m.active),
          onboarding: num(m.onboarding),
          offboarding: num(m.offboarding),
          ended: num(m.ended),
          longTerm: split(m.long_term_residential),
          shortTerm: split(m.short_term_accommodation),
          handoverOpen: num(m.handover_open),
          recorded: num(m.recorded),
        }
      : null,
    signed: s ? { thisMonth: num(s.this_month), last30Days: num(s.last_30_days), financialYear: num(s.financial_year), financialYearStart: String(s.financial_year_start ?? "") } : null,
    pipeline: p
      ? { open: num(p.open), byStage, estimatedYearlyValueCents: num(p.estimated_yearly_value_cents), withEstimate: num(p.with_estimate), withoutEstimate: num(p.without_estimate) }
      : null,
    leadsNeedingAttention: l ? num(l.count) : null,
    pace: pc
      ? {
          remaining: num(pc.remaining),
          monthsLeft: num(pc.months_left),
          neededPerMonth: pc.needed_per_month === null || pc.needed_per_month === undefined ? null : num(pc.needed_per_month),
          actualPerMonth: num(pc.actual_per_month),
          goalDatePassed: pc.goal_date_passed === true,
          targetReached: pc.target_reached === true,
        }
      : null,
    notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string") : [],
  };
}

/** "Managed 3 of 20". */
export function managedOfGoalText(managed: number, target: number): string {
  return `Managed ${managed} of ${target}`;
}

/** "2 long-term, 1 short-term accommodation" (only the non-zero parts; "none yet" when both are zero). */
export function serviceSplitText(longTerm: number, shortTerm: number): string {
  const parts = [longTerm > 0 ? `${longTerm} long-term` : null, shortTerm > 0 ? `${shortTerm} short-term accommodation` : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "none yet";
}

const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toString();

/** The pace line, or null when there is no goal date (none is ever invented). */
export function paceText(pace: BusinessSummary["pace"]): string | null {
  if (!pace) return null;
  if (pace.targetReached) return "Goal reached.";
  if (pace.goalDatePassed || pace.neededPerMonth === null) return `The goal date has passed with ${pace.remaining} still to go.`;
  return `Needs ${oneDecimal(pace.neededPerMonth)} a month for ${oneDecimal(pace.monthsLeft)} months; signing ${oneDecimal(pace.actualPerMonth)} a month lately.`;
}

/** "1 Jul" style start of the Australian financial year is shown by the caller; this names the year: "2026-27". */
export function financialYearLabel(start: string): string {
  const y = Number(start.slice(0, 4));
  if (!Number.isFinite(y) || y < 1990) return "this financial year";
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
