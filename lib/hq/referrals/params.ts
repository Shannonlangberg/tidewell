/*
 * Reading the URL for the referral register, the pipeline and the partner performance table.
 *
 * Every value that arrives in the address bar is checked against an allowlist (the sortable
 * columns, the enum values, a uuid shape, a real calendar date) before it can reach a query,
 * so nothing the URL carries is trusted. Search text is reduced to the characters that appear
 * in names, so it cannot add a condition to PostgREST's `or=` filter.
 *
 * Pure and dependency-free (no value imports), so `node --test` can run it.
 */

export type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const REFERRALS_PAGE_SIZE = 25;
export const PARTNERS_PAGE_SIZE = 25;

const DIRECTIONS = ["received", "sent"] as const;
export type Direction = (typeof DIRECTIONS)[number];

const STAGES = [
  "introduction_received",
  "contacted",
  "qualified",
  "appraisal_requested",
  "appraisal_completed",
  "proposal_sent",
  "management_signed",
  "lost",
] as const;
export type StageValue = (typeof STAGES)[number];

// ── primitives ───────────────────────────────────────────────

export function first(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : "";
}

/** A uuid (lower-cased) or null. */
export function parseUuid(value: string): string | null {
  const v = value.trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

/** A real calendar date (YYYY-MM-DD) or null. */
export function parseCalendarDate(value: string): string | null {
  const v = value.trim();
  if (!ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** A whole number within [min, max], or `fallback`. Rejects "2abc" and "1e3". */
export function boundedInt(value: string, fallback: number, min: number, max: number): number {
  if (!/^\d{1,9}$/.test(value.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export const SEARCH_MAX_LENGTH = 100;
/** Letters (any script), digits, space and the punctuation names and references contain: @ . ' ’ & + - */
const DISALLOWED = /[^\p{L}\p{N} @.'’&+-]/gu;

/** The cleaned search text: allowed characters only, whitespace collapsed, bounded. "" when nothing is left. */
export function cleanSearch(raw: string | null | undefined, max: number = SEARCH_MAX_LENGTH): string {
  if (typeof raw !== "string") return "";
  return raw.replace(DISALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** A PostgREST `or` filter matching `term` anywhere in any of `columns`. `columns` are fixed names, never input. */
export function orIlike(columns: readonly string[], term: string): string | null {
  const t = cleanSearch(term);
  if (!t) return null;
  return columns.map((c) => `${c}.ilike."*${t}*"`).join(",");
}

/** "REF-0017", "ref17" or "17" -> 17. Anything else -> null. */
export function refNumberFromSearch(term: string): number | null {
  const m = /^(?:ref[\s-]*)?0*(\d{1,9})$/i.exec(term.trim());
  return m ? Number(m[1]) : null;
}

export type SortDir = "asc" | "desc";

/**
 * A sort key and direction from the URL. An unknown key falls back to `fallback`; a missing or
 * unknown direction falls back to that key's own default (dates newest first, names A to Z).
 */
export function parseSort<K extends string>(
  sortValue: string,
  dirValue: string,
  keys: readonly K[],
  fallback: K,
  defaultDir: Readonly<Partial<Record<string, SortDir>>> = {},
): { sort: K; dir: SortDir } {
  const known = (keys as readonly string[]).includes(sortValue);
  const sort = known ? (sortValue as K) : fallback;
  const own: SortDir = defaultDir[sort] ?? "asc";
  if (!known) return { sort, dir: defaultDir[fallback] ?? "asc" };
  return { sort, dir: dirValue === "asc" || dirValue === "desc" ? dirValue : own };
}

/** The first and last row index (0-based, inclusive) of a page, for `.range()`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export type AssignedFilter = { kind: "me" } | { kind: "none" } | { kind: "staff"; id: string };

export function parseAssigned(value: string): AssignedFilter | null {
  const v = value.trim();
  if (v === "me") return { kind: "me" };
  if (v === "none") return { kind: "none" };
  const id = parseUuid(v);
  return id ? { kind: "staff", id } : null;
}

function oneOf<T extends string>(value: string, list: readonly T[]): T | null {
  return (list as readonly string[]).includes(value) ? (value as T) : null;
}

// ── the referral register ────────────────────────────────────

/** URL sort key -> column in hq.referral_overview. The ONLY columns the register can be sorted by. */
export const REFERRAL_SORT_COLUMNS = {
  ref: "ref_number",
  date: "referral_date",
  prospect: "prospect_name",
  partner: "partner_organisation_name",
  stage: "stage",
  value: "estimated_annual_value_cents",
  signed: "signed_at",
  assigned: "assigned_to_name",
} as const;
export type ReferralSortKey = keyof typeof REFERRAL_SORT_COLUMNS;
export const REFERRAL_SORT_KEYS = Object.keys(REFERRAL_SORT_COLUMNS) as ReferralSortKey[];
const REFERRAL_DEFAULT_DIR: Partial<Record<ReferralSortKey, SortDir>> = { ref: "desc", date: "desc", value: "desc", signed: "desc" };

export type ReferralListQuery = {
  q: string;
  direction: Direction | null;
  stage: StageValue | null;
  /** A partner organisation id. */
  partner: string | null;
  assigned: AssignedFilter | null;
  signedOnly: boolean;
  from: string | null;
  to: string | null;
  sort: ReferralSortKey;
  dir: SortDir;
  page: number;
  /** Whether any search or filter is applied (sorting and paging do not count). */
  filtered: boolean;
};

export function parseReferralListParams(sp: RawParams): ReferralListQuery {
  const q = cleanSearch(first(sp.q));
  const direction = oneOf(first(sp.direction), DIRECTIONS);
  const stage = oneOf(first(sp.stage), STAGES);
  const partner = parseUuid(first(sp.partner));
  const assigned = parseAssigned(first(sp.assigned));
  const signedOnly = first(sp.signed) === "1";
  let from = parseCalendarDate(first(sp.from));
  let to = parseCalendarDate(first(sp.to));
  if (from && to && from > to) [from, to] = [to, from];
  const { sort, dir } = parseSort(first(sp.sort), first(sp.dir), REFERRAL_SORT_KEYS, "date", REFERRAL_DEFAULT_DIR);
  const page = boundedInt(first(sp.page), 1, 1, 100_000);
  return {
    q,
    direction,
    stage,
    partner,
    assigned,
    signedOnly,
    from,
    to,
    sort,
    dir,
    page,
    filtered: Boolean(q || direction || stage || partner || assigned || signedOnly || from || to),
  };
}

// ── the pipeline ─────────────────────────────────────────────

export type PipelineQuery = {
  assigned: AssignedFilter | null;
  partner: string | null;
  hideLost: boolean;
  /** Where the lead came from (hq.lead_source). */
  source: LeadSourceValue | null;
  /** Only open leads that need attention: no owner, no next step, or the follow-up date has passed. */
  attention: boolean;
  /** The column a phone shows (the board is one column at a time there). */
  stage: StageValue;
  filtered: boolean;
};

/** hq.lead_source, written out (lib/hq/leads/rules.ts LEAD_SOURCES; a test pins them together). */
export const PIPELINE_SOURCES = ["website_enquiry", "referral_partner", "own_marketing", "direct_approach", "other"] as const;
export type LeadSourceValue = (typeof PIPELINE_SOURCES)[number];

export function parsePipelineParams(sp: RawParams): PipelineQuery {
  const assigned = parseAssigned(first(sp.assigned));
  const partner = parseUuid(first(sp.partner));
  const hideLost = first(sp.hide_lost) === "1";
  const source = oneOf(first(sp.source), PIPELINE_SOURCES);
  const attention = first(sp.attention) === "1";
  const stage = oneOf(first(sp.stage), STAGES) ?? "introduction_received";
  return { assigned, partner, hideLost, source, attention, stage, filtered: Boolean(assigned || partner || hideLost || source || attention) };
}

// ── partner performance ──────────────────────────────────────

/** URL sort key -> column in hq.partner_performance. */
export const PARTNER_SORT_COLUMNS = {
  name: "organisation_name",
  received: "received",
  sent: "sent",
  qualified: "qualified",
  signed: "signed",
  conversion: "conversion",
  value: "estimated_value_signed_cents",
} as const;
export type PartnerSortKey = keyof typeof PARTNER_SORT_COLUMNS;
export const PARTNER_SORT_KEYS = Object.keys(PARTNER_SORT_COLUMNS) as PartnerSortKey[];
const PARTNER_DEFAULT_DIR: Partial<Record<PartnerSortKey, SortDir>> = {
  received: "desc",
  sent: "desc",
  qualified: "desc",
  signed: "desc",
  conversion: "desc",
  value: "desc",
};

export type PartnerQuery = {
  /** A partner category, checked against `categories` passed in by the caller. */
  category: string | null;
  /** Include partners with no referrals in either direction. */
  showAll: boolean;
  sort: PartnerSortKey;
  dir: SortDir;
  page: number;
  filtered: boolean;
};

export function parsePartnerParams(sp: RawParams, categories: readonly string[]): PartnerQuery {
  const category = oneOf(first(sp.category), categories);
  const showAll = first(sp.show) === "all";
  const { sort, dir } = parseSort(first(sp.sort), first(sp.dir), PARTNER_SORT_KEYS, "received", PARTNER_DEFAULT_DIR);
  const page = boundedInt(first(sp.page), 1, 1, 100_000);
  return { category, showAll, sort, dir, page, filtered: Boolean(category) };
}

// ── the "record a referral" form's starting values ───────────

export type NewReferralPrefill = {
  direction: Direction;
  partnerContact: string | null;
  partnerOrganisation: string | null;
  /** An opportunity that is already in the pipeline, to attach a further introduction to. */
  existingOpportunity: string | null;
};

export function parseNewReferralParams(sp: RawParams): NewReferralPrefill {
  return {
    direction: oneOf(first(sp.direction), DIRECTIONS) ?? "received",
    partnerContact: parseUuid(first(sp.partner_contact)),
    partnerOrganisation: parseUuid(first(sp.partner_organisation)),
    existingOpportunity: parseUuid(first(sp.existing)),
  };
}
