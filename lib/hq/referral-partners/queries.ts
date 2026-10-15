import "server-only";

import { PARTNER_CATEGORIES, RELATIONSHIP_STATUSES } from "../constants";
import type { HqClient, ViewRow } from "../db";
import { logTag } from "../growth/db-errors";
import {
  LIST_PAGE_SIZE,
  PARTNER_LIST_SORT_COLUMNS,
  PARTNER_QUIET_DAYS,
  orIlike,
  pageRange,
  parsePartnerListParams,
  partnerNullsFirst,
  type PartnerListQuery,
  type RawParams,
} from "../growth/params";
import type { Loaded } from "../growth/types";
import { toReferralPartner, type ReferralPartner } from "./types";

/*
 * Reads for the Referral partners page (/hq/growth/partners) and the organisation page's partner
 * summary. Everything comes from hq.referral_partner_overview (migration 0122), run as the
 * signed-in person: row level security decides what comes back, and a person without growth.read
 * reads nothing. Only error codes are logged, never personal data.
 */

export function partnerListQuery(sp: RawParams): PartnerListQuery {
  return parsePartnerListParams(sp, { categories: PARTNER_CATEGORIES, statuses: RELATIONSHIP_STATUSES });
}

/** "Not contacted in 30 days, or never", as a PostgREST condition list. */
const QUIET_CONDITION = `days_since_contact.is.null,days_since_contact.gt.${PARTNER_QUIET_DAYS}`;

export type PartnerPage = { rows: ReferralPartner[]; total: number; page: number };

export async function listReferralPartners(db: HqClient, query: PartnerListQuery, ctx: { staffId: string }): Promise<Loaded<PartnerPage>> {
  const run = (page: number) => {
    let q = db.from("referral_partner_overview").select("*", { count: "exact" }).eq("partner_kind", query.kind);
    // Two either/or groups (search, quiet) must BOTH hold, so they are nested under one and().
    const search = orIlike(["name", "primary_contact_name"], query.q);
    const quiet = query.quiet ? QUIET_CONDITION : null;
    if (search && quiet) q = q.or(`and(or(${search}),or(${quiet}))`);
    else if (search || quiet) q = q.or((search ?? quiet) as string);
    if (query.category) q = q.contains("categories", [query.category as (typeof PARTNER_CATEGORIES)[number]]);
    if (query.status) q = q.eq("relationship_status", query.status as (typeof RELATIONSHIP_STATUSES)[number]);
    if (query.owner) {
      if (query.owner.kind === "none") q = q.is("relationship_owner_id", null);
      else q = q.eq("relationship_owner_id", query.owner.kind === "me" ? ctx.staffId : query.owner.id);
    }
    if (query.referred === "yes") q = q.gt("referrals_received", 0);
    if (query.referred === "no") q = q.eq("referrals_received", 0);
    if (query.verify === "needs") q = q.eq("needs_verification", true);
    const column = PARTNER_LIST_SORT_COLUMNS[query.sort];
    q = q.order(column, { ascending: query.dir === "asc", nullsFirst: partnerNullsFirst(query.sort, query.dir) });
    if (column !== "name") q = q.order("name");
    const { from, to } = pageRange(page, LIST_PAGE_SIZE);
    return q.order("id").range(from, to);
  };

  let page = query.page;
  let result = await run(page);
  if (result.error && result.error.code === "PGRST103" && page > 1) {
    // A page past the end is not a failure: show the first page instead.
    page = 1;
    result = await run(page);
  }
  if (result.error) {
    console.error("[hq] listReferralPartners failed:", logTag(result.error));
    return { ok: false };
  }
  const rows = (result.data ?? []).map(toReferralPartner).filter((r): r is ReferralPartner => r !== null);
  return { ok: true, data: { rows, total: result.count ?? rows.length, page } };
}

export type PartnerSummary = {
  partners: number;
  contactedRecently: number;
  neverContacted: number;
  haveReferred: number;
  referralsReceived: number;
  managementsSigned: number;
};

/** The figures across the top of the page, for one kind of partner. Every number is a count of real rows. */
export async function referralPartnerSummary(db: HqClient, kind: PartnerListQuery["kind"]): Promise<Loaded<PartnerSummary>> {
  const head = () => db.from("referral_partner_overview").select("id", { count: "exact", head: true }).eq("partner_kind", kind);
  const [all, recent, never, referred, figures] = await Promise.all([
    head(),
    head().lte("days_since_contact", PARTNER_QUIET_DAYS),
    head().is("last_contacted_at", null),
    head().gt("referrals_received", 0),
    // Only the partners with any referral carry a figure to add up.
    db.from("referral_partner_overview").select("referrals_received, managements_signed").eq("partner_kind", kind).gt("referrals_received", 0).limit(10_000),
  ]);
  const failed = [all, recent, never, referred, figures].find((r) => r.error);
  if (failed?.error) {
    console.error("[hq] referralPartnerSummary failed:", logTag(failed.error));
    return { ok: false };
  }
  let received = 0;
  let signed = 0;
  for (const r of figures.data ?? []) {
    received += Number(r.referrals_received ?? 0);
    signed += Number(r.managements_signed ?? 0);
  }
  return {
    ok: true,
    data: {
      partners: all.count ?? 0,
      contactedRecently: recent.count ?? 0,
      neverContacted: never.count ?? 0,
      haveReferred: referred.count ?? 0,
      referralsReceived: received,
      managementsSigned: signed,
    },
  };
}

/** One partner's row: an organisation by its id, or an independent contact by theirs. */
export async function getReferralPartner(db: HqClient, id: string): Promise<Loaded<ReferralPartner | null>> {
  const { data, error } = await db.from("referral_partner_overview").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getReferralPartner failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: data ? toReferralPartner(data as ViewRow<"referral_partner_overview">) : null };
}

/** How many partners of each kind, for the Organisations / Independent contacts tabs. Null when the count failed. */
export async function referralPartnerKindCounts(db: HqClient): Promise<{ organisation: number | null; independent: number | null }> {
  const count = (kind: PartnerListQuery["kind"]) => db.from("referral_partner_overview").select("id", { count: "exact", head: true }).eq("partner_kind", kind);
  const [org, indie] = await Promise.all([count("organisation"), count("independent")]);
  if (org.error || indie.error) console.error("[hq] referralPartnerKindCounts failed:", logTag(org.error ?? indie.error));
  return { organisation: org.error ? null : (org.count ?? 0), independent: indie.error ? null : (indie.count ?? 0) };
}
