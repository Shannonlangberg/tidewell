/*
 * Leads (opportunities that need not come from a referral partner): the vocabulary, the add-a-lead
 * and next-step form fields, what a database refusal means, and the small date rules the screens,
 * Today and the MCP tools share. The database (migration 0127) is the arbiter of every rule here;
 * this module gives a person a clear, field-level message instead of a failed save.
 *
 * Pure with NO value imports (Node's type-stripping test runner, see lib/hq/tasks/rules.ts): the
 * FormReader is passed in. The enum lists are written out and pinned to the database types and to
 * lib/hq/mcp/tools/schemas.ts by rules.test.mts.
 */
import type { FormReader } from "../forms";

// ── vocabulary ───────────────────────────────────────────────

export const LEAD_SOURCES = ["website_enquiry", "referral_partner", "own_marketing", "direct_approach", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  website_enquiry: "Website enquiry",
  referral_partner: "Referral partner",
  own_marketing: "Our own marketing",
  direct_approach: "Direct approach",
  other: "Other",
};
/** A lead added by hand: a referral partner's introduction is recorded as a referral instead. */
export const DIRECT_LEAD_SOURCES: readonly LeadSource[] = ["own_marketing", "website_enquiry", "direct_approach", "other"];

export const LOST_REASONS = ["price", "chose_another_manager", "self_managing", "not_ready", "unresponsive", "out_of_area", "other"] as const;
export type LostReason = (typeof LOST_REASONS)[number];
export const LOST_REASON_LABEL: Record<LostReason, string> = {
  price: "Price or fees",
  chose_another_manager: "Chose another manager",
  self_managing: "Managing it themselves",
  not_ready: "Not ready yet",
  unresponsive: "Stopped responding",
  out_of_area: "Outside our area",
  other: "Other",
};

