/*
 * Reads for the command center, shared by the /hq page and the chat tools (lib/hq/mcp/tools/leadership.ts),
 * so both see the same tasks, lanes and focus. Every query runs as the signed-in person through the
 * client given: row level security decides what comes back (a private task is simply absent; planning
 * items need planning.read). Nothing logs more than an error code. No "server-only" import: the MCP smoke
 * script loads this under plain Node.
 */

import type { HqClient } from "../db";
import type { TaskPriority, TaskStatus } from "../constants";
import type { LaunchMilestone, LeaderTask, PlanningItem, PlanningKind, PlanningStatus } from "./types";

type Db = HqClient;
// The views are typed loosely here on purpose: only the columns named below are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (db: Db, rel: string) => (db as any).from(rel);

export type Loaded<T> = { ok: true; data: T } | { ok: false };

const n = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) || 0 : 0);
const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const logErr = (where: string, e: { code?: string } | null | undefined) => console.error(`[hq] leadership ${where} failed:`, e?.code ?? "unknown");

// ── tasks ───────────────────────────────────────────────────

export const LEADER_TASK_COLS =
  "id, title, status, priority, due_date, planned_for, assigned_to, assignee_name, created_by, project_id, project_ref, project_name, project_priority, milestone_id, milestone_name, milestone_due_date, milestone_launch_gate, parent_task_id, is_blocked, open_dependency_count, blocking_count, open_subtask_count, checklist_total, checklist_done, blocked_reason, waiting_on, waiting_since, expected_response_date, next_follow_up_date, planning_item_id, planning_item_title, planning_item_status, related_contact_id, related_organisation_id, related_referral_id, related_opportunity_id, created_at, updated_at, completed_at";

export function toLeaderTask(r: Record<string, unknown>): LeaderTask {
  return {
    id: r.id as string,
    title: (r.title as string) ?? "",
    status: r.status as TaskStatus,
    priority: (s(r.priority) ?? "normal") as TaskPriority,
    dueDate: s(r.due_date),
    plannedFor: s(r.planned_for),
    assignedTo: s(r.assigned_to),
    assignedToName: s(r.assignee_name),
    createdBy: s(r.created_by),
    projectId: s(r.project_id),
    projectRef: s(r.project_ref),
    projectName: s(r.project_name),
    projectPriority: s(r.project_priority) as TaskPriority | null,
    milestoneId: s(r.milestone_id),
    milestoneName: s(r.milestone_name),
    milestoneDue: s(r.milestone_due_date),
    milestoneLaunchGate: r.milestone_launch_gate === true,
    parentId: s(r.parent_task_id),
    isBlocked: r.is_blocked === true,
    openDependencyCount: n(r.open_dependency_count),
    blockingCount: n(r.blocking_count),
    subtaskOpen: n(r.open_subtask_count),
    checklistTotal: n(r.checklist_total),
    checklistDone: n(r.checklist_done),
    blockedReason: s(r.blocked_reason),
    waitingOn: s(r.waiting_on),
    waitingSince: s(r.waiting_since),
    expectedResponse: s(r.expected_response_date),
    nextFollowUp: s(r.next_follow_up_date),
    planningItemId: s(r.planning_item_id),
    planningItemTitle: s(r.planning_item_title),
    planningItemStatus: s(r.planning_item_status) as PlanningStatus | null,
    relationship: !!(s(r.related_contact_id) || s(r.related_organisation_id) || s(r.related_referral_id)),
    pipeline: !!s(r.related_opportunity_id),
    relatedContactId: s(r.related_contact_id),
    relatedOpportunityId: s(r.related_opportunity_id),
    createdAt: s(r.created_at) ?? "",
    updatedAt: s(r.updated_at) ?? "",
    completedAt: s(r.completed_at),
  };
}

export type TaskScope = "mine" | "all";

/**
 * Open tasks for the command center. mine = assigned to the person, or unassigned and created by them
 * (work nobody has picked up yet is the creator's to place); all = every open task the person can see
 * (everyone's for tasks.read_all). At most 600.
 */
