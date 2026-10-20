import "server-only";

import type { HqClient } from "../db";
import { CATEGORY_LABEL, type PartnerCategory } from "../constants";
import type { Option } from "../queries/options";
import { parseGrowthSummary, type GrowthSummary } from "./numbers";
import {
  PARTNERS_PAGE_SIZE,
  PARTNER_SORT_COLUMNS,
  REFERRALS_PAGE_SIZE,
  REFERRAL_SORT_COLUMNS,
  orIlike,
  pageRange,
  refNumberFromSearch,
  type AssignedFilter,
  type PartnerQuery,
  type PipelineQuery,
  type ReferralListQuery,
} from "./params";
import { COLLAPSED_STAGES, STAGE_ORDER } from "./stages";
import {
  LIST_COLUMNS,
  toListItem,
  toPartnerRow,
  type ClaimItem,
  type Loaded,
  type OpportunityDetail,
  type PartnerPerformanceRow,
  type PipelineCard,
  type ReferralDetail,
  type ReferralListItem,
  type StageHistoryItem,
} from "./types";
import { logTag } from "./errors";

/*
 * Reads for the referral screens. Every query runs as the signed-in person (the typed `db` from
 * requireStaff), so row level security decides what comes back: a person without growth.read gets
 * nothing, never someone else's rows. A failed read is logged by code only and returned as
 * `{ ok: false }`, so a page can say so rather than show a wrong number.
 */

const fail = { ok: false } as const;

function ok<T>(data: T): Loaded<T> {
  return { ok: true, data };
}

// ── the Growth overview ──────────────────────────────────────

export async function loadGrowthSummary(db: HqClient, since: string): Promise<Loaded<GrowthSummary>> {
  const { data, error } = await db.rpc("growth_summary", { p_since: since });
  if (error) {
    console.error("[hq] growth_summary failed:", logTag(error));
    return fail;
  }
  const summary = parseGrowthSummary(data);
  if (!summary) {
    console.error("[hq] growth_summary returned an unexpected shape");
    return fail;
  }
  return ok(summary);
}

/**
 * How many of the referrals received in the window are further claims on a prospect that was already
 * in the pipeline. They are real referrals (each partner did introduce the prospect) but they are
 * not new prospects, and a signed management is credited once however many partners claim it.
 */
export async function countAdditionalClaims(db: HqClient, since: string): Promise<number | null> {
  const { count, error } = await db
    .from("referral_overview")
    .select("id", { count: "exact", head: true })
    .eq("direction", "received")
    .eq("is_attributed", false)
    .gte("referral_date", since);
  if (error) {
    console.error("[hq] additional claims count failed:", logTag(error));
    return null;
  }
  return count ?? 0;
}

export type PartnerPage = { rows: PartnerPerformanceRow[]; total: number; page: number; withActivity: number; allPartners: number };

export async function listPartnerPerformance(db: HqClient, query: PartnerQuery): Promise<Loaded<PartnerPage>> {
  const { from, to } = pageRange(query.page, PARTNERS_PAGE_SIZE);
  let q = db.from("partner_performance").select("*", { count: "exact" });
  if (query.category) q = q.contains("categories", [query.category as PartnerCategory]);
  if (!query.showAll) q = q.or("received.gt.0,sent.gt.0");
  const column = PARTNER_SORT_COLUMNS[query.sort];
  q = q.order(column, { ascending: query.dir === "asc", nullsFirst: false });
  if (column !== "organisation_name") q = q.order("organisation_name");
  const { data, error, count } = await q.order("organisation_id").range(from, to);
  if (error) {
    // A page past the end of the list is not a failure: show the first page instead.
    if (error.code === "PGRST103" && query.page > 1) return listPartnerPerformance(db, { ...query, page: 1 });
    console.error("[hq] partner_performance failed:", logTag(error));
    return fail;
  }
  const rows = (data ?? []).map(toPartnerRow).filter((r): r is PartnerPerformanceRow => r !== null);

  // How many partners have any referral at all, to say "showing 3 of 22" honestly.
  const [active, all] = await Promise.all([
    db.from("partner_performance").select("organisation_id", { count: "exact", head: true }).or("received.gt.0,sent.gt.0"),
    db.from("partner_performance").select("organisation_id", { count: "exact", head: true }),
  ]);
  return ok({ rows, total: count ?? rows.length, page: query.page, withActivity: active.count ?? 0, allPartners: all.count ?? 0 });
}

