/*
 * The contractor directory is driven entirely by the URL: search, filters, chips, sort and page.
 * This turns the raw `searchParams` into a validated query. Every value is checked against an
 * allowlist (the enum lists are passed in by the caller, the sortable columns are fixed here), so
 * nothing the address bar carries reaches the database unchecked.
 *
 * Pure and import-free (so `node --test` runs it): the few helpers it needs are written out below
 * and pinned to their originals by params.test.mts.
 *
 * The example from the brief, "approved plumbers who service Moonta":
 *   /hq/partners?status=cleared&trade=plumbing&suburb=Moonta
 */

export type RawParams = Record<string, string | string[] | undefined>;

export const DIRECTORY_PAGE_SIZE = 25;
export const SEARCH_MAX_LENGTH = 100;

/** URL sort key -> column in hq.contractor_directory. The ONLY columns a person can sort by. */
export const DIRECTORY_SORT_COLUMNS = {
  name: "business_name",
  status: "status",
  vetting: "vetting_done_count",
  insurance: "insurance_expires_on",
  licence: "licence_expires_on",
  owner: "relationship_owner_name",
  rating: "rating",
  contacted: "last_contacted_at",
} as const;
export type DirectorySortKey = keyof typeof DIRECTORY_SORT_COLUMNS;
export const DIRECTORY_SORT_KEYS = Object.keys(DIRECTORY_SORT_COLUMNS) as DirectorySortKey[];

/** "cleared" is the brief's "approved": approved or preferred, i.e. someone who can be sent to a property. */
export const STATUS_FILTER_CLEARED = "cleared";

export type DirectoryChip = "awaiting" | "expiring" | "preferred";
export const DIRECTORY_CHIPS: readonly DirectoryChip[] = ["awaiting", "expiring", "preferred"];

export type EmergencyFilter = "yes" | "no" | "unknown";

export type DirectoryVocab = {
  categories: readonly string[];
  statuses: readonly string[];
  expiryStates: readonly string[];
};

export type DirectoryQuery = {
  q: string;
  /** A contractor_category value. */
  trade: string | null;
  /** The suburb as typed (cleaned); the database compares its lower-case `service_suburb_keys`. */
  suburb: string | null;
  region: string | null;
  /** A contractor_status value, or "cleared". */
  status: string | null;
  emergency: EmergencyFilter | null;
  insurance: string | null;
  licence: string | null;
  chip: DirectoryChip | null;
  sort: DirectorySortKey;
  dir: "asc" | "desc";
  page: number;
  /** Whether any search, filter or chip is applied (sorting and paging do not count). */
  filtered: boolean;
};

// ── small helpers (twins of lib/hq/growth/params.ts) ─────────

export function first(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : "";
}

export function boundedInt(value: string, fallback: number, min: number, max: number): number {
  if (!/^\d{1,9}$/.test(value.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function oneOf(value: string, list: readonly string[]): string | null {
  return list.includes(value) ? value : null;
}

/** Letters (any script), digits, space and the punctuation names and emails contain: @ . ' ’ & + - */
const DISALLOWED = /[^\p{L}\p{N} @.'’&+-]/gu;

/** The cleaned search term: allowed characters only, whitespace collapsed, bounded. "" when nothing is left. */
export function searchTerm(raw: string | null | undefined, max: number = SEARCH_MAX_LENGTH): string {
  if (typeof raw !== "string") return "";
  return raw.replace(DISALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** A PostgREST `or` filter matching `term` anywhere in any of `columns` (fixed names chosen by the caller). Null for an empty term. */
export function orIlike(columns: readonly string[], term: string): string | null {
  const t = searchTerm(term);
  if (!t) return null;
  return columns.map((c) => `${c}.ilike."*${t}*"`).join(",");
}

/** The first and last row index (0-based, inclusive) of a page, for `.range()`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ── place names ──────────────────────────────────────────────

/**
 * A suburb or region typed into a filter, reduced to what place names contain (letters, digits,
 * spaces, apostrophes, full stops and hyphens), so it can sit safely inside a PostgREST array
 * filter (`cs.{moonta}`). Returns the cleaned text as typed, or null when nothing is left.
 */
export function placeTerm(raw: string | null | undefined, max = 80): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/[^\p{L}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return t === "" ? null : t;
}

/** The lower-case key the database stores in service_suburb_keys / service_region_keys (trimmed, inner spaces collapsed). */
export function placeKey(place: string): string {
  return place.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── the query ────────────────────────────────────────────────

export function parseDirectoryParams(sp: RawParams, vocab: DirectoryVocab): DirectoryQuery {
  const q = searchTerm(first(sp.q));
  const trade = oneOf(first(sp.trade), vocab.categories);
  const suburb = placeTerm(first(sp.suburb));
  const region = placeTerm(first(sp.region));
  const status = first(sp.status) === STATUS_FILTER_CLEARED ? STATUS_FILTER_CLEARED : oneOf(first(sp.status), vocab.statuses);
  const emergencyRaw = first(sp.emergency);
  const emergency = emergencyRaw === "yes" || emergencyRaw === "no" || emergencyRaw === "unknown" ? emergencyRaw : null;
  const insurance = oneOf(first(sp.insurance), vocab.expiryStates);
  const licence = oneOf(first(sp.licence), vocab.expiryStates);
  const chipRaw = first(sp.chip);
  const chip = (DIRECTORY_CHIPS as readonly string[]).includes(chipRaw) ? (chipRaw as DirectoryChip) : null;

  const sortRaw = first(sp.sort);
  const sort = (DIRECTORY_SORT_KEYS as readonly string[]).includes(sortRaw) ? (sortRaw as DirectorySortKey) : "name";
  const dir = first(sp.dir) === "desc" ? "desc" : "asc";
  const page = boundedInt(first(sp.page), 1, 1, 100_000);

  return {
    q,
    trade,
    suburb,
    region,
    status,
    emergency,
    insurance,
    licence,
    chip,
    sort,
    dir,
    page,
    filtered: Boolean(q || trade || suburb || region || status || emergency || insurance || licence || chip),
  };
}
