import "server-only";

import type { HqClient } from "../db";
import {
  parseBusinessSummary,
  parseManagedRef,
  searchWords,
  type AiloStatus,
  type BusinessSummary,
  type FeeBasis,
  type HandoverStep,
  type HandoverStepStatus,
  type ManagedStatus,
  type PortfolioListQuery,
  type ServiceType,
} from "./rules";

/*
 * Reads for the portfolio screens (and the MCP tools). Every query runs as the signed-in person, so
 * row level security is the control: without portfolio.read nothing comes back; archived properties
 * reach only portfolio.write holders, and the lists filter them out.
 *
 * Nothing here logs more than an error code.
 */

export type Result<T> = { ok: true; data: T } | { ok: false };

export type PropertyRow = {
  id: string;
  ref: string;
  refNumber: number;
  propertyAddress: string;
  suburb: string | null;
  serviceType: ServiceType;
  status: ManagedStatus;
  feeBasis: FeeBasis | null;
  feePercent: number | null;
  feeNotes: string | null;
  agreementSignedOn: string | null;
  managedFrom: string | null;
  endedOn: string | null;
  ailoReference: string | null;
  ailoStatus: AiloStatus;
  notes: string | null;
  opportunityId: string | null;
  opportunityNumber: number | null;
  opportunityProspectName: string | null;
  manualOriginNote: string | null;
  ownerContactId: string | null;
  ownerDisplayName: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  handoverDone: number;
  handoverTotal: number;
  handoverOpenSteps: HandoverStep[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export const PORTFOLIO_COLUMNS =
  "id, ref, ref_number, property_address, suburb, service_type, status, fee_basis, fee_percent, fee_notes, agreement_signed_on, managed_from, ended_on, ailo_reference, ailo_status, notes, opportunity_id, opportunity_number, opportunity_prospect_name, manual_origin_note, owner_contact_id, owner_display_name, owner_name, owner_phone, owner_email, handover_done, handover_total, handover_open_steps, created_at, updated_at, deleted_at";

type OverviewRow = {
  id: string | null;
  ref: string | null;
  ref_number: number | null;
  property_address: string | null;
  suburb: string | null;
  service_type: ServiceType | null;
  status: ManagedStatus | null;
  fee_basis: FeeBasis | null;
  fee_percent: number | null;
  fee_notes: string | null;
  agreement_signed_on: string | null;
  managed_from: string | null;
  ended_on: string | null;
  ailo_reference: string | null;
  ailo_status: AiloStatus | null;
  notes: string | null;
  opportunity_id: string | null;
  opportunity_number: number | null;
  opportunity_prospect_name: string | null;
  manual_origin_note: string | null;
  owner_contact_id: string | null;
  owner_display_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  handover_done: number | null;
  handover_total: number | null;
  handover_open_steps: string[] | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toPropertyRow(r: OverviewRow): PropertyRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !r.property_address || !r.service_type || !r.status || !r.ailo_status || !r.created_at || !r.updated_at) return null;
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    propertyAddress: r.property_address,
    suburb: r.suburb,
    serviceType: r.service_type,
    status: r.status,
    feeBasis: r.fee_basis,
    feePercent: r.fee_percent === null ? null : Number(r.fee_percent),
    feeNotes: r.fee_notes,
    agreementSignedOn: r.agreement_signed_on,
    managedFrom: r.managed_from,
    endedOn: r.ended_on,
    ailoReference: r.ailo_reference,
    ailoStatus: r.ailo_status,
    notes: r.notes,
    opportunityId: r.opportunity_id,
    opportunityNumber: r.opportunity_number,
    opportunityProspectName: r.opportunity_prospect_name,
    manualOriginNote: r.manual_origin_note,
    ownerContactId: r.owner_contact_id,
    ownerDisplayName: r.owner_display_name,
    ownerName: r.owner_name,
    ownerPhone: r.owner_phone,
    ownerEmail: r.owner_email,
    handoverDone: Number(r.handover_done ?? 0),
    handoverTotal: Number(r.handover_total ?? 0),
    handoverOpenSteps: (r.handover_open_steps ?? []) as HandoverStep[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.deleted_at !== null,
  };
}

export const propertyRowsOf = (data: unknown): PropertyRow[] => ((data ?? []) as OverviewRow[]).map(toPropertyRow).filter((r): r is PropertyRow => r !== null);

/** The live portfolio, newest first (by number). Search: address, suburb, owner, Ailo reference, or MP-0001. */
export async function listProperties(
  db: HqClient,
  f: Partial<Pick<PortfolioListQuery, "q" | "status" | "service" | "ailo" | "handoverOpen">>,
  page: { offset: number; limit: number },
): Promise<Result<{ rows: PropertyRow[]; total: number }>> {
  let q = db.from("portfolio_overview").select(PORTFOLIO_COLUMNS, { count: "exact" }).is("deleted_at", null);
  const ref = f.q ? parseManagedRef(f.q) : null;
  if (ref !== null) q = q.eq("ref_number", ref);
  else if (f.q) {
    const w = searchWords(f.q);
    if (w) q = q.or(`property_address.ilike.*${w}*,suburb.ilike.*${w}*,owner_display_name.ilike.*${w}*,ailo_reference.ilike.*${w}*`);
  }
  if (f.status) q = q.eq("status", f.status);
  if (f.service) q = q.eq("service_type", f.service);
  if (f.ailo) q = q.eq("ailo_status", f.ailo);
  if (f.handoverOpen) q = q.lt("handover_done", 9);
  const { data, error, count } = await q.order("ref_number", { ascending: false }).range(page.offset, page.offset + page.limit - 1);
  if (error) {
    if (error.code === "PGRST103") return { ok: true, data: { rows: [], total: count ?? 0 } };
    console.error("[hq] listProperties failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: propertyRowsOf(data), total: count ?? 0 } };
}

export type HandoverRow = { step: HandoverStep; status: HandoverStepStatus; note: string | null; completedAt: string | null; completedByName: string | null };

export type PropertyDetail = { property: PropertyRow; steps: HandoverRow[] };

/** One property by id (archived ones only for portfolio.write holders, by RLS), with its nine steps in order. */
export async function getProperty(db: HqClient, id: string): Promise<Result<PropertyDetail | null>> {
  const one = await db.from("portfolio_overview").select(PORTFOLIO_COLUMNS).eq("id", id).maybeSingle();
  if (one.error) {
    console.error("[hq] getProperty failed:", one.error.code);
    return { ok: false };
  }
  const property = one.data ? toPropertyRow(one.data as OverviewRow) : null;
  if (!property) return { ok: true, data: null };
  const steps = await db.from("property_handover_steps").select("step, status, note, completed_at, completed_by").eq("property_id", id).order("step");
  if (steps.error) {
    console.error("[hq] getProperty steps failed:", steps.error.code);
    return { ok: false };
  }
  const who = [...new Set((steps.data ?? []).map((s) => s.completed_by).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (who.length) {
    const s = await db.from("staff_profiles").select("id, full_name").in("id", who);
    for (const r of s.data ?? []) names.set(r.id, r.full_name);
  }
  return {
    ok: true,
    data: {
      property,
      steps: (steps.data ?? []).map((s) => ({
        step: s.step as HandoverStep,
        status: s.status as HandoverStepStatus,
        note: s.note,
        completedAt: s.completed_at,
        completedByName: s.completed_by ? (names.get(s.completed_by) ?? null) : null,
      })),
    },
  };
}

/** hq.business_summary(), parsed. ok:false on any error (the caller shows a quiet line, never a number). */
export async function loadBusinessSummary(db: HqClient): Promise<Result<BusinessSummary>> {
  const { data, error } = await db.rpc("business_summary");
  if (error) {
    console.error("[hq] business_summary failed:", error.code);
    return { ok: false };
  }
  const parsed = parseBusinessSummary(data);
  return parsed ? { ok: true, data: parsed } : { ok: false };
}

/** The goal as stored (target, and the date or null). */
export async function loadGoal(db: HqClient): Promise<Result<{ target: number; date: string | null }>> {
  const { data, error } = await db.from("settings").select("key, value").in("key", ["goal_managed_properties", "goal_date"]);
  if (error) {
    console.error("[hq] loadGoal failed:", error.code);
    return { ok: false };
  }
  const by = new Map((data ?? []).map((r) => [r.key, r.value]));
  const t = by.get("goal_managed_properties");
  const d = by.get("goal_date");
  return { ok: true, data: { target: typeof t === "number" ? t : 20, date: typeof d === "string" ? d : null } };
}

/** The managed property made from an opportunity, if any (live or archived the person can see). */
export async function propertyForOpportunity(db: HqClient, opportunityId: string): Promise<Result<{ id: string; ref: string; archived: boolean } | null>> {
  const { data, error } = await db.from("portfolio_overview").select("id, ref, deleted_at").eq("opportunity_id", opportunityId).maybeSingle();
  if (error) {
    console.error("[hq] propertyForOpportunity failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data && data.id && data.ref ? { id: data.id, ref: data.ref, archived: data.deleted_at !== null } : null };
}

/** Landlord and other contacts for the owner picker (live, by name; at most 300). */
export async function ownerOptions(db: HqClient): Promise<{ value: string; label: string }[]> {
  const { data, error } = await db.from("contacts").select("id, full_name, contact_kind").is("deleted_at", null).neq("contact_kind", "partner").order("full_name").limit(300);
  if (error) {
    console.error("[hq] ownerOptions failed:", error.code);
    return [];
  }
  return (data ?? []).map((c) => ({ value: c.id, label: c.full_name }));
}
