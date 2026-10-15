import "server-only";

import type { HqClient } from "../db";
import { isUuid, likeValue } from "../forms";
import type { TaskPriority, TaskStatus } from "../constants";
import { logTag } from "./db-errors";
import { plainQuery, taskOrdering, type PredicateContext, type TaskPredicate, buildPredicate } from "./rules";
import type { AuditRow } from "./activity";
import type { SortDir, SortKey, TaskViewKey } from "./rules";
import type { RelatedRef, Result, TaskDetail, TaskListItem, TaskPage, TaskRelated } from "./types";

/*
 * Reads for the task screens. Every query runs as the signed-in person (the typed `hqClient`
 * with their own token), so row level security is the control: a task you cannot see is simply
 * absent. Archived tasks are always filtered out here (`deleted_at is null`), because the
 * policy lets growth.delete holders SEE archived rows and a list should not show them.
 *
 * Nothing here logs more than an error code.
 */

const LIST_COLUMNS =
  "id, title, status, priority, due_date, assigned_to, related_contact_id, related_organisation_id, related_referral_id, related_opportunity_id, related_contractor_id, completed_at, created_at";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, description, created_by, completed_by, updated_at, source`;

type ListRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assigned_to: string | null;
  related_contact_id: string | null;
  related_organisation_id: string | null;
  related_referral_id: string | null;
  related_opportunity_id: string | null;
  related_contractor_id: string | null;
  completed_at: string | null;
  created_at: string;
};
type DetailRow = ListRow & {
  description: string | null;
  created_by: string | null;
  completed_by: string | null;
  updated_at: string;
  source: string;
};

/** The base query: live tasks, with the predicate applied. Every value reaches the database as a bound parameter or an allowlisted operator. */
function filteredTasks(db: HqClient, p: TaskPredicate, options?: { count: "exact"; head: boolean }) {
  let q = db.from("tasks").select(LIST_COLUMNS, options).is("deleted_at", null);

  if (p.statuses.length > 0) q = q.in("status", p.statuses);

  switch (p.assignee.kind) {
    case "is":
      q = q.eq("assigned_to", p.assignee.id);
      break;
    case "not":
      // Someone else's, or nobody's. The id comes from the session or a validated uuid.
      if (!isUuid(p.assignee.id)) throw new Error("tasks: assignee is not a uuid");
      q = q.or(`assigned_to.is.null,assigned_to.neq.${p.assignee.id}`);
      break;
    case "none":
      q = q.is("assigned_to", null);
      break;
    case "any":
      break;
  }
  if (p.createdBy) q = q.eq("created_by", p.createdBy);

  if (p.due?.eq) q = q.eq("due_date", p.due.eq);
  if (p.due?.lt) q = q.lt("due_date", p.due.lt);
  if (p.due?.gt) q = q.gt("due_date", p.due.gt);
  if (p.due?.lte) q = q.lte("due_date", p.due.lte);
  if (p.completedSince) q = q.gte("completed_at", p.completedSince);
  if (p.priority) q = q.eq("priority", p.priority);

  switch (p.related) {
    case "contact":
      q = q.not("related_contact_id", "is", null);
      break;
    case "organisation":
      q = q.not("related_organisation_id", "is", null);
      break;
    case "referral":
      q = q.not("related_referral_id", "is", null);
      break;
    case "opportunity":
      q = q.not("related_opportunity_id", "is", null);
      break;
    case "contractor":
      q = q.not("related_contractor_id", "is", null);
      break;
    case "none":
      q = q
        .is("related_contact_id", null)
        .is("related_organisation_id", null)
        .is("related_referral_id", null)
        .is("related_opportunity_id", null)
        .is("related_contractor_id", null);
      break;
    default:
      break;
  }

  // `%`, `_`, `\`, commas and brackets are escaped, so a title search is literal text. PostgREST reads
  // `*` in a like pattern as "anything", so a typed asterisk is turned into the one-character
  // wildcard instead of matching every task.
  if (p.title) q = q.ilike("title", `%${likeValue(p.title).replace(/\*/g, "_")}%`);
  return q;
}

// ── counts ───────────────────────────────────────────────────

export async function countTasks(db: HqClient, predicate: TaskPredicate): Promise<number | null> {
  const { count, error } = await filteredTasks(db, predicate, { count: "exact", head: true });
  if (error) {
    console.error("[hq] tasks count failed:", logTag(error));
    return null;
  }
  return count ?? 0;
}

/** One real count per tab, each from the same predicate its list uses. null = that count could not be loaded. */
export async function viewCounts(db: HqClient, views: readonly TaskViewKey[], ctx: PredicateContext): Promise<Record<string, number | null>> {
  const entries = await Promise.all(views.map(async (v) => [v, await countTasks(db, buildPredicate(plainQuery(v), ctx))] as const));
  return Object.fromEntries(entries);
}

// ── names and related records ────────────────────────────────

/** Staff names by id, for assignees, creators and completers (all staff are readable with people.read). */
export async function staffNames(db: HqClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i && isUuid(i)))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await db.from("staff_profiles").select("id, full_name").in("id", unique);
  if (error) {
    console.error("[hq] staff names failed:", logTag(error));
    return out;
  }
  for (const s of data ?? []) out.set(s.id, s.full_name);
  return out;
}

type Labels = {
  contacts: Map<string, string>;
  organisations: Map<string, string>;
  referrals: Map<string, string>;
  opportunities: Map<string, string>;
  contractors: Map<string, string>;
};

const uniq = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))];

type LinkIds = { contacts: string[]; organisations: string[]; referrals: string[]; opportunities: string[]; contractors: string[] };

function idsOf(rows: readonly ListRow[]): LinkIds {
  return {
    contacts: uniq(rows.map((r) => r.related_contact_id)),
    organisations: uniq(rows.map((r) => r.related_organisation_id)),
    referrals: uniq(rows.map((r) => r.related_referral_id)),
    opportunities: uniq(rows.map((r) => r.related_opportunity_id)),
    contractors: uniq(rows.map((r) => r.related_contractor_id)),
  };
}

/**
 * Names for the records the tasks link to. Only people who can read growth data get contact, organisation,
 * referral and opportunity names, and only people with contractors.read get contractor names; for everyone
 * else the labels stay null.
 */
async function relatedLabels(db: HqClient, ids: LinkIds, canGrowth: boolean, canContractors = false): Promise<Labels> {
  const labels: Labels = { contacts: new Map(), organisations: new Map(), referrals: new Map(), opportunities: new Map(), contractors: new Map() };
  const contactIds = canGrowth ? ids.contacts : [];
  const orgIds = canGrowth ? ids.organisations : [];
  const referralIds = canGrowth ? ids.referrals : [];
  const opportunityIds = canGrowth ? ids.opportunities : [];
  const contractorIds = canContractors ? ids.contractors : [];

  await Promise.all([
    contactIds.length === 0
      ? null
      : db
          .from("contacts")
          .select("id, full_name")
          .in("id", contactIds)
          .then(({ data, error }) => {
            if (error) console.error("[hq] task contact names failed:", logTag(error));
            for (const c of data ?? []) labels.contacts.set(c.id, c.full_name);
          }),
    orgIds.length === 0
      ? null
      : db
          .from("organisations")
          .select("id, name")
          .in("id", orgIds)
          .then(({ data, error }) => {
            if (error) console.error("[hq] task organisation names failed:", logTag(error));
            for (const o of data ?? []) labels.organisations.set(o.id, o.name);
          }),
    referralIds.length === 0
      ? null
      : db
          .from("referral_overview")
          .select("id, ref_label")
          .in("id", referralIds)
          .then(({ data, error }) => {
            if (error) console.error("[hq] task referral labels failed:", logTag(error));
            for (const r of data ?? []) if (r.id && r.ref_label) labels.referrals.set(r.id, r.ref_label);
          }),
    contractorIds.length === 0
      ? null
      : db
          .from("contractor_directory")
          .select("id, business_name")
          .in("id", contractorIds)
          .then(({ data, error }) => {
            if (error) console.error("[hq] task contractor names failed:", logTag(error));
            for (const c of data ?? []) if (c.id && c.business_name) labels.contractors.set(c.id, c.business_name);
          }),
    opportunityIds.length === 0
      ? null
      : db
          .from("opportunities")
          .select("id, display_number, prospect_name")
          .in("id", opportunityIds)
          .then(({ data, error }) => {
            if (error) console.error("[hq] task opportunity labels failed:", logTag(error));
            for (const o of data ?? []) labels.opportunities.set(o.id, o.prospect_name ? o.prospect_name : `Opportunity ${o.display_number}`);
          }),
  ]);
  return labels;
}

function ref(id: string | null, labels: Map<string, string>): RelatedRef | null {
  return id ? { id, label: labels.get(id) ?? null } : null;
}

function relatedOf(row: ListRow, labels: Labels): TaskRelated {
  return {
    contact: ref(row.related_contact_id, labels.contacts),
    organisation: ref(row.related_organisation_id, labels.organisations),
    referral: ref(row.related_referral_id, labels.referrals),
    opportunity: ref(row.related_opportunity_id, labels.opportunities),
    contractor: ref(row.related_contractor_id, labels.contractors),
  };
}

function toListItem(row: ListRow, names: Map<string, string>, labels: Labels): TaskListItem {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to ? (names.get(row.assigned_to) ?? null) : null,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    related: relatedOf(row, labels),
  };
}

// ── the list ─────────────────────────────────────────────────

export async function listTasks(
  db: HqClient,
  predicate: TaskPredicate,
  opts: { sort: SortKey; dir: SortDir; page: number; pageSize: number; canGrowth: boolean; canContractors?: boolean },
): Promise<Result<TaskPage>> {
  const total = await countTasks(db, predicate);
  if (total === null) return { ok: false };
  if (total === 0) return { ok: true, data: { rows: [], total: 0, page: 1 } };

  const last = Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), last);
  const from = (page - 1) * opts.pageSize;

  let q = filteredTasks(db, predicate);
  for (const t of taskOrdering(opts.sort, opts.dir)) q = q.order(t.column, { ascending: t.ascending, nullsFirst: t.nullsFirst });
  const { data, error } = await q.range(from, from + opts.pageSize - 1);
  if (error) {
    console.error("[hq] tasks list failed:", logTag(error));
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as ListRow[];
  const [names, labels] = await Promise.all([
    staffNames(db, rows.map((r) => r.assigned_to)),
    relatedLabels(db, idsOf(rows), opts.canGrowth, opts.canContractors),
  ]);
  return { ok: true, data: { rows: rows.map((r) => toListItem(r, names, labels)), total, page } };
}

// ── one task ─────────────────────────────────────────────────

/** A task the person can see, or null when it does not exist, is archived, or is not theirs to see (the same answer for all three). */
export async function getTask(db: HqClient, id: string, opts: { canGrowth: boolean; canContractors?: boolean }): Promise<Result<TaskDetail | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const { data, error } = await db.from("tasks").select(DETAIL_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) {
    console.error("[hq] task load failed:", logTag(error));
    return { ok: false };
  }
  if (!data) return { ok: true, data: null };
  const row = data as unknown as DetailRow;
  const [names, labels] = await Promise.all([
    staffNames(db, [row.assigned_to, row.created_by, row.completed_by]),
    relatedLabels(db, idsOf([row]), opts.canGrowth, opts.canContractors),
  ]);
  const base = toListItem(row, names, labels);
  return {
    ok: true,
    data: {
      ...base,
      description: row.description,
      createdBy: row.created_by,
      createdByName: row.created_by ? (names.get(row.created_by) ?? null) : null,
      completedBy: row.completed_by,
      completedByName: row.completed_by ? (names.get(row.completed_by) ?? null) : null,
      updatedAt: row.updated_at,
      source: row.source,
    },
  };
}

/** The audit trail for one task, newest first. Only people holding audit.read get rows back (the policy decides); null means it could not be loaded. */
export async function taskAudit(db: HqClient, id: string): Promise<AuditRow[] | null> {
  const { data, error } = await db
    .from("audit_events")
    .select("id, at, actor_id, actor_name, action, changes")
    .eq("entity_type", "task")
    .eq("entity_id", id)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[hq] task audit failed:", logTag(error));
    return null;
  }
  return (data ?? []) as unknown as AuditRow[];
}

// ── the New task form's prefill ──────────────────────────────

/**
 * The records a "New task" link points at, kept only when they exist AND this person can read
 * them. An id that is unknown, archived or hidden by row level security is dropped (the task
 * will not be linked to it), and people without growth.read get nothing back at all.
 */
export async function prefillRelated(
  db: HqClient,
  prefill: { contact: string | null; organisation: string | null; referral: string | null; opportunity: string | null; contractor?: string | null },
  canGrowth: boolean,
  canContractors = false,
): Promise<TaskRelated> {
  const none: TaskRelated = { contact: null, organisation: null, referral: null, opportunity: null, contractor: null };
  if (!canGrowth && !canContractors) return none;
  const labels = await relatedLabels(
    db,
    {
      contacts: prefill.contact ? [prefill.contact] : [],
      organisations: prefill.organisation ? [prefill.organisation] : [],
      referrals: prefill.referral ? [prefill.referral] : [],
      opportunities: prefill.opportunity ? [prefill.opportunity] : [],
      contractors: prefill.contractor ? [prefill.contractor] : [],
    },
    canGrowth,
    canContractors,
  );
  const found = (id: string | null, map: Map<string, string>): RelatedRef | null => (id && map.has(id) ? { id, label: map.get(id) ?? null } : null);
  return {
    contact: found(prefill.contact, labels.contacts),
    organisation: found(prefill.organisation, labels.organisations),
    referral: found(prefill.referral, labels.referrals),
    opportunity: found(prefill.opportunity, labels.opportunities),
    contractor: found(prefill.contractor ?? null, labels.contractors),
  };
}