/** Categories as picker options, in the order people expect. */
export function categoryOptions(): Option[] {
  return (Object.keys(CATEGORY_LABEL) as PartnerCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));
}

// ── the register ─────────────────────────────────────────────

export type ReferralPage = { rows: ReferralListItem[]; total: number; page: number };

function applyAssigned<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T, column: string, filter: AssignedFilter | null, staffId: string): T {
  if (!filter) return q;
  if (filter.kind === "none") return q.is(column, null);
  return q.eq(column, filter.kind === "me" ? staffId : filter.id);
}

export async function listReferrals(db: HqClient, query: ReferralListQuery, ctx: { staffId: string }): Promise<Loaded<ReferralPage>> {
  const { from, to } = pageRange(query.page, REFERRALS_PAGE_SIZE);
  let q = db.from("referral_overview").select(LIST_COLUMNS, { count: "exact" });

  if (query.direction) q = q.eq("direction", query.direction);
  if (query.stage) q = q.eq("stage", query.stage);
  if (query.partner) q = q.eq("partner_organisation_id", query.partner);
  if (query.signedOnly) q = q.not("signed_at", "is", null);
  if (query.from) q = q.gte("referral_date", query.from);
  if (query.to) q = q.lte("referral_date", query.to);
  q = applyAssigned(q, "assigned_to", query.assigned, ctx.staffId);

  if (query.q) {
    const text = orIlike(["prospect_name", "ref_label", "partner_organisation_name", "partner_contact_name", "property_suburb"], query.q);
    const number = refNumberFromSearch(query.q);
    const parts = [text, number !== null ? `ref_number.eq.${number}` : null].filter((p): p is string => !!p);
    if (parts.length > 0) q = q.or(parts.join(","));
  }

  // The sort column comes from an allowlist; `id` breaks ties so a page boundary never repeats or skips a row.
  q = q.order(REFERRAL_SORT_COLUMNS[query.sort], { ascending: query.dir === "asc", nullsFirst: false });
  const { data, error, count } = await q.order("id").range(from, to);
  if (error) {
    if (error.code === "PGRST103" && query.page > 1) return listReferrals(db, { ...query, page: 1 }, ctx);
    console.error("[hq] referral register failed:", logTag(error));
    return fail;
  }
  const rows = (data ?? []).map(toListItem).filter((r): r is ReferralListItem => r !== null);
  return ok({ rows, total: count ?? rows.length, page: query.page });
}

/** Partner organisations that appear on at least one referral, for the register's filter. */
export async function referralPartnerOptions(db: HqClient, direction?: "received" | "sent"): Promise<Option[]> {
  let q = db.from("referral_overview").select("partner_organisation_id, partner_organisation_name").not("partner_organisation_id", "is", null);
  if (direction) q = q.eq("direction", direction);
  const { data, error } = await q.limit(2000);
  if (error) {
    console.error("[hq] referralPartnerOptions failed:", logTag(error));
    return [];
  }
  const seen = new Map<string, string>();
  for (const r of data ?? []) {
    if (r.partner_organisation_id && r.partner_organisation_name) seen.set(r.partner_organisation_id, r.partner_organisation_name);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "en-AU"));
}

// ── people's names ───────────────────────────────────────────

/** Every staff member's name by id, including people who have since left, so history still reads. */
export async function staffNames(db: HqClient): Promise<Map<string, string>> {
  const { data, error } = await db.from("staff_profiles").select("id, full_name");
  if (error) {
    console.error("[hq] staffNames failed:", logTag(error));
    return new Map();
  }
  return new Map((data ?? []).map((s) => [s.id, s.full_name]));
}

// ── one referral ─────────────────────────────────────────────

export type DetailBundle = {
  referral: ReferralDetail;
  opportunity: OpportunityDetail | null;
  history: StageHistoryItem[];
  /** Every received referral for the opportunity, the credited one included. */
  claims: ClaimItem[];
};

/**
 * Loads a referral and, for a received one, its opportunity, the stage history and every claim on
 * it. Returns null when the referral does not exist (or is archived), which the page treats as 404.
 * The secondary parts degrade quietly: if they cannot be read the page still shows the referral.
 */
