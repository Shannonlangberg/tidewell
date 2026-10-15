import "server-only";

import type { HqClient } from "@/lib/hq/db";
import { CLEARED_CONTRACTOR_STATUSES, OPEN_TASK_STATUSES, type TaskPriority } from "@/lib/hq/constants";
import { loadContractorSummary, loadExpiryWatch, type ExpiryItem } from "@/lib/hq/contractors/widgets-data";
import { coverageLabel, coveredTrades } from "@/lib/hq/contractors/widgets-summary";
import { PARTNER_QUIET_DAYS } from "@/lib/hq/growth/params";
import { addDays } from "@/lib/hq/periods";
import { partnerHref } from "@/lib/hq/referral-partners/types";
import { NOT_USED_DAYS } from "@/lib/hq/today";

/*
 * What the Today screen reads. Every loader runs AS the signed-in person through `db`, so row level
 * security decides what comes back; the page only calls a loader when the person's capabilities
 * include its section. A loader THROWS on a database error (code only, never personal data); the
 * page wraps each one so a failing section shows a quiet line and the rest carries on.
 *
 * Nothing new in the database: these are the views the dashboard and the module pages already use
 * (contact_directory, referral_partner_overview, referral_overview, tasks, contractor_expiry_watch,
 * contractor_summary, contractor_directory).
 */

// ── follow-ups due today or overdue ──────────────────────────

export type CallItem = {
  id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  dueDate: string;
  lastContactAt: string | null;
};

/** Contacts whose next follow-up is today or earlier, oldest first. Inactive contacts are left out. */
export async function loadCallToday(db: HqClient, today: string, limit = 8): Promise<{ items: CallItem[]; total: number }> {
  const { data, error, count } = await db
    .from("contact_directory")
    .select("id, full_name, organisation_name, phone, next_follow_up_date, last_contact_at", { count: "exact" })
    .not("next_follow_up_date", "is", null)
    .lte("next_follow_up_date", today)
    .neq("relationship_status", "inactive")
    .order("next_follow_up_date", { ascending: true })
    .order("full_name", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`call today ${error.code}`);
  const items: CallItem[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.full_name || !r.next_follow_up_date) continue;
    items.push({ id: r.id, name: r.full_name, organisation: r.organisation_name, phone: r.phone, dueDate: r.next_follow_up_date, lastContactAt: r.last_contact_at });
  }
  return { items, total: count ?? items.length };
}

// ── referral partners gone quiet ─────────────────────────────

export type QuietPartner = {
  key: string;
  href: string;
  name: string;
  person: string | null;
  /** The contact a call is logged against: the primary contact, or the independent contact themselves. */
  contactId: string | null;
  phone: string | null;
  days: number;
};

/**
 * Partners last spoken to more than 30 days ago, the longest silence first, plus how many have never
 * been spoken to (said once, not listed: a research lead nobody has called is not "gone quiet").
 */
export async function loadGoneQuiet(db: HqClient, limit = 5): Promise<{ items: QuietPartner[]; total: number; never: number; partners: number }> {
  const head = () => db.from("referral_partner_overview").select("id", { count: "exact", head: true });
  const [quiet, never, all] = await Promise.all([
    db
      .from("referral_partner_overview")
      .select("id, partner_kind, name, contact_id, primary_contact_id, primary_contact_name, primary_contact_phone, days_since_contact", { count: "exact" })
      .gt("days_since_contact", PARTNER_QUIET_DAYS)
      .order("days_since_contact", { ascending: false })
      .order("name")
      .limit(limit),
    head().is("last_contacted_at", null),
    head(),
  ]);
  for (const r of [quiet, never, all]) if (r.error) throw new Error(`gone quiet ${r.error.code}`);
  const items: QuietPartner[] = [];
  for (const r of quiet.data ?? []) {
    if (!r.id || !r.name || (r.partner_kind !== "organisation" && r.partner_kind !== "independent")) continue;
    items.push({
      key: `${r.partner_kind}:${r.id}`,
      href: partnerHref({ kind: r.partner_kind, id: r.id }),
      name: r.name,
      person: r.partner_kind === "organisation" ? r.primary_contact_name : null,
      contactId: r.partner_kind === "organisation" ? r.primary_contact_id : (r.contact_id ?? r.id),
      phone: r.primary_contact_phone,
      days: Number(r.days_since_contact ?? 0),
    });
  }
  return { items, total: quiet.count ?? items.length, never: never.count ?? 0, partners: all.count ?? 0 };
}

// ── new referrals ────────────────────────────────────────────

/** How far back "new" reaches. */
export const NEW_REFERRAL_DAYS = 14;

export type NewReferral = { id: string; label: string; prospect: string | null; partner: string | null; suburb: string | null; date: string };

