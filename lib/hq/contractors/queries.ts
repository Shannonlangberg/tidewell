import "server-only";

import { CONTRACTOR_EXPIRY_STATES, CONTRACTOR_STATUSES, OPEN_TASK_STATUSES, type TaskStatus } from "../constants";
import type { HqClient } from "../db";
import { logTag } from "./db-errors";
import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SORT_COLUMNS,
  STATUS_FILTER_CLEARED,
  lastPage,
  orIlike,
  pageRange,
  parseDirectoryParams,
  placeKey,
  type DirectoryQuery,
  type RawParams,
} from "./params";
import { parseApprovalPreview, type ApprovalPreview } from "./status";
import { toContractor, type Contractor, type Loaded } from "./types";

/*
 * Reads for the contractor directory and profile. Everything runs as the signed-in person (the
 * `db` from requireStaff), so row level security decides what comes back; the capability check
 * is the page's job and happens before any of these are called. Nothing here logs personal
 * data: only the error code.
 */

type Status = (typeof CONTRACTOR_STATUSES)[number];
type ExpiryState = (typeof CONTRACTOR_EXPIRY_STATES)[number];

/** `tradeSlugs`: every trade slug in hq.trades (archived ones too, so an old link still filters). */
export function directoryQuery(sp: RawParams, tradeSlugs: readonly string[]): DirectoryQuery {
  return parseDirectoryParams(sp, { categories: tradeSlugs, statuses: CONTRACTOR_STATUSES, expiryStates: CONTRACTOR_EXPIRY_STATES });
}

export type DirectoryPage = { rows: Contractor[]; total: number; page: number };

/** Most contractors with an expiring item the chip will list by id; beyond this it falls back to the licence and insurance states. */
const EXPIRING_ID_CAP = 150;

/** Contractors with a licence, insurance or document expiry that is expired or inside the warning window (contractor_expiry_watch). */
async function expiringIds(db: HqClient): Promise<string[] | "too_many" | null> {
  const { data, error } = await db.from("contractor_expiry_watch").select("contractor_id").limit(1000);
  if (error) {
    console.error("[hq] expiringIds failed:", logTag(error));
    return null;
  }
  const ids = [...new Set((data ?? []).map((r) => r.contractor_id).filter((i): i is string => !!i))];
  return ids.length > EXPIRING_ID_CAP ? "too_many" : ids;
}

export async function listContractors(db: HqClient, query: DirectoryQuery): Promise<Loaded<DirectoryPage>> {
  let expiring: string[] | "too_many" | null = null;
  if (query.chip === "expiring") {
    expiring = await expiringIds(db);
    if (expiring === null) return { ok: false };
    if (expiring !== "too_many" && expiring.length === 0) return { ok: true, data: { rows: [], total: 0, page: 1 } };
  }

  const run = async (page: number) => {
    let q = db.from("contractor_directory").select("*", { count: "exact" });

    const search = orIlike(["business_name", "primary_contact_name", "email", "abn"], query.q);
    if (search) q = q.or(search);
    if (query.trade) q = q.contains("categories", [query.trade]);
    if (query.suburb) q = q.contains("service_suburb_keys", [placeKey(query.suburb)]);
    if (query.region) q = q.contains("service_region_keys", [placeKey(query.region)]);
    if (query.status === STATUS_FILTER_CLEARED) q = q.in("status", ["approved", "preferred"]);
    else if (query.status) q = q.eq("status", query.status as Status);
    if (query.emergency === "yes") q = q.eq("emergency_available", true);
    else if (query.emergency === "no") q = q.eq("emergency_available", false);
    else if (query.emergency === "unknown") q = q.is("emergency_available", null);
    if (query.insurance) q = q.eq("insurance_state", query.insurance as ExpiryState);
    if (query.licence) q = q.eq("licence_state", query.licence as ExpiryState);

    if (query.chip === "preferred") q = q.eq("status", "preferred");
    // The dashboard's "awaiting vetting": in vetting, or contacted with a checklist step already done.
    if (query.chip === "awaiting") q = q.or("status.eq.vetting,and(status.eq.contacted,vetting_done_count.gt.0)");
    if (query.chip === "expiring") {
      if (expiring === "too_many") q = q.or("insurance_state.in.(expiring_soon,expired),licence_state.in.(expiring_soon,expired)");
      else if (Array.isArray(expiring)) q = q.in("id", expiring);
    }

    // The chosen column, then by name and id so two rows that tie never swap places between pages.
    q = q.order(DIRECTORY_SORT_COLUMNS[query.sort], { ascending: query.dir === "asc", nullsFirst: false });
    if (query.sort !== "name") q = q.order("business_name", { ascending: true });
    q = q.order("id", { ascending: true });

    const { from, to } = pageRange(page, DIRECTORY_PAGE_SIZE);
    return q.range(from, to);
  };

  let page = query.page;
  let result = await run(page);
  // A page number past the end (a stale link) is a range error: show the last page instead.
  if (result.error && result.error.code === "PGRST103") {
    const head = await db.from("contractor_directory").select("id", { count: "exact", head: true });
    page = lastPage(head.count ?? 0, DIRECTORY_PAGE_SIZE);
    result = await run(page);
  }
  if (result.error) {
    console.error("[hq] listContractors failed:", logTag(result.error));
    return { ok: false };
  }
  const rows = (result.data ?? []).map(toContractor).filter((c): c is Contractor => c !== null);
  return { ok: true, data: { rows, total: result.count ?? rows.length, page } };
}

