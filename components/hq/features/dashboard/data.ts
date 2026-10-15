import "server-only";

import { cache } from "react";
import { requireStaff } from "@/lib/hq/auth";
import type { Json } from "@/lib/hq/database.types";
import type { HqClient } from "@/lib/hq/db";
import {
  OPEN_STAGES,
  OPEN_TASK_STATUSES,
  type Capability,
  type InteractionType,
  type OpportunityStage,
  type RelationshipStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/hq/constants";
import { addDays } from "@/lib/hq/periods";

/*
 * Everything the dashboard reads, as plain typed loaders. Every one runs AS the signed-in
 * person through `db`, so row level security decides what comes back: a person who may
 * not read contacts gets zero rows whatever they ask for. The dashboard also hides widgets
 * the person cannot use, but that is a courtesy; this is the control.
 *
 * A loader THROWS on a database error (with a code only, never personal data) and the widget
 * that called it shows an error state, so one failing query never breaks the page.
 *
 * Several widgets share a query (growth_summary feeds the figures band and others), so the
 * shared ones are memoised for the length of one request with React's cache(), keyed on the
 * `ctx` object the page creates once.
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

// ── growth_summary ───────────────────────────────────────────

export type GrowthSummary = {
  since: string;
  managementsSigned: number;
  referralsReceived: number;
  referralsSent: number;
  /** null when no referral was received in the window: conversion is not 0%, it is undefined. */
  conversion: number | null;
};

export function parseGrowthSummary(json: Json | null): GrowthSummary {
  const o = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  return {
    since: typeof o.since === "string" ? o.since : "",
    managementsSigned: num(o.managements_signed),
    referralsReceived: num(o.referrals_received),
    referralsSent: num(o.referrals_sent),
    conversion: typeof o.conversion === "number" && Number.isFinite(o.conversion) ? o.conversion : null,
  };
}

export const loadGrowthSummary = cache(async (since: string): Promise<GrowthSummary> => {
  const db = await dbForCaller();
  const { data, error } = await db.rpc("growth_summary", { p_since: since });
  if (error) throw new Error(`growth_summary ${error.code}`);
  return parseGrowthSummary(data);
});

// ── contacts ─────────────────────────────────────────────────

export type ContactCounts = { total: number; needsVerification: number; contacted: number; organisations: number };

export const loadContactCounts = cache(async (): Promise<ContactCounts> => {
  const db = await dbForCaller();
  const head = { count: "exact", head: true } as const;
  const [total, verify, contacted, orgs] = await Promise.all([
    db.from("contact_directory").select("id", head),
    db.from("contact_directory").select("id", head).eq("needs_verification", true),
    db.from("contact_directory").select("id", head).not("last_contact_at", "is", null),
    db.from("organisation_directory").select("id", head),
  ]);
  for (const r of [total, verify, contacted, orgs]) {
    if (r.error) throw new Error(`contact counts ${r.error.code}`);
  }
  return {
    total: total.count ?? 0,
    needsVerification: verify.count ?? 0,
    contacted: contacted.count ?? 0,
    organisations: orgs.count ?? 0,
  };
});

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

// ── follow-ups: who to call ──────────────────────────────────

export type FollowUp = {
  id: string;
  name: string;
  organisation: string | null;
  status: RelationshipStatus;
  dueDate: string;
};

/** Overdue and due within the next seven days, oldest first, inactive contacts left out. */
export async function loadFollowUps(ctx: DashCtx, limit = 8): Promise<{ items: FollowUp[]; total: number }> {
  const db = await dbForCaller();
  const { data, error, count } = await db
    .from("contact_directory")
    .select("id, full_name, organisation_name, relationship_status, next_follow_up_date", { count: "exact" })
    .not("next_follow_up_date", "is", null)
    .lte("next_follow_up_date", addDays(ctx.today, 7))
    .neq("relationship_status", "inactive")
    .order("next_follow_up_date", { ascending: true })
    .order("full_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`follow-ups ${error.code}`);
  const items: FollowUp[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.full_name || !r.next_follow_up_date || !r.relationship_status) continue;
    items.push({
      id: r.id,
      name: r.full_name,
      organisation: r.organisation_name,
      status: r.relationship_status,
      dueDate: r.next_follow_up_date,
    });
  }
  return { items, total: count ?? items.length };
}

// ── contacts not spoken to for 30 days ───────────────────────

export type StaleContact = {
  id: string;
  name: string;
  organisation: string | null;
  status: RelationshipStatus;
  lastContactAt: string | null;
};

export async function loadStaleContacts(limit = 6): Promise<{ items: StaleContact[]; total: number }> {
  const db = await dbForCaller();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error, count } = await db
    .from("contact_directory")
    .select("id, full_name, organisation_name, relationship_status, last_contact_at", { count: "exact" })
    .neq("relationship_status", "inactive")
    .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
    .order("last_contact_at", { ascending: true, nullsFirst: true })
    .order("full_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`stale contacts ${error.code}`);
  const items: StaleContact[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.full_name || !r.relationship_status) continue;
    items.push({
      id: r.id,
      name: r.full_name,
      organisation: r.organisation_name,
      status: r.relationship_status,
      lastContactAt: r.last_contact_at,
    });
  }
  return { items, total: count ?? items.length };
}

// ── tasks ────────────────────────────────────────────────────

export type DashTask = {
  id: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeName: string | null;
};

export type TaskBucket = "overdue" | "today" | "upcoming";

export function bucketFor(dueDate: string | null, today: string): TaskBucket {
  if (!dueDate) return "upcoming";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

/** The person's own open tasks. Overdue first, then today, then the rest by date, undated last. */
export async function loadMyTasks(ctx: DashCtx): Promise<{ tasks: DashTask[]; counts: Record<TaskBucket, number> }> {
  const db = await dbForCaller();
  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_date, priority, status")
    .eq("assigned_to", ctx.staffId)
    .is("deleted_at", null)
    .in("status", [...OPEN_TASK_STATUSES])
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(`my tasks ${error.code}`);
  const tasks: DashTask[] = (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: t.due_date,
    priority: t.priority,
    status: t.status,
    assigneeName: null,
  }));
  const counts: Record<TaskBucket, number> = { overdue: 0, today: 0, upcoming: 0 };
  for (const t of tasks) counts[bucketFor(t.dueDate, ctx.today)] += 1;
  return { tasks, counts };
}

/** Everyone else's open tasks that are overdue or due within the week. Needs tasks.read_all to see beyond your own. */
export async function loadTeamTasks(ctx: DashCtx, limit = 8): Promise<{ items: DashTask[]; total: number }> {
  const db = await dbForCaller();
  const { data, error, count } = await db
    .from("tasks")
    .select("id, title, due_date, priority, status, assigned_to", { count: "exact" })
    .is("deleted_at", null)
    .in("status", [...OPEN_TASK_STATUSES])
    .not("due_date", "is", null)
    .lte("due_date", addDays(ctx.today, 7))
    .or(`assigned_to.is.null,assigned_to.neq.${ctx.staffId}`)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`team tasks ${error.code}`);
  const rows = data ?? [];
  const names = await staffNames(db, rows.map((r) => r.assigned_to));
  return {
    total: count ?? rows.length,
    items: rows.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      priority: t.priority,
      status: t.status,
      assigneeName: t.assigned_to ? (names.get(t.assigned_to) ?? null) : null,
    })),
  };
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