export async function loadNewReferrals(db: HqClient, today: string, limit = 5): Promise<{ items: NewReferral[]; total: number }> {
  const { data, error, count } = await db
    .from("referral_overview")
    .select("id, ref_label, prospect_name, partner_organisation_name, partner_contact_name, property_suburb, referral_date", { count: "exact" })
    .eq("direction", "received")
    .gte("referral_date", addDays(today, -NEW_REFERRAL_DAYS))
    .order("referral_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`new referrals ${error.code}`);
  const items: NewReferral[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.referral_date) continue;
    items.push({
      id: r.id,
      label: r.ref_label ?? "Referral",
      prospect: r.prospect_name,
      partner: r.partner_organisation_name ?? r.partner_contact_name,
      suburb: r.property_suburb,
      date: r.referral_date,
    });
  }
  return { items, total: count ?? items.length };
}

// ── tasks ────────────────────────────────────────────────────

export type TodayTask = { id: string; title: string; dueDate: string; priority: TaskPriority };

/**
 * The person's own open tasks due today or earlier (overdue first), and, for someone who sees the
 * whole team's tasks, how many of everyone else's are overdue.
 */
export async function loadTasksToday(
  db: HqClient,
  ctx: { staffId: string; today: string; team: boolean },
  limit = 8,
): Promise<{ items: TodayTask[]; overdue: number; dueToday: number; teamOverdue: number | null }> {
  const open = [...OPEN_TASK_STATUSES];
  const mine = () => db.from("tasks").select("id", { count: "exact", head: true }).eq("assigned_to", ctx.staffId).is("deleted_at", null).in("status", open);
  const [list, overdue, dueToday, team] = await Promise.all([
    db
      .from("tasks")
      .select("id, title, due_date, priority")
      .eq("assigned_to", ctx.staffId)
      .is("deleted_at", null)
      .in("status", open)
      .not("due_date", "is", null)
      .lte("due_date", ctx.today)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(limit),
    mine().lt("due_date", ctx.today),
    mine().eq("due_date", ctx.today),
    ctx.team
      ? db
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .is("deleted_at", null)
          .in("status", open)
          .lt("due_date", ctx.today)
          .or(`assigned_to.is.null,assigned_to.neq.${ctx.staffId}`)
      : null,
  ]);
  for (const r of [list, overdue, dueToday, team]) if (r?.error) throw new Error(`tasks today ${r.error.code}`);
  return {
    items: (list.data ?? []).filter((t) => t.due_date).map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date as string, priority: t.priority })),
    overdue: overdue.count ?? 0,
    dueToday: dueToday.count ?? 0,
    teamOverdue: team ? (team.count ?? 0) : null,
  };
}

// ── contractors ──────────────────────────────────────────────

export type ContractorsToday = {
  /** No contractors in HQ at all. */
  none: boolean;
  warningDays: number;
  expiring: ExpiryItem[];
  expiringTotal: number;
  uncovered: Array<{ slug: string; label: string }>;
  /** Trades counted for cover: the uncovered ones plus those with an approved or preferred contractor. */
  tradeCount: number;
  /** Approved or preferred contractors whose last recorded job is older than NOT_USED_DAYS. Null when no job dates are recorded at all. */
  notUsed: Array<{ id: string; name: string; lastJobDate: string }> | null;
};

/** Callers must hold contractors.read (the loaders it shares with the dashboard check it again). */
export async function loadContractorsToday(db: HqClient, today: string): Promise<ContractorsToday> {
  const [summary, watch, anyJob, stale] = await Promise.all([
    loadContractorSummary(),
    loadExpiryWatch(6),
    db.from("contractor_directory").select("id", { count: "exact", head: true }).not("last_job_date", "is", null),
    db
      .from("contractor_directory")
      .select("id, business_name, last_job_date")
      .in("status", [...CLEARED_CONTRACTOR_STATUSES])
      .not("last_job_date", "is", null)
      .lt("last_job_date", addDays(today, -NOT_USED_DAYS))
      .order("last_job_date", { ascending: true })
      .limit(5),
  ]);
  if (anyJob.error) throw new Error(`contractor jobs ${anyJob.error.code}`);
  if (stale.error) throw new Error(`contractors not used ${stale.error.code}`);
  const uncovered = summary.tradesWithoutCover.map((slug) => ({ slug, label: coverageLabel(summary.coverage, slug) }));
  return {
    none: summary.total === 0,
    warningDays: summary.warningDays,
    expiring: watch.items,
    expiringTotal: watch.total,
    uncovered,
    tradeCount: uncovered.length + coveredTrades(summary.coverage).length,
    notUsed:
      (anyJob.count ?? 0) === 0
        ? null
        : (stale.data ?? []).filter((c) => c.id && c.business_name && c.last_job_date).map((c) => ({ id: c.id as string, name: c.business_name as string, lastJobDate: c.last_job_date as string })),
  };
}