export type DirectoryCounts = { total: number; cleared: number; preferred: number; awaiting: number; expiring: number; expired: number; clearedWithExpired: number };

/** The figures above the directory: real counts from hq.contractor_summary, none invented. */
export async function directoryCounts(db: HqClient): Promise<Loaded<DirectoryCounts>> {
  const { data, error } = await db.rpc("contractor_summary");
  if (error || !data || typeof data !== "object") {
    console.error("[hq] contractor_summary failed:", logTag(error));
    return { ok: false };
  }
  const d = data as Record<string, unknown>;
  const by = (d.by_status ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
  return {
    ok: true,
    data: {
      total: n(d.total),
      cleared: n(by.approved) + n(by.preferred),
      preferred: n(by.preferred),
      awaiting: n(d.awaiting_vetting),
      expiring: n(d.expiring_soon),
      expired: n(d.expired),
      clearedWithExpired: n(d.cleared_with_expired_items),
    },
  };
}

/** Distinct suburbs and regions in use (as first written), for the filters' suggestions. */
export async function placeChoices(db: HqClient): Promise<{ suburbs: string[]; regions: string[] }> {
  const { data, error } = await db.from("contractor_directory").select("service_suburbs, service_regions").limit(2000);
  if (error) {
    console.error("[hq] placeChoices failed:", logTag(error));
    return { suburbs: [], regions: [] };
  }
  const pick = (lists: Array<string[] | null | undefined>) => {
    const seen = new Map<string, string>();
    for (const l of lists) for (const p of l ?? []) if (!seen.has(p.toLowerCase())) seen.set(p.toLowerCase(), p);
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "en-AU"));
  };
  return { suburbs: pick((data ?? []).map((r) => r.service_suburbs)), regions: pick((data ?? []).map((r) => r.service_regions)) };
}

// ── the profile ──────────────────────────────────────────────

export async function getContractor(db: HqClient, id: string): Promise<Loaded<Contractor | null>> {
  const { data, error } = await db.from("contractor_directory").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getContractor failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: data ? toContractor(data) : null };
}

export type ContractorTask = { id: string; title: string; dueDate: string | null; status: TaskStatus; assigneeName: string | null };

type TaskRow = { id: string; title: string; due_date: string | null; status: TaskStatus; assignee: { full_name: string } | null };

/** Open tasks tied to this contractor. Row level security limits them to tasks the person may see. */
export async function openTasksForContractor(db: HqClient, contractorId: string): Promise<Loaded<ContractorTask[]>> {
  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_date, status, assignee:staff_profiles(full_name)")
    .eq("related_contractor_id", contractorId)
    .in("status", [...OPEN_TASK_STATUSES])
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[hq] openTasksForContractor failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as TaskRow[];
  return { ok: true, data: rows.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, status: t.status, assigneeName: t.assignee?.full_name ?? null })) };
}

/** What approving would involve right now: the checklist state and the warnings. Writes nothing. */
export async function previewApproval(db: HqClient, contractorId: string): Promise<Loaded<ApprovalPreview>> {
  const { data, error } = await db.rpc("preview_contractor_approval", { p_contractor: contractorId });
  if (error) {
    console.error("[hq] previewApproval failed:", logTag(error));
    return { ok: false };
  }
  const preview = parseApprovalPreview(data);
  return preview ? { ok: true, data: preview } : { ok: false };
}

/** Contractors for a picker (a task's "related contractor"), alphabetical, capped. */
export async function contractorOptions(db: HqClient, limit = 500): Promise<Array<{ value: string; label: string; group?: string }>> {
  const { data, error } = await db.from("contractor_directory").select("id, business_name, categories").order("business_name").limit(limit);
  if (error) {
    console.error("[hq] contractorOptions failed:", error.code);
    return [];
  }
  return (data ?? []).filter((c): c is typeof c & { id: string; business_name: string } => !!c.id && !!c.business_name).map((c) => ({ value: c.id, label: c.business_name }));
}
