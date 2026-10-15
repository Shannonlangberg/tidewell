/*
 * Search-term handling shared by the contacts and organisations lists.
 *
 * Pure and dependency-free so it runs under `node --test`.
 *
 * Why this exists: the lists search with PostgREST's `or=(col.ilike."*term*", ...)` filter, and a
 * value placed into that string can change what the filter means (a comma starts a new condition,
 * a bracket closes the group, `%` and `_` are LIKE wildcards). Rather than escape every special
 * character, the term is reduced to the characters that appear in people's names, organisation
 * names and email addresses. Everything else is dropped. Nothing the person types can then add a
 * condition or widen the match.
 */

export const SEARCH_MAX_LENGTH = 100;

/** Letters (any script), digits, space and the punctuation names and emails contain: @ . ' ’ & + - */
const DISALLOWED = /[^\p{L}\p{N} @.'’&+-]/gu;

/** The cleaned search term: allowed characters only, whitespace collapsed, bounded. "" when nothing is left. */
export function searchTerm(raw: string | null | undefined, max: number = SEARCH_MAX_LENGTH): string {
  if (typeof raw !== "string") return "";
  return raw.replace(DISALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/**
 * A PostgREST `or` filter that matches `term` anywhere in any of `columns`, case-insensitively.
 * `columns` are fixed names chosen by the caller, never user input. Returns null for an empty term.
 */
export function orIlike(columns: readonly string[], term: string): string | null {
  const t = searchTerm(term);
  if (!t) return null;
  return columns.map((c) => `${c}.ilike."*${t}*"`).join(",");
}

/**
 * A rough JavaScript twin of hq_private.normalise_name (migration 0100), used only to look up a
 * likely duplicate BEFORE a write so the person gets a friendly message. The database stays the
 * arbiter: a unique index still refuses a true duplicate this function misses.
 *
 * Lower-case, "&" becomes "and", ASCII punctuation removed, whitespace collapsed, a leading "the"
 * and a trailing "pty ltd / pty limited / pty / ltd / limited / inc" removed.
 */
export function normaliseName(name: string): string {
  const step1 = name.toLowerCase().replace(/&/g, " and ");
  const step2 = step1.replace(/[!-/:-@[-`{-~]/g, "");
  const step3 = step2.replace(/\s+/g, " ").trim();
  const step4 = step3.replace(/^\s*the\s+(?=\S)/, "");
  return step4.replace(/(?<=\S)\s+(pty\s+ltd|pty\s+limited|pty|ltd|limited|inc)\s*$/, "").trim();
}

/* ═══════════════════════════ list URL parameters ═══════════════════════════
 *
 * The contacts and organisations lists are driven entirely by the URL: search, filters, sort and
 * page. These turn the raw `searchParams` into a validated query. Every value is checked against
 * an allowlist (the sortable columns, the enum values, a uuid shape), so nothing the address bar
 * carries reaches the database unchecked.
 *
 * They live in this file, beside the search helpers above, because a pure module that is tested
 * with `node --test` cannot import a sibling (Node needs a ".ts" extension that the type checker
 * refuses). The enum lists are passed in by the caller, which imports them from constants.
 */

export type RawParams = Record<string, string | string[] | undefined>;

export const LIST_PAGE_SIZE = 25;
export const STALE_DAY_CHOICES = [14, 30, 60, 90] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first value of a search param, or "". */
export function first(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v : "";
}

function oneOf(value: string, list: readonly string[]): string | null {
  return list.includes(value) ? value : null;
}

/** A whole number within [min, max], or `fallback`. Rejects "2abc" and "1e3", which parseInt would half-accept. */
export function boundedInt(value: string, fallback: number, min: number, max: number): number {
  if (!/^\d{1,9}$/.test(value.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export type OwnerFilter = { kind: "me" } | { kind: "none" } | { kind: "staff"; id: string };

export function parseOwner(value: string): OwnerFilter | null {
  const v = value.trim();
  if (v === "me") return { kind: "me" };
  if (v === "none") return { kind: "none" };
  return UUID.test(v) ? { kind: "staff", id: v.toLowerCase() } : null;
}

export function parseRegion(value: string): string | null {
  const v = value.trim().slice(0, 120);
  return v ? v : null;
}

export function parseSort<K extends string>(sortValue: string, dirValue: string, keys: readonly K[], fallback: K): { sort: K; dir: "asc" | "desc" } {
  const sort = (keys as readonly string[]).includes(sortValue) ? (sortValue as K) : fallback;
  return { sort, dir: dirValue === "desc" ? "desc" : "asc" };
}

/** The first and last row index (0-based, inclusive) of a page, for `.range()`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** The last page that has rows (at least 1). */
export function lastPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ── contacts ─────────────────────────────────────────────────

/** URL sort key -> column in hq.contact_directory. The ONLY columns a person can sort the contacts list by. */
export const CONTACT_SORT_COLUMNS = {
  name: "full_name",
  organisation: "organisation_name",
  status: "relationship_status",
  priority: "priority",
  owner: "relationship_owner_name",
  last_contact: "last_contact_at",
  follow_up: "next_follow_up_date",
} as const;
export type ContactSortKey = keyof typeof CONTACT_SORT_COLUMNS;
export const CONTACT_SORT_KEYS = Object.keys(CONTACT_SORT_COLUMNS) as ContactSortKey[];

export type ContactListVocab = {
  categories: readonly string[];
  statuses: readonly string[];
  priorities: readonly string[];
};

export type ContactListQuery = {
  /** Cleaned search text, "" when none. */
  q: string;
  category: string | null;
  status: string | null;
  priority: string | null;
  region: string | null;
  owner: OwnerFilter | null;
  followUp: "overdue" | null;
  /** Not contacted in at least this many days (or never). */
  staleDays: number | null;
  verify: "needs" | "verified" | null;
  sort: ContactSortKey;
  dir: "asc" | "desc";
  page: number;
  /** Whether any search or filter is applied (sorting and paging do not count). */
  filtered: boolean;
};

export function parseContactListParams(sp: RawParams, vocab: ContactListVocab): ContactListQuery {
  const q = searchTerm(first(sp.q));
  const category = oneOf(first(sp.category), vocab.categories);
  const status = oneOf(first(sp.status), vocab.statuses);
  const priority = oneOf(first(sp.priority), vocab.priorities);
  const region = parseRegion(first(sp.region));
  const owner = parseOwner(first(sp.owner));
  const followUp = first(sp.followup) === "overdue" ? "overdue" : null;
  const staleRaw = Number(first(sp.stale));
  const staleDays = (STALE_DAY_CHOICES as readonly number[]).includes(staleRaw) ? staleRaw : null;
  const verifyRaw = first(sp.verify);
  const verify = verifyRaw === "needs" || verifyRaw === "verified" ? verifyRaw : null;
  const { sort, dir } = parseSort(first(sp.sort), first(sp.dir), CONTACT_SORT_KEYS, "name");
  const page = boundedInt(first(sp.page), 1, 1, 100_000);

  return {
    q,
    category,
    status,
    priority,
    region,
    owner,
    followUp,
    staleDays,
    verify,
    sort,
    dir,
    page,
    filtered: Boolean(q || category || status || priority || region || owner || followUp || staleDays || verify),
  };
}

// ── organisations ────────────────────────────────────────────

/** URL sort key -> column in hq.organisation_directory. */
export const ORGANISATION_SORT_COLUMNS = {
  name: "name",
  region: "service_region",
  contacts: "contact_count",
  owner: "relationship_owner_name",
  last_contact: "last_contact_at",
} as const;
export type OrganisationSortKey = keyof typeof ORGANISATION_SORT_COLUMNS;
export const ORGANISATION_SORT_KEYS = Object.keys(ORGANISATION_SORT_COLUMNS) as OrganisationSortKey[];

export type OrganisationListQuery = {
  q: string;
  category: string | null;
  region: string | null;
  owner: OwnerFilter | null;
  verify: "needs" | "verified" | null;
  sort: OrganisationSortKey;
  dir: "asc" | "desc";
  page: number;
  filtered: boolean;
};

export function parseOrganisationListParams(sp: RawParams, vocab: { categories: readonly string[] }): OrganisationListQuery {
  const q = searchTerm(first(sp.q));
  const category = oneOf(first(sp.category), vocab.categories);
  const region = parseRegion(first(sp.region));
  const owner = parseOwner(first(sp.owner));
  const verifyRaw = first(sp.verify);
  const verify = verifyRaw === "needs" || verifyRaw === "verified" ? verifyRaw : null;
  const { sort, dir } = parseSort(first(sp.sort), first(sp.dir), ORGANISATION_SORT_KEYS, "name");
  const page = boundedInt(first(sp.page), 1, 1, 100_000);
  return { q, category, region, owner, verify, sort, dir, page, filtered: Boolean(q || category || region || owner || verify) };
}

// ── the ?log= parameter ──────────────────────────────────────

const LOG_TYPES = ["phone_call", "coffee_meeting", "office_meeting", "email", "message", "note"] as const;
export type LogType = (typeof LOG_TYPES)[number];

/**
 * `?log=` opens the "log an interaction" drawer. The quick-add menu links to `?log=call`, so the
 * short names call, meeting and coffee work as well as the six interaction types. Anything else
 * means "closed".
 */
export function parseLogParam(value: string | string[] | undefined): LogType | null {
  const v = first(value).trim().toLowerCase();
  if (v === "call") return "phone_call";
  if (v === "meeting" || v === "coffee") return "coffee_meeting";
  return (LOG_TYPES as readonly string[]).includes(v) ? (v as LogType) : null;
}

/** The cutoff timestamp for "not contacted in N days": a contact whose last contact is before this (or never) is quiet. */
export function staleCutoff(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
