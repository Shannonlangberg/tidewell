import "server-only";

import { cache } from "react";
import { requireStaff } from "../auth";
import type { ContractorStatus } from "../constants";
import type { DocumentType } from "./documents-rules";
import { parseContractorSummary, type ContractorSummary } from "./widgets-summary";

/*
 * What the four contractor dashboard widgets read. Every loader runs AS the signed-in person, so row
 * level security decides what comes back; the widgets are also hidden without contractors.read, but
 * that is a courtesy. A loader THROWS on a database error (code only) and the widget shows an error
 * state, so one failing query never breaks the page.
 */

async function ctxDb() {
  return (await requireStaff("contractors.read")).db;
}

/** contractor_summary(), once per request: three widgets read it. */
export const loadContractorSummary = cache(async (): Promise<ContractorSummary> => {
  const db = await ctxDb();
  const { data, error } = await db.rpc("contractor_summary");
  if (error) throw new Error(`contractor_summary ${error.code}`);
  return parseContractorSummary(data);
});

// ── awaiting vetting ─────────────────────────────────────────

export type AwaitingItem = { id: string; name: string; status: ContractorStatus; doneCount: number; contacted: boolean };

/**
 * Contractors in `vetting`, plus contractors still `contacted` with a checklist step under way
 * (steps 1 to 8 past not_started): the same rule as contractor_summary().awaiting_vetting. Most
 * progress first.
 */
export async function loadAwaitingVetting(limit = 6): Promise<AwaitingItem[]> {
  const db = await ctxDb();
  const { data, error } = await db
    .from("contractor_directory")
    .select("id, business_name, status, vetting_done_count")
    .in("status", ["vetting", "contacted"])
    .limit(1000);
  if (error) throw new Error(`awaiting vetting ${error.code}`);
  const rows = (data ?? []).filter((r): r is typeof r & { id: string; business_name: string; status: ContractorStatus } => !!r.id && !!r.business_name && !!r.status);

  const contactedIds = rows.filter((r) => r.status === "contacted").map((r) => r.id);
  const underway = new Set<string>();
  if (contactedIds.length > 0) {
    const steps = await db
      .from("contractor_vetting_steps")
      .select("contractor_id")
      .in("contractor_id", contactedIds)
      .neq("status", "not_started")
      .neq("step", "review_and_approve")
      .limit(5000);
    if (steps.error) throw new Error(`awaiting vetting steps ${steps.error.code}`);
    for (const s of steps.data ?? []) underway.add(s.contractor_id);
  }

  return rows
    .filter((r) => r.status === "vetting" || underway.has(r.id))
    .map((r) => ({ id: r.id, name: r.business_name, status: r.status, doneCount: r.vetting_done_count ?? 0, contacted: r.status === "contacted" }))
    .sort((a, b) => b.doneCount - a.doneCount || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// ── expiry watch ─────────────────────────────────────────────

export type ExpiryItem = {
  key: string;
  contractorId: string;
  name: string;
  status: ContractorStatus;
  kind: "licence" | "insurance" | "document";
  documentType: DocumentType | null;
  fileName: string | null;
  expiresOn: string;
  state: "expired" | "expiring_soon";
};

export async function loadExpiryWatch(limit = 8): Promise<{ items: ExpiryItem[]; total: number }> {
  const db = await ctxDb();
  const { data, error, count } = await db
    .from("contractor_expiry_watch")
    .select("contractor_id, business_name, contractor_status, kind, item_key, document_type, file_name, expires_on, state", { count: "exact" })
    .order("expires_on", { ascending: true })
    .order("business_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`expiry watch ${error.code}`);
  const items: ExpiryItem[] = [];
  for (const r of data ?? []) {
    if (!r.contractor_id || !r.business_name || !r.contractor_status || !r.expires_on || !r.item_key) continue;
    if (r.kind !== "licence" && r.kind !== "insurance" && r.kind !== "document") continue;
    if (r.state !== "expired" && r.state !== "expiring_soon") continue;
    items.push({
      key: `${r.contractor_id}:${r.item_key}`,
      contractorId: r.contractor_id,
      name: r.business_name,
      status: r.contractor_status,
      kind: r.kind,
      documentType: r.document_type,
      fileName: r.file_name,
      expiresOn: r.expires_on,
      state: r.state,
    });
  }
  return { items, total: count ?? items.length };
}

// ── recent activity ──────────────────────────────────────────

export type ActivityItem = {
  key: string;
  contractorId: string;
  name: string;
  kind: string;
  interactionType: string | null;
  occurredAt: string;
  actorName: string | null;
  summary: string;
};

export async function loadRecentContractorActivity(limit = 6): Promise<ActivityItem[]> {
  const db = await ctxDb();
  const { data, error } = await db
    .from("contractor_timeline")
    .select("event_key, contractor_id, business_name, kind, interaction_type, occurred_at, actor_name, summary")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`contractor activity ${error.code}`);
  const out: ActivityItem[] = [];
  for (const r of data ?? []) {
    if (!r.event_key || !r.contractor_id || !r.business_name || !r.occurred_at || !r.summary) continue;
    out.push({
      key: r.event_key,
      contractorId: r.contractor_id,
      name: r.business_name,
      kind: r.kind ?? "",
      interactionType: r.interaction_type,
      occurredAt: r.occurred_at,
      actorName: r.actor_name,
      summary: r.summary,
    });
  }
  return out;
}