export const CONTACT_KINDS = ["partner", "landlord", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_KIND_LABEL: Record<ContactKind, string> = { partner: "Partner", landlord: "Landlord", other: "Other" };

/** The contacts list filter: one kind, or everyone. Partner is the default, so the partner CRM stays clean. */
export const CONTACT_KIND_FILTERS = ["partner", "landlord", "other", "all"] as const;
export type ContactKindFilter = (typeof CONTACT_KIND_FILTERS)[number];
export function parseContactKindFilter(value: string | string[] | undefined): ContactKindFilter {
  const v = (Array.isArray(value) ? value[0] : value) ?? "";
  return (CONTACT_KIND_FILTERS as readonly string[]).includes(v) ? (v as ContactKindFilter) : "partner";
}

const OPEN_STAGES_EXCLUDED = ["management_signed", "lost"];
export function isOpenStage(stage: string): boolean {
  return !OPEN_STAGES_EXCLUDED.includes(stage);
}

export function isLeadSource(v: unknown): v is LeadSource {
  return typeof v === "string" && (LEAD_SOURCES as readonly string[]).includes(v);
}
export function isLostReason(v: unknown): v is LostReason {
  return typeof v === "string" && (LOST_REASONS as readonly string[]).includes(v);
}

/** LEAD-0007, the reference opportunity_overview gives a lead. */
export function leadRef(n: number): string {
  const s = String(Math.max(0, Math.trunc(n)));
  return `LEAD-${s.padStart(4, "0")}`;
}

/** "Jane Citizen" -> "JC"; one word -> its first two letters. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ── dates ────────────────────────────────────────────────────

/** The furthest ahead a follow-up date may be (the database's rule). */
export const FOLLOW_UP_MAX_DAYS = 730;
/** The furthest ahead an expected close date may be. */
export const CLOSE_MAX_DAYS = 1095;

/** YYYY-MM-DD plus n days. */
export function addDaysIso(date: string, n: number): string {
  const t = Date.parse(`${date.slice(0, 10)}T12:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from today to date (negative = past). */
export function daysFrom(today: string, date: string): number {
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export type DueState = "overdue" | "today" | "soon" | "later";

/** Where a follow-up date stands: overdue (before today), today, soon (the next 7 days), later. */
export function dueState(due: string, today: string): DueState {
  const d = daysFrom(today, due);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "soon";
  return "later";
}

/** "Due today", "Due tomorrow", "2 days overdue", "Due in 5 days", or null for a later date (the date itself says it). */
export function dueText(due: string, today: string): string | null {
  const d = daysFrom(today, due);
  if (d < 0) return d === -1 ? "1 day overdue" : `${-d} days overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d <= 7) return `Due in ${d} days`;
  return null;
}

/** Why an open lead needs attention, in plain words, or null when it does not. */
export function attentionText(lead: { assignedTo: string | null; nextAction: string | null; nextActionDue: string | null; open: boolean }, today: string): string | null {
  if (!lead.open) return null;
  if (!lead.assignedTo) return "No owner";
  if (!lead.nextAction || !lead.nextActionDue) return "No next step";
  if (lead.nextActionDue < today) return "Follow-up overdue";
  return null;
}

// ── the add-a-lead form ──────────────────────────────────────

export const LEAD_FORM_LABELS: Record<string, string> = {
  prospect_name: "Name",
  prospect_phone: "Phone",
  prospect_email: "Email",
  property_suburb: "Suburb",
  property_address: "Address",
  source: "Where the lead came from",
  assigned_to: "Owner",
  next_action: "Next action",
  next_action_due: "Follow-up date",
  expected_close_date: "Expected to sign by",
  estimated_value: "Estimated yearly value",
  notes: "Notes",
};

export type LeadFormValues = {
  prospectName: string;
  prospectPhone: string | null;
  prospectEmail: string | null;
  propertySuburb: string | null;
  propertyAddress: string | null;
  source: LeadSource | null;
  assignedTo: string | null;
  nextAction: string;
  nextActionDue: string | null;
  expectedCloseDate: string | null;
  estimateCents: number | null;
  notes: string | null;
  confirmDistinct: boolean;
};

/** A follow-up date: required, today to two years ahead. */
export function checkFollowUp(f: FormReader, name: string, today: string, required: boolean): string | null {
  const v = f.date(name, { required });
  if (!v || f.errors[name]) {
    if (required && !v && !f.errors[name]) f.errors[name] = "Choose the follow-up date.";
    return null;
  }
  const d = daysFrom(today, v);
  if (d < 0) f.errors[name] = "Choose today or a later date.";
  else if (d > FOLLOW_UP_MAX_DAYS) f.errors[name] = "Choose a date within the next two years.";
  return f.errors[name] ? null : v;
}

/** An expected close date: optional, today to three years ahead. */
export function checkExpectedClose(f: FormReader, name: string, today: string): string | null {
  const v = f.date(name);
  if (!v || f.errors[name]) return null;
  const d = daysFrom(today, v);
  if (d < 0) f.errors[name] = "Choose today or a later date.";
  else if (d > CLOSE_MAX_DAYS) f.errors[name] = "Choose a date within the next three years.";
  return f.errors[name] ? null : v;
}

/**
 * Reads the add-a-lead form. The owner defaults to the caller when the field is left empty (the
 * database does the same). Field errors collect on `f.errors`.
 */
export function readLeadFields(f: FormReader, ctx: { today: string; staffId: string }): LeadFormValues {
  const prospectName = f.requiredText("prospect_name", { max: 200, label: "The name" });
  const prospectPhone = f.phone("prospect_phone");
  const prospectEmail = f.email("prospect_email");
  const propertySuburb = f.text("property_suburb", { max: 120, label: "The suburb" });
  const propertyAddress = f.text("property_address", { max: 300, label: "The address" });
  const source = f.oneOf("source", DIRECT_LEAD_SOURCES, { required: true });
  if (f.errors.source && (f.errors.source === "Choose one of the options." || f.errors.source === "Choose an option.")) {
    f.errors.source = "Choose where the lead came from. A referral partner's introduction is recorded as a referral.";
  }
  const assigned = f.uuid("assigned_to");
  const nextAction = f.requiredText("next_action", { max: 300, label: "The next action" });
  const nextActionDue = checkFollowUp(f, "next_action_due", ctx.today, true);
  const expectedCloseDate = checkExpectedClose(f, "expected_close_date", ctx.today);
  const estimateCents = f.dollarsToCents("estimated_value");
  const notes = f.text("notes", { max: 2000, label: "Notes" });
  const confirmDistinct = f.bool("confirm_distinct");
  return {
    prospectName,
    prospectPhone,
    prospectEmail,
    propertySuburb,
    propertyAddress,
    source,
    assignedTo: assigned ? assigned.toLowerCase() : ctx.staffId,
    nextAction,
    nextActionDue,
    expectedCloseDate,
    estimateCents,
    notes,
    confirmDistinct,
  };
}

// ── what a refusal from the database means ───────────────────

export type LeadDbError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined;

export type LeadErrorKind =
  | "permission"
  | "not_found"
  | "contact_not_found"
  | "duplicate"
  | "use_referral"
  | "source_is_referral"
  | "owner_inactive"
  | "task_assignee_inactive"
  | "name_required"
  | "source_required"
  | "next_action_required"
  | "follow_up_required"
  | "follow_up_range"
  | "close_range"
  | "value_range"
  | "bad_phone"
  | "bad_email"
  | "too_long"
  | "stale"
  | "lead_rule"
  | "lost_code_required"
  | "lost_reason_required"
  | "leave_signed_forbidden"
  | "future"
  | "summary_required"
  | "type_required"
  | "other";

export function classifyLeadError(error: LeadDbError): LeadErrorKind {
  const code = error?.code ?? "";
  const hint = error?.hint ?? "";
  const m = (error?.message ?? "").toLowerCase();
  const has = (...n: string[]) => n.some((x) => m.includes(x));
  if (code === "42501") return has("out of management_signed") ? "leave_signed_forbidden" : "permission";
  if (code === "P0002" || code === "PGRST116") return has("contact not found") ? "contact_not_found" : "not_found";
  if (code === "23505") return hint === "possible_duplicate" ? "duplicate" : "other";
  if (code === "23514") {
    if (hint === "lead_stale") return "stale";
    if (hint === "lead_needs_next_step") return "lead_rule";
    return "other";
  }
  if (code === "22023") {
    if (hint === "use_record_referral") return "use_referral";
    if (hint === "source_is_referral") return "source_is_referral";
    if (hint === "lost_reason_code_required") return "lost_code_required";
    if (has("lead owner must be an active")) return "owner_inactive";
    if (has("task assignee must be an active")) return "task_assignee_inactive";
    if (has("needs the person's name")) return "name_required";
    if (has("say where the lead came from")) return "source_required";
    if (has("needs a next action")) return "next_action_required";
    if (has("needs a follow-up date")) return "follow_up_required";
    if (has("follow-up date must be")) return "follow_up_range";
    if (has("expected close date must be")) return "close_range";
    if (has("estimated yearly value")) return "value_range";
    if (has("phone number")) return "bad_phone";
    if (has("email address")) return "bad_email";
    if (has("is at most")) return "too_long";
    if (has("lost opportunity needs a reason")) return "lost_reason_required";
    if (has("in the future")) return "future";
    if (has("summary is required")) return "summary_required";
    if (has("interaction type is required")) return "type_required";
    return "other";
  }
  return "other";
}

/** The field a refusal belongs to on the add-a-lead / edit forms, with the words to show. */
export function leadFieldError(kind: LeadErrorKind): { field: string; message: string } | null {
  switch (kind) {
    case "use_referral":
      return { field: "source", message: "A referral partner's introduction is recorded as a referral, so the partner is credited." };
    case "source_is_referral":
      return { field: "source", message: "This lead came from a referral partner, so its source stays Referral partner." };
    case "owner_inactive":
      return { field: "assigned_to", message: "Choose an active member of staff." };
    case "name_required":
      return { field: "prospect_name", message: "The name is required." };
    case "source_required":
      return { field: "source", message: "Choose where the lead came from." };
    case "next_action_required":
      return { field: "next_action", message: "Say what happens next." };
    case "follow_up_required":
      return { field: "next_action_due", message: "Choose the follow-up date." };
    case "follow_up_range":
      return { field: "next_action_due", message: "Choose today or a date within the next two years." };
    case "close_range":
      return { field: "expected_close_date", message: "Choose today or a date within the next three years." };
    case "value_range":
      return { field: "estimated_value", message: "That amount isn't allowed." };
    case "bad_phone":
      return { field: "prospect_phone", message: "That doesn't look like a phone number." };
    case "bad_email":
      return { field: "prospect_email", message: "That doesn't look like an email address." };
    case "lead_rule":
      return { field: "next_action", message: "An open lead needs an owner, a next action and a follow-up date." };
    default:
      return null;
  }
}

/** The existing record a duplicate refusal points at: details "opportunity:<uuid>:email". */
export function parseDuplicate(details: string | null | undefined): { kind: "opportunity" | "contact"; id: string; reason: "email" | "phone" | "name_suburb" } | null {
  const m = /^(opportunity|contact):([0-9a-f-]{36}):(email|phone|name_suburb)$/i.exec((details ?? "").trim());
  if (!m) return null;
  return { kind: m[1].toLowerCase() as "opportunity" | "contact", id: m[2].toLowerCase(), reason: m[3].toLowerCase() as "email" | "phone" | "name_suburb" };
}

export function duplicateReasonText(reason: "email" | "phone" | "name_suburb"): string {
  return reason === "email" ? "the same email address" : reason === "phone" ? "the same phone number" : "the same name in the same suburb";
}