export async function loadReferralDetail(db: HqClient, id: string): Promise<Loaded<DetailBundle | null>> {
  const found = await db.from("referral_overview").select("*").eq("id", id).maybeSingle();
  if (found.error) {
    console.error("[hq] referral detail failed:", logTag(found.error));
    return fail;
  }
  const r = found.data;
  if (!r || !r.id || !r.ref_label || !r.direction || !r.referral_date || r.ref_number === null) return ok(null);

  const referral: ReferralDetail = {
    id: r.id,
    refNumber: Number(r.ref_number),
    refLabel: r.ref_label,
    direction: r.direction,
    referralDate: r.referral_date,
    isAttributed: r.is_attributed ?? false,
    sentOutcome: r.sent_outcome,
    partnerOrganisationId: r.partner_organisation_id,
    partnerOrganisationName: r.partner_organisation_name,
    partnerContactId: r.partner_contact_id,
    partnerContactName: r.partner_contact_name,
    opportunityId: r.opportunity_id,
    prospectName: r.prospect_name,
    prospectPhone: r.prospect_phone,
    prospectEmail: r.prospect_email,
    propertySuburb: r.property_suburb,
    propertyAddress: r.property_address,
    assignedToId: r.assigned_to,
    assignedToName: r.assigned_to_name,
    notes: r.notes,
    createdAt: r.created_at,
  };

  if (!r.opportunity_id) return ok({ referral, opportunity: null, history: [], claims: [] });

  const [oppRes, histRes, claimRes, names] = await Promise.all([
    db
      .from("opportunities")
      .select(
        "id, display_number, prospect_name, prospect_phone, prospect_email, property_suburb, property_address, stage, stage_changed_at, estimated_annual_value_cents, assigned_to, signed_at, management_reference, lost_reason, notes",
      )
      .eq("id", r.opportunity_id)
      .is("deleted_at", null)
      .maybeSingle(),
    db
      .from("opportunity_stage_history")
      .select("id, from_stage, to_stage, changed_by, changed_at, note")
      .eq("opportunity_id", r.opportunity_id)
      .order("changed_at", { ascending: false })
      .order("id", { ascending: false }),
    db
      .from("referral_overview")
      .select("id, ref_label, referral_date, is_attributed, partner_organisation_id, partner_organisation_name, partner_contact_id, partner_contact_name")
      .eq("opportunity_id", r.opportunity_id)
      .eq("direction", "received")
      .order("ref_number"),
    staffNames(db),
  ]);

  if (oppRes.error) console.error("[hq] opportunity detail failed:", logTag(oppRes.error));
  if (histRes.error) console.error("[hq] stage history failed:", logTag(histRes.error));
  if (claimRes.error) console.error("[hq] claims failed:", logTag(claimRes.error));

  const o = oppRes.data;
  const opportunity: OpportunityDetail | null = o
    ? {
        id: o.id,
        number: Number(o.display_number),
        prospectName: o.prospect_name,
        prospectPhone: o.prospect_phone,
        prospectEmail: o.prospect_email,
        propertySuburb: o.property_suburb,
        propertyAddress: o.property_address,
        stage: o.stage,
        stageChangedAt: o.stage_changed_at,
        estimateCents: o.estimated_annual_value_cents === null ? null : Number(o.estimated_annual_value_cents),
        assignedToId: o.assigned_to,
        assignedToName: o.assigned_to ? (names.get(o.assigned_to) ?? null) : null,
        signedAt: o.signed_at,
        managementReference: o.management_reference,
        lostReason: o.lost_reason,
        notes: o.notes,
      }
    : null;

  const history: StageHistoryItem[] = (histRes.data ?? []).map((h) => ({
    id: Number(h.id),
    fromStage: h.from_stage,
    toStage: h.to_stage,
    changedAt: h.changed_at,
    changedByName: h.changed_by ? (names.get(h.changed_by) ?? null) : null,
    note: h.note,
  }));

  const claims: ClaimItem[] = (claimRes.data ?? [])
    .filter((c): c is typeof c & { id: string; ref_label: string; referral_date: string } => !!c.id && !!c.ref_label && !!c.referral_date)
    .map((c) => ({
      id: c.id,
      refLabel: c.ref_label,
      referralDate: c.referral_date,
      isAttributed: c.is_attributed ?? false,
      partnerOrganisationId: c.partner_organisation_id,
      partnerOrganisationName: c.partner_organisation_name,
      partnerContactId: c.partner_contact_id,
      partnerContactName: c.partner_contact_name,
    }));

  return ok({ referral, opportunity, history, claims });
}

// ── the pipeline ─────────────────────────────────────────────

/** More than this and the board says so rather than silently dropping cards. */
export const PIPELINE_LIMIT = 1000;

