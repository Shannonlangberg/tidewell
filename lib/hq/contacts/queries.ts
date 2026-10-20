import "server-only";

import {
  OPEN_TASK_STATUSES,
  PARTNER_CATEGORIES,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  type InteractionType,
  type TaskStatus,
} from "../constants";
import type { HqClient } from "../db";
import {
  CONTACT_SORT_COLUMNS,
  LIST_PAGE_SIZE,
  lastPage,
  orIlike,
  pageRange,
  parseContactListParams,
  staleCutoff,
  type ContactListQuery,
  type RawParams,
} from "../growth/params";
import { logTag } from "../growth/db-errors";
import {
  toContact,
  type Contact,
  type InteractionItem,
  type Loaded,
  type ReferralSummary,
  type TaskItem,
} from "../growth/types";

/*
 * Reads for the contacts list and the contact profile. Everything runs as the signed-in person
 * (the `db` from requireStaff), so row level security decides what comes back; the capability
 * check is the page's job, and it happens before any of these are called.
 *
 * Nothing here logs personal data: only the error code.
 */

export function contactListQuery(sp: RawParams): ContactListQuery {
  return parseContactListParams(sp, {
    categories: PARTNER_CATEGORIES,
    statuses: RELATIONSHIP_STATUSES,
    priorities: PRIORITIES,
  });
}

export type ContactPage = {
  rows: Contact[];
  total: number;
  /** The page actually returned (a request past the end is moved back to the last page). */
  page: number;
};

type ListContext = { staffId: string; now?: Date };

export async function listContacts(db: HqClient, query: ContactListQuery, ctx: ListContext): Promise<Loaded<ContactPage>> {
  const now = ctx.now ?? new Date();

  const run = async (page: number) => {
    let q = db.from("contact_directory").select("*", { count: "exact" });

    const search = orIlike(["full_name", "organisation_name", "email"], query.q);
    if (search) q = q.or(search);
    if (query.category) q = q.contains("categories", [query.category]);
    if (query.status) q = q.eq("relationship_status", query.status as (typeof RELATIONSHIP_STATUSES)[number]);
    if (query.priority) q = q.eq("priority", query.priority as (typeof PRIORITIES)[number]);
    if (query.region) q = q.eq("service_region", query.region);
    if (query.owner) {
      if (query.owner.kind === "none") q = q.is("relationship_owner_id", null);
      else q = q.eq("relationship_owner_id", query.owner.kind === "me" ? ctx.staffId : query.owner.id);
    }
    if (query.followUp === "overdue") q = q.eq("follow_up_overdue", true);
    if (query.staleDays) {
      // Matches growth_summary's "not contacted" count: inactive contacts are left out.
      q = q.neq("relationship_status", "inactive").or(`last_contact_at.is.null,last_contact_at.lt.${staleCutoff(query.staleDays, now)}`);
    }
    if (query.verify) q = q.eq("needs_verification", query.verify === "needs");
    if (query.kind !== "all") q = q.eq("contact_kind", query.kind);

    // Sort by the chosen column, then by id so two rows that tie never swap places between pages.
    q = q
      .order(CONTACT_SORT_COLUMNS[query.sort], { ascending: query.dir === "asc", nullsFirst: false })
      .order("id", { ascending: true });

    const { from, to } = pageRange(page, LIST_PAGE_SIZE);
    return q.range(from, to);
  };

  let page = query.page;
  let result = await run(page);

  // A page number past the end (a stale link) is a range error: show the last page instead.
  if (result.error && result.error.code === "PGRST103") {
    const head = await db.from("contact_directory").select("id", { count: "exact", head: true });
    const total = head.count ?? 0;
    page = lastPage(total, LIST_PAGE_SIZE);
    result = await run(page);
  }
  if (result.error) {
    console.error("[hq] listContacts failed:", logTag(result.error));
    return { ok: false };
  }
  const rows = (result.data ?? []).map(toContact).filter((c): c is Contact => c !== null);
  return { ok: true, data: { rows, total: result.count ?? rows.length, page } };
}

