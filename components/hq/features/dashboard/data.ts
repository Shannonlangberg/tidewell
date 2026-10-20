import "server-only";

import { requireStaff } from "@/lib/hq/auth";
import type { HqClient } from "@/lib/hq/db";
import { OPEN_STAGES, type Capability, type InteractionType, type OpportunityStage } from "@/lib/hq/constants";

/*
 * Everything the Reports panels read, as plain typed loaders. Every one runs AS the signed-in
 * person through `db`, so row level security decides what comes back: a person who may
 * not read contacts gets zero rows whatever they ask for. Reports also hides panels
 * the person cannot use, but that is a courtesy; this is the control.
 *
 * A loader THROWS on a database error (with a code only, never personal data) and the widget
 * that called it shows an error state, so one failing query never breaks the page.
 */

export type DashCtx = {
  staffId: string;
  /** The person's own timezone: for showing moments. */
  timezone: string;
  /** Today in the BUSINESS timezone (hq.today()): the day follow-ups and due dates are judged against. */
  today: string;
  capabilities: readonly Capability[];
};

/**
 * DashCtx is handed to Server Components as a prop, so it is PLAIN DATA on purpose. A database client
 * or a function in a prop cannot be serialised for React's development debug stream, and the page
 * fails with "Invalid reference". The client is fetched here instead (requireStaff is cached per request).
 */
export const hasCap = (ctx: DashCtx, capability: Capability): boolean => ctx.capabilities.includes(capability);

async function dbForCaller(): Promise<HqClient> {
  return (await requireStaff()).db;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// ── opportunities ────────────────────────────────────────────

export type OpenStage = Exclude<OpportunityStage, "management_signed" | "lost">;

export async function loadOpenStageCounts(): Promise<Record<OpenStage, number>> {
  const db = await dbForCaller();
  const { data, error } = await db
    .from("opportunities")
    .select("stage")
    .is("deleted_at", null)
    .in("stage", [...OPEN_STAGES])
    .limit(5000);
  if (error) throw new Error(`opportunities ${error.code}`);
  const counts = Object.fromEntries((OPEN_STAGES as readonly OpenStage[]).map((s) => [s, 0])) as Record<OpenStage, number>;
  for (const row of data ?? []) {
    if (row.stage in counts) counts[row.stage as OpenStage] += 1;
  }
  return counts;
}

/** id -> first name, for the ids given. Staff are visible to every member of staff (people.read). */
async function staffNames(db: HqClient, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await db.from("staff_profiles").select("id, first_name").in("id", unique);
  if (error) throw new Error(`staff names ${error.code}`);
  for (const s of data ?? []) out.set(s.id, s.first_name);
  return out;
}

// ── recent interactions ──────────────────────────────────────

export type RecentInteraction = {
  id: string;
  type: InteractionType;
  occurredAt: string;
  summary: string;
  contactId: string | null;
  contactName: string | null;
  organisationId: string | null;
  organisationName: string | null;
  staffName: string | null;
};

export async function loadRecentInteractions(limit = 6): Promise<RecentInteraction[]> {
  const db = await dbForCaller();
  const { data, error } = await db
    .from("interactions")
    .select("id, contact_id, organisation_id, interaction_type, occurred_at, summary, staff_id")
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`interactions ${error.code}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const contactIds = [...new Set(rows.map((r) => r.contact_id).filter((i): i is string => !!i))];
  const [contacts, staff] = await Promise.all([
    contactIds.length > 0
      ? db.from("contact_directory").select("id, full_name, organisation_id, organisation_name").in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    staffNames(db, rows.map((r) => r.staff_id)),
  ]);
  if (contacts.error) throw new Error(`interaction contacts ${contacts.error.code}`);
  const contactById = new Map<string, { name: string; orgId: string | null; orgName: string | null }>();
  for (const c of contacts.data ?? []) {
    if (c.id && c.full_name) contactById.set(c.id, { name: c.full_name, orgId: c.organisation_id, orgName: c.organisation_name });
  }

  const orgIds = [...new Set(rows.filter((r) => !r.contact_id && r.organisation_id).map((r) => r.organisation_id as string))];
  const orgNames = new Map<string, string>();
  if (orgIds.length > 0) {
    const orgs = await db.from("organisation_directory").select("id, name").in("id", orgIds);
    if (orgs.error) throw new Error(`interaction organisations ${orgs.error.code}`);
    for (const o of orgs.data ?? []) if (o.id && o.name) orgNames.set(o.id, o.name);
  }

  return rows.map((r) => {
    const contact = r.contact_id ? contactById.get(r.contact_id) : undefined;
    return {
      id: r.id,
      type: r.interaction_type,
      occurredAt: r.occurred_at,
      summary: r.summary,
      contactId: r.contact_id,
      contactName: contact?.name ?? null,
      organisationId: contact?.orgId ?? r.organisation_id,
      organisationName: contact?.orgName ?? (r.organisation_id ? (orgNames.get(r.organisation_id) ?? null) : null),
      staffName: r.staff_id ? (staff.get(r.staff_id) ?? null) : null,
    };
  });
}

// ── referral partners ────────────────────────────────────────

export type PartnerRow = { id: string; name: string; received: number; sent: number; signed: number };

export async function loadTopPartners(limit = 6): Promise<PartnerRow[]> {
  const db = await dbForCaller();
  const { data, error } = await db
    .from("partner_performance")
    .select("organisation_id, organisation_name, received, sent, signed")
    .or("received.gt.0,sent.gt.0")
    .order("received", { ascending: false })
    .order("signed", { ascending: false })
    .order("organisation_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`partner performance ${error.code}`);
  const out: PartnerRow[] = [];
  for (const r of data ?? []) {
    if (!r.organisation_id || !r.organisation_name) continue;
    out.push({ id: r.organisation_id, name: r.organisation_name, received: num(r.received), sent: num(r.sent), signed: num(r.signed) });
  }
  return out;
}