export async function loadOpenTasks(db: Db, meId: string, scope: TaskScope = "mine"): Promise<Loaded<LeaderTask[]>> {
  let q = from(db, "task_overview").select(LEADER_TASK_COLS).is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]);
  if (scope === "mine") q = q.or(`assigned_to.eq.${meId},and(assigned_to.is.null,created_by.eq.${meId})`);
  const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at").limit(600);
  if (error) {
    logErr("loadOpenTasks", error);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(toLeaderTask) };
}

/** Tasks completed since `sinceIso` that the person can see (mine = assigned to or completed by them). */
export async function loadCompletedSince(db: Db, meId: string, sinceIso: string, scope: TaskScope = "mine"): Promise<Loaded<LeaderTask[]>> {
  let q = from(db, "task_overview").select(LEADER_TASK_COLS).is("deleted_at", null).eq("status", "completed").gte("completed_at", sinceIso);
  if (scope === "mine") q = q.eq("assigned_to", meId);
  const { data, error } = await q.order("completed_at", { ascending: false }).limit(200);
  if (error) {
    logErr("loadCompletedSince", error);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(toLeaderTask) };
}

/** Every live task (any status) in one project the person can see. */
export async function loadProjectTasks(db: Db, projectId: string): Promise<Loaded<LeaderTask[]>> {
  const { data, error } = await from(db, "task_overview").select(LEADER_TASK_COLS).eq("project_id", projectId).is("deleted_at", null).order("sort_order").order("created_at").limit(500);
  if (error) {
    logErr("loadProjectTasks", error);
    return { ok: false };
  }
  return { ok: true, data: ((data ?? []) as Record<string, unknown>[]).map(toLeaderTask) };
}

// ── the launch project ──────────────────────────────────────

export type LaunchProject = {
  id: string;
  ref: string;
  name: string;
  status: string;
  health: string;
  healthReasons: string[];
  targetDate: string | null;
  progressDone: number;
  progressTotal: number;
  blockedCount: number;
  overdueCount: number;
  /** "setting" = chosen by a director; "name" = found by its name and not yet confirmed. */
  how: "setting" | "name";
};

const OVERVIEW = "id, ref, name, status, health, health_reasons, target_date, progress_done, progress_total, blocked_count, overdue_count, deleted_at";

function toLaunch(r: Record<string, unknown>, how: LaunchProject["how"]): LaunchProject {
  return {
    id: r.id as string,
    ref: s(r.ref) ?? "",
    name: (r.name as string) ?? "",
    status: s(r.status) ?? "planning",
    health: s(r.health) ?? "on_track",
    healthReasons: Array.isArray(r.health_reasons) ? (r.health_reasons as unknown[]).filter((x): x is string => typeof x === "string") : [],
    targetDate: s(r.target_date),
    progressDone: n(r.progress_done),
    progressTotal: n(r.progress_total),
    blockedCount: n(r.blocked_count),
    overdueCount: n(r.overdue_count),
    how,
  };
}

/**
 * The business launch project: the one in the launch_project_id setting; or, when that is not set, the
 * ONE live project whose name contains "business launch" (two or more such projects: none is guessed).
 * null when there is none (or the person cannot read projects).
 */