export type ContactCounts = { total: number; needsVerification: number; overdue: number; notContacted30: number };

/** The figures above the list: real counts of live contacts, none invented. */
export async function contactCounts(db: HqClient, now: Date = new Date(), kind: ContactListQuery["kind"] = "partner"): Promise<Loaded<ContactCounts>> {
  const count = (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => build(base());
  const base = () => {
    const q = db.from("contact_directory").select("id", { count: "exact", head: true });
    return kind === "all" ? q : q.eq("contact_kind", kind);
  };
  const [total, needs, overdue, stale] = await Promise.all([
    count((q) => q),
    count((q) => q.eq("needs_verification", true)),
    count((q) => q.eq("follow_up_overdue", true)),
    // The same rule as the "not contacted in 30 days" filter: never, or a while ago; inactive left out.
    count((q) => q.neq("relationship_status", "inactive").or(`last_contact_at.is.null,last_contact_at.lt.${staleCutoff(30, now)}`)),
  ]);
  const failed = [total, needs, overdue, stale].find((r) => r.error);
  if (failed?.error) {
    console.error("[hq] contactCounts failed:", logTag(failed.error));
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      total: total.count ?? 0,
      needsVerification: needs.count ?? 0,
      overdue: overdue.count ?? 0,
      notContacted30: stale.count ?? 0,
    },
  };
}

/** Distinct service regions in use, for the region filter. */
export async function regionChoices(db: HqClient): Promise<string[]> {
  const { data, error } = await db.from("contact_directory").select("service_region").not("service_region", "is", null).limit(2000);
  if (error) {
    console.error("[hq] regionChoices failed:", logTag(error));
    return [];
  }
  const set = new Set<string>();
  for (const r of data ?? []) if (r.service_region) set.add(r.service_region);
  return [...set].sort((a, b) => a.localeCompare(b, "en-AU"));
}

// ── the profile ──────────────────────────────────────────────

export async function getContact(db: HqClient, id: string): Promise<Loaded<Contact | null>> {
  const { data, error } = await db.from("contact_directory").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getContact failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: data ? toContact(data) : null };
}

type InteractionRow = {
  id: string;
  contact_id: string | null;
  interaction_type: InteractionType;
  occurred_at: string;
  summary: string;
  next_action: string | null;
  follow_up_date: string | null;
  task_id: string | null;
  staff: { full_name: string } | null;
  contact: { full_name: string } | null;
};

const INTERACTION_SELECT =
  "id, contact_id, interaction_type, occurred_at, summary, next_action, follow_up_date, task_id, staff:staff_profiles(full_name), contact:contacts(full_name)";

function toInteraction(r: InteractionRow): InteractionItem {
  return {
    id: r.id,
    type: r.interaction_type,
    occurredAt: r.occurred_at,
    summary: r.summary,
    nextAction: r.next_action,
    followUpDate: r.follow_up_date,
    taskId: r.task_id,
    staffName: r.staff?.full_name ?? null,
    contactId: r.contact_id,
    contactName: r.contact?.full_name ?? null,
  };
}

export const TIMELINE_LIMIT = 30;

