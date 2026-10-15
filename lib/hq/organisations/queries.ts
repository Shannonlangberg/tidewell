import "server-only";

import { PARTNER_CATEGORIES } from "../constants";
import type { HqClient } from "../db";
import {
  LIST_PAGE_SIZE,
  ORGANISATION_SORT_COLUMNS,
  lastPage,
  orIlike,
  pageRange,
  parseOrganisationListParams,
  type OrganisationListQuery,
  type RawParams,
} from "../growth/params";
import { logTag } from "../growth/db-errors";
import { toContact, toOrganisation, type Contact, type Loaded, type Organisation } from "../growth/types";

/*
 * Reads for the organisations list and detail page. Run as the signed-in person; row level
 * security decides what comes back. Nothing here logs personal data, only the error code.
 */

export function organisationListQuery(sp: RawParams): OrganisationListQuery {
  return parseOrganisationListParams(sp, { categories: PARTNER_CATEGORIES });
}

export type ReferralCounts = { received: number; sent: number; signed: number };

export type OrganisationPage = {
  rows: Organisation[];
  total: number;
  page: number;
  /** Referral counts per organisation id, from partner_performance. */
  referrals: Record<string, ReferralCounts>;
};

export async function listOrganisations(db: HqClient, query: OrganisationListQuery, ctx: { staffId: string }): Promise<Loaded<OrganisationPage>> {
  const run = async (page: number) => {
    let q = db.from("organisation_directory").select("*", { count: "exact" });
    const search = orIlike(["name"], query.q);
    if (search) q = q.or(search);
    if (query.category) q = q.contains("categories", [query.category]);
    if (query.region) q = q.eq("service_region", query.region);
    if (query.owner) {
      if (query.owner.kind === "none") q = q.is("relationship_owner_id", null);
      else q = q.eq("relationship_owner_id", query.owner.kind === "me" ? ctx.staffId : query.owner.id);
    }
    if (query.verify) q = q.eq("needs_verification", query.verify === "needs");
    q = q.order(ORGANISATION_SORT_COLUMNS[query.sort], { ascending: query.dir === "asc", nullsFirst: false }).order("id", { ascending: true });
    const { from, to } = pageRange(page, LIST_PAGE_SIZE);
    return q.range(from, to);
  };

  let page = query.page;
  let result = await run(page);
  if (result.error && result.error.code === "PGRST103") {
    const head = await db.from("organisation_directory").select("id", { count: "exact", head: true });
    page = lastPage(head.count ?? 0, LIST_PAGE_SIZE);
    result = await run(page);
  }
  if (result.error) {
    console.error("[hq] listOrganisations failed:", logTag(result.error));
    return { ok: false };
  }
  const rows = (result.data ?? []).map(toOrganisation).filter((o): o is Organisation => o !== null);

  const referrals: Record<string, ReferralCounts> = {};
  if (rows.length > 0) {
    const perf = await db
      .from("partner_performance")
      .select("organisation_id, received, sent, signed")
      .in(
        "organisation_id",
        rows.map((r) => r.id),
      );
    if (perf.error) {
      console.error("[hq] partner_performance failed:", logTag(perf.error));
    } else {
      for (const p of perf.data ?? []) {
        if (p.organisation_id) referrals[p.organisation_id] = { received: Number(p.received ?? 0), sent: Number(p.sent ?? 0), signed: Number(p.signed ?? 0) };
      }
    }
  }
  return { ok: true, data: { rows, total: result.count ?? rows.length, page, referrals } };
}

export async function organisationRegionChoices(db: HqClient): Promise<string[]> {
  const { data, error } = await db.from("organisation_directory").select("service_region").not("service_region", "is", null).limit(2000);
  if (error) {
    console.error("[hq] organisationRegionChoices failed:", logTag(error));
    return [];
  }
  const set = new Set<string>();
  for (const r of data ?? []) if (r.service_region) set.add(r.service_region);
  return [...set].sort((a, b) => a.localeCompare(b, "en-AU"));
}

export async function getOrganisation(db: HqClient, id: string): Promise<Loaded<Organisation | null>> {
  const { data, error } = await db.from("organisation_directory").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getOrganisation failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: data ? toOrganisation(data) : null };
}

/** Every live contact at an organisation: the primary first, then by name. */
export async function organisationContacts(db: HqClient, organisationId: string): Promise<Loaded<Contact[]>> {
  const { data, error } = await db.from("contact_directory").select("*").eq("organisation_id", organisationId).order("full_name").limit(200);
  if (error) {
    console.error("[hq] organisationContacts failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []).map(toContact).filter((c): c is Contact => c !== null);
  rows.sort((a, b) => Number(b.orgContactRole === "primary") - Number(a.orgContactRole === "primary"));
  return { ok: true, data: rows };
}