export type PipelineData = { cards: PipelineCard[]; truncated: boolean };

/**
 * One card per live lead (hq.opportunity_overview), however it came in: a partner's referral (the
 * card names the credited partner, so a prospect claimed by two partners appears once) or a direct
 * lead (own marketing, the website, a direct approach).
 */
export async function loadPipeline(db: HqClient, query: PipelineQuery, ctx: { staffId: string }): Promise<Loaded<PipelineData>> {
  let q = db
    .from("opportunity_overview")
    .select(
      "id, ref, credited_referral_id, prospect_name, property_suburb, stage, stage_changed_at, estimated_annual_value_cents, signed_at, partner_organisation_name, partner_contact_name, assigned_to, assigned_to_name, other_claims, source, next_action, next_action_due, needs_attention",
    );
  if (query.partner) q = q.eq("partner_organisation_id", query.partner);
  if (query.hideLost) q = q.neq("stage", "lost");
  if (query.source) q = q.eq("source", query.source);
  if (query.attention) q = q.eq("needs_attention", true);
  q = applyAssigned(q, "assigned_to", query.assigned, ctx.staffId);

  const res = await q.order("stage_changed_at", { ascending: true }).order("id").limit(PIPELINE_LIMIT);
  if (res.error) {
    console.error("[hq] pipeline failed:", logTag(res.error));
    return fail;
  }

  const cards: PipelineCard[] = [];
  for (const r of res.data ?? []) {
    if (!r.id || !r.ref || !r.prospect_name || !r.stage) continue;
    cards.push({
      referralId: r.credited_referral_id,
      refLabel: r.ref,
      opportunityId: r.id,
      prospectName: r.prospect_name,
      propertySuburb: r.property_suburb,
      stage: r.stage,
      stageChangedAt: r.stage_changed_at,
      estimateCents: r.estimated_annual_value_cents === null ? null : Number(r.estimated_annual_value_cents),
      signedAt: r.signed_at,
      partnerOrganisationName: r.partner_organisation_name,
      partnerContactName: r.partner_contact_name,
      assignedToId: r.assigned_to,
      assignedToName: r.assigned_to_name,
      otherClaims: Number(r.other_claims ?? 0),
      source: r.source ?? "other",
      nextAction: r.next_action,
      nextActionDue: r.next_action_due,
      needsAttention: r.needs_attention ?? false,
    });
  }

  // Open stages: the longest-waiting first. Signed and lost: the most recent first.
  const recentFirst = new Set<string>(COLLAPSED_STAGES);
  cards.sort((a, b) => {
    if (a.stage !== b.stage) return STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    const x = Date.parse(a.stageChangedAt ?? "") || 0;
    const y = Date.parse(b.stageChangedAt ?? "") || 0;
    return recentFirst.has(a.stage) ? y - x : x - y;
  });

  return ok({ cards, truncated: (res.data ?? []).length >= PIPELINE_LIMIT });
}

// ── the "record a referral" form ─────────────────────────────

export type ExistingOpportunityChoice = { value: string; label: string };

/**
 * Prospects already in the pipeline, for attaching a further introduction to. One entry per
 * opportunity, labelled with the suburb, the stage and who is credited. Newest activity first.
 */
export async function existingOpportunityChoices(db: HqClient, stageLabel: (stage: string) => string, limit = 300): Promise<ExistingOpportunityChoice[]> {
  const { data, error } = await db
    .from("referral_overview")
    .select("opportunity_id, prospect_name, property_suburb, stage, stage_changed_at, partner_organisation_name, partner_contact_name")
    .eq("direction", "received")
    .eq("is_attributed", true)
    .not("opportunity_id", "is", null)
    .order("stage_changed_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[hq] existingOpportunityChoices failed:", logTag(error));
    return [];
  }
  const out: ExistingOpportunityChoice[] = [];
  for (const r of data ?? []) {
    if (!r.opportunity_id || !r.prospect_name) continue;
    const place = r.property_suburb ? `, ${r.property_suburb}` : "";
    const credited = r.partner_organisation_name ?? r.partner_contact_name;
    const detail = [r.stage ? stageLabel(r.stage) : null, credited ? `credited to ${credited}` : null].filter(Boolean).join(", ");
    out.push({ value: r.opportunity_id, label: `${r.prospect_name}${place}${detail ? ` (${detail})` : ""}` });
  }
  return out;
}
