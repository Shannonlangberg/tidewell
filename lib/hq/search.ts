/*
 * The full search page's reading of hq.global_search.
 *
 * The RPC runs as the caller (security invoker), so row level security decides what each
 * person finds: someone without growth.read gets no contacts, organisations or referrals back,
 * and someone who is not tasks.read_all sees only their own tasks. This file therefore never
 * names a group that came back empty: a missing group is not "none found", it may simply not
 * be theirs to see.
 *
 * Pure and dependency-free (type imports only), so `node --test` runs it.
 */

import type { SearchHit, SearchResults } from "../../components/hq/types";

/** The shortest query the database searches (below this it returns nothing). */
export const SEARCH_MIN = 2;
/** The longest the database reads (it cuts at 100). */
export const SEARCH_MAX = 100;
/** Rows per group on the full page. The RPC itself caps at 25. */
export const SEARCH_PAGE_LIMIT = 25;

export const EMPTY_RESULTS: SearchResults = { contacts: [], organisations: [], referrals: [], tasks: [], contractors: [] };

/** The query as typed, collapsed and bounded. */
export function normaliseQuery(value: string | string[] | undefined | null): string {
  const v = (Array.isArray(value) ? value[0] : value) ?? "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

export type QueryState = "empty" | "too_short" | "ready";

export function queryState(q: string): QueryState {
  if (q.length === 0) return "empty";
  return q.length < SEARCH_MIN ? "too_short" : "ready";
}

function hits(value: unknown): SearchHit[] {
  if (!Array.isArray(value)) return [];
  const out: SearchHit[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const title = typeof r.title === "string" ? r.title.trim() : null;
    if (!id || !title) continue;
    out.push({ id, title, subtitle: typeof r.subtitle === "string" && r.subtitle.trim() !== "" ? r.subtitle.trim() : null });
  }
  return out;
}

/** The jsonb {contacts, organisations, referrals, tasks, contractors} as plain, checked arrays. */
export function parseSearchResults(data: unknown): SearchResults {
  if (!data || typeof data !== "object") return { ...EMPTY_RESULTS };
  const r = data as Record<string, unknown>;
  return { contacts: hits(r.contacts), organisations: hits(r.organisations), referrals: hits(r.referrals), tasks: hits(r.tasks), contractors: hits(r.contractors) };
}

export function totalHits(results: SearchResults): number {
  return results.contacts.length + results.organisations.length + results.referrals.length + results.tasks.length + results.contractors.length;
}