/** Newest first. `limit + 1` rows are read so the page can say "showing the latest N" honestly. */
export async function listInteractions(
  db: HqClient,
  scope: { contactId: string } | { organisationId: string } | { opportunityId: string },
  limit: number = TIMELINE_LIMIT,
): Promise<Loaded<{ items: InteractionItem[]; more: boolean }>> {
  let q = db.from("interactions").select(INTERACTION_SELECT).is("deleted_at", null);
  q = "contactId" in scope ? q.eq("contact_id", scope.contactId) : "organisationId" in scope ? q.eq("organisation_id", scope.organisationId) : q.eq("opportunity_id", scope.opportunityId);
  const { data, error } = await q.order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (error) {
    console.error("[hq] listInteractions failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as InteractionRow[];
  return { ok: true, data: { items: rows.slice(0, limit).map(toInteraction), more: rows.length > limit } };
}

/** The date of the oldest logged interaction with a contact, or null when there is none. */
export async function firstInteractionAt(db: HqClient, contactId: string): Promise<string | null> {
  const { data, error } = await db
    .from("interactions")
    .select("occurred_at")
    .eq("contact_id", contactId)
    .is("deleted_at", null)
    .order("occurred_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[hq] firstInteractionAt failed:", logTag(error));
    return null;
  }
  return data?.[0]?.occurred_at ?? null;
}

/** Everyone else at the same organisation, the primary contact first. */
export async function sameOrganisationContacts(db: HqClient, organisationId: string, excludeId: string): Promise<Loaded<Contact[]>> {
  const { data, error } = await db.from("contact_directory").select("*").eq("organisation_id", organisationId).neq("id", excludeId).order("full_name").limit(50);
  if (error) {
    console.error("[hq] sameOrganisationContacts failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []).map(toContact).filter((c): c is Contact => c !== null);
  rows.sort((a, b) => Number(b.orgContactRole === "primary") - Number(a.orgContactRole === "primary"));
  return { ok: true, data: rows };
}

type PartnerKey = { contactId: string } | { organisationId: string };

/** Referrals credited to a partner: counts and the latest few, read from the flattened referral_overview view. */
export async function referralSummary(db: HqClient, who: PartnerKey): Promise<Loaded<ReferralSummary>> {
  const column = "contactId" in who ? "partner_contact_id" : "partner_organisation_id";
  const value = "contactId" in who ? who.contactId : who.organisationId;

  const [recent, received, sent, signed] = await Promise.all([
    db
      .from("referral_overview")
      .select("id, ref_label, direction, referral_date, prospect_name, stage, sent_outcome, partner_contact_name")
      .eq(column, value)
      .order("referral_date", { ascending: false })
      .order("ref_number", { ascending: false })
      .limit(5),
    db.from("referral_overview").select("id", { count: "exact", head: true }).eq(column, value).eq("direction", "received"),
    db.from("referral_overview").select("id", { count: "exact", head: true }).eq(column, value).eq("direction", "sent"),
    // A signed management counts once, through the referral that was credited with it.
    db
      .from("referral_overview")
      .select("id", { count: "exact", head: true })
      .eq(column, value)
      .eq("direction", "received")
      .eq("is_attributed", true)
      .eq("stage", "management_signed"),
  ]);
  const failed = [recent, received, sent, signed].find((r) => r.error);
  if (failed?.error) {
    console.error("[hq] referralSummary failed:", logTag(failed.error));
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      received: received.count ?? 0,
      sent: sent.count ?? 0,
      signed: signed.count ?? 0,
      recent: (recent.data ?? [])
        .filter((r) => r.id && r.ref_label && r.direction)
        .map((r) => ({
          id: r.id as string,
          refLabel: r.ref_label as string,
          direction: r.direction as "received" | "sent",
          referralDate: r.referral_date,
          prospectName: r.prospect_name,
          stage: r.stage,
          sentOutcome: r.sent_outcome,
          partnerContactName: r.partner_contact_name,
        })),
    },
  };
}

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  status: TaskStatus;
  assignee: { full_name: string } | null;
};

/** Open tasks tied to this contact. Row level security limits them to tasks the person may see. */
export async function openTasksForContact(db: HqClient, contactId: string): Promise<Loaded<TaskItem[]>> {
  const { data, error } = await db
    .from("tasks")
    .select("id, title, due_date, status, assignee:staff_profiles(full_name)")
    .eq("related_contact_id", contactId)
    .in("status", [...OPEN_TASK_STATUSES])
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[hq] openTasksForContact failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as TaskRow[];
  return {
    ok: true,
    data: rows.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, status: t.status, assigneeName: t.assignee?.full_name ?? null })),
  };
}