export async function loadLaunchProject(db: Db): Promise<Loaded<LaunchProject | null>> {
  const setting = await from(db, "settings").select("value").eq("key", "launch_project_id").maybeSingle();
  if (setting.error) {
    logErr("launch setting", setting.error);
    return { ok: false };
  }
  const id = s(setting.data?.value);
  if (id) {
    const { data, error } = await from(db, "project_overview").select(OVERVIEW).eq("id", id).is("deleted_at", null).maybeSingle();
    if (error) {
      logErr("launch project", error);
      return { ok: false };
    }
    if (data) return { ok: true, data: toLaunch(data as Record<string, unknown>, "setting") };
  }
  const { data, error } = await from(db, "project_overview").select(OVERVIEW).is("deleted_at", null).ilike("name", "%business launch%").limit(2);
  if (error) {
    logErr("launch by name", error);
    return { ok: false };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  return { ok: true, data: rows.length === 1 ? toLaunch(rows[0], "name") : null };
}

export async function loadMilestones(db: Db, projectId: string): Promise<Loaded<LaunchMilestone[]>> {
  const { data, error } = await from(db, "project_milestones").select("id, name, due_date, status, sort_order, launch_gate, completed_at").eq("project_id", projectId).limit(200);
  if (error) {
    logErr("loadMilestones", error);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((m) => ({
      id: m.id as string,
      name: (m.name as string) ?? "",
      dueDate: s(m.due_date),
      status: s(m.status) === "done" ? "done" : "open",
      sortOrder: n(m.sort_order),
      launchGate: m.launch_gate === true,
      completedAt: s(m.completed_at),
    })),
  };
}

// ── planning items ──────────────────────────────────────────

export function toPlanningItem(r: Record<string, unknown>, names: Map<string, string> = new Map()): PlanningItem {
  const amount = r.amount_anticipated === null || r.amount_anticipated === undefined ? null : n(r.amount_anticipated);
  return {
    id: r.id as string,
    ref: `PLN-${String(n(r.ref_number)).padStart(4, "0")}`,
    kind: r.kind as PlanningKind,
    title: (r.title as string) ?? "",
    detail: s(r.detail),
    amountAnticipated: amount,
    expectedText: s(r.expected_text),
    expectedBy: s(r.expected_by),
    status: r.status as PlanningStatus,
    version: n(r.version) || 1,
    createdAt: s(r.created_at) ?? "",
    createdByName: s(r.created_by) ? (names.get(r.created_by as string) ?? null) : null,
    updatedAt: s(r.updated_at) ?? "",
  };
}

/** Planning items (planning.read; empty otherwise). live = not received or closed. */
export async function loadPlanningItems(db: Db, opts: { liveOnly?: boolean } = {}): Promise<Loaded<PlanningItem[]>> {
  let q = from(db, "planning_items").select("id, ref_number, kind, title, detail, amount_anticipated, expected_text, expected_by, status, version, created_at, created_by, updated_at");
  if (opts.liveOnly) q = q.in("status", ["anticipated", "confirmed", "current"]);
  const { data, error } = await q.order("sort_order").order("created_at").limit(100);
  if (error) {
    logErr("loadPlanningItems", error);
    return { ok: false };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((r) => s(r.created_by)).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const st = await from(db, "staff_profiles").select("id, first_name").in("id", ids);
    for (const p of (st.data ?? []) as { id: string; first_name: string }[]) names.set(p.id, p.first_name);
  }
  return { ok: true, data: rows.map((r) => toPlanningItem(r, names)) };
}

// ── growth and relationships (live HQ figures only) ─────────

export type GrowthPanel = {
  newLeads: number;
  appraisalsRequested: number;
  appraisalsCompleted: number;
  openLeads: number;
  followUpsDue: number;
  leadFollowUpsDue: number;
  partnersQuiet: number;
  partnersNever: number;
  partners: number;
  stages: { connect: number; cultivate: number; champion: number };
  managed: number | null;
  goal: number | null;
  goalDate: string | null;
};

export const NEW_LEAD_DAYS = 14;
const QUIET_DAYS = 30; // today/data.ts PARTNER_QUIET_DAYS

/** Counts only, from records in HQ (growth.read). Every figure is a count of real rows; nothing is estimated. */
export async function loadGrowthPanel(db: Db, today: string, meId: string): Promise<Loaded<GrowthPanel>> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - NEW_LEAD_DAYS * 86_400_000).toISOString();
  const head = (rel: string) => from(db, rel).select("id", { count: "exact", head: true });
  const [newLeads, req, done, open, follow, leadFollow, quiet, never, partners, stages, settings, managed] = await Promise.all([
    head("opportunities").is("deleted_at", null).gte("created_at", since),
    head("opportunities").is("deleted_at", null).eq("stage", "appraisal_requested"),
    head("opportunities").is("deleted_at", null).eq("stage", "appraisal_completed"),
    head("opportunities").is("deleted_at", null).not("stage", "in", "(management_signed,lost)"),
    from(db, "contact_directory").select("id", { count: "exact", head: true }).not("next_follow_up_date", "is", null).lte("next_follow_up_date", today).neq("relationship_status", "inactive"),
    head("opportunities").is("deleted_at", null).eq("assigned_to", meId).not("stage", "in", "(management_signed,lost)").lte("next_action_due", today),
    from(db, "referral_partner_overview").select("id", { count: "exact", head: true }).gt("days_since_contact", QUIET_DAYS),
    from(db, "referral_partner_overview").select("id", { count: "exact", head: true }).is("last_contacted_at", null),
    from(db, "referral_partner_overview").select("id", { count: "exact", head: true }),
    from(db, "referral_partner_overview").select("relationship_status").limit(5000),
    from(db, "settings").select("key, value").in("key", ["goal_managed_properties", "goal_date"]),
    from(db, "managed_properties").select("id", { count: "exact", head: true }).is("deleted_at", null).in("status", ["active", "onboarding"]),
  ]);
  const required = [newLeads, req, done, open, follow, quiet, never, partners, stages];
  const bad = required.find((r) => r.error);
  if (bad) {
    logErr("loadGrowthPanel", bad.error);
    return { ok: false };
  }
  const counts = { connect: 0, cultivate: 0, champion: 0 };
  for (const r of (stages.data ?? []) as { relationship_status: string | null }[]) {
    const st = r.relationship_status;
    if (st === "identified" || st === "contacted" || st === "meeting_booked") counts.connect += 1;
    else if (st === "met" || st === "active_relationship") counts.cultivate += 1;
    else if (st === "referring_partner") counts.champion += 1;
  }
  const by = new Map(((settings.data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const g = by.get("goal_managed_properties");
  const gd = by.get("goal_date");
  return {
    ok: true,
    data: {
      newLeads: newLeads.count ?? 0,
      appraisalsRequested: req.count ?? 0,
      appraisalsCompleted: done.count ?? 0,
      openLeads: open.count ?? 0,
      followUpsDue: follow.count ?? 0,
      leadFollowUpsDue: leadFollow.error ? 0 : (leadFollow.count ?? 0),
      partnersQuiet: quiet.count ?? 0,
      partnersNever: never.count ?? 0,
      partners: partners.count ?? 0,
      stages: counts,
      // managed_properties needs portfolio.read: without it the figure is simply not shown. Managed = active or onboarding (business_summary).
      managed: managed.error ? null : (managed.count ?? 0),
      goal: typeof g === "number" ? g : null,
      goalDate: typeof gd === "string" ? gd : null,
    },
  };
}

// ── decisions that need the person ──────────────────────────

export type PendingDecision = { id: string; ref: string; title: string; decisionDate: string | null };

/** Proposed decisions where the person is the decision maker (decisions.read). */
export async function loadDecisionsForMe(db: Db, meId: string): Promise<Loaded<PendingDecision[]>> {
  const { data, error } = await from(db, "decisions").select("id, ref_number, title, decision_date").is("deleted_at", null).eq("status", "proposed").eq("decision_maker_id", meId).order("decision_date").limit(20);
  if (error) {
    logErr("loadDecisionsForMe", error);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((d) => ({ id: d.id as string, ref: `DEC-${String(n(d.ref_number)).padStart(4, "0")}`, title: (d.title as string) ?? "", decisionDate: s(d.decision_date) })),
  };
}

/** Active staff for the owner picker. */
export async function loadStaffOptions(db: Db): Promise<{ value: string; label: string }[]> {
  const { data, error } = await from(db, "staff_profiles").select("id, full_name").eq("is_active", true).eq("employment_status", "active").order("full_name").limit(200);
  if (error) {
    logErr("loadStaffOptions", error);
    return [];
  }
  return ((data ?? []) as { id: string; full_name: string }[]).map((p) => ({ value: p.id, label: p.full_name }));
}
