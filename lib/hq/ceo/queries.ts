import "server-only";

import type { HqClient } from "../db";
import { loadBusinessSummary } from "../portfolio/queries";
import type { BusinessSummary } from "../portfolio/rules";
import { pickFocus, launchReadiness, scoreTask, weightWords, whyLine, type Readiness } from "../leadership/rules";
import {
  loadDecisionsForMe,
  loadGrowthPanel,
  loadLaunchProject,
  loadMilestones,
  loadOpenTasks,
  loadPlanningItems,
  loadProjectTasks,
  type GrowthPanel,
  type LaunchProject,
} from "../leadership/queries";
import type { LaunchMilestone, PlanningItem } from "../leadership/types";
import { HQ_BASE, type Capability } from "../constants";
import type { Period } from "./periods";
import { parseCeoOverview, type CeoOverview } from "./rules";
import { PRIORITY_MAX, rankPriorities, type EnquiryWaiting, type LeadFollowUp, type Priority } from "./priorities";

/*
 * Every read the CEO Command Centre makes, in parallel, as the signed-in person (row level security and the
 * capability checks inside each RPC decide what comes back). A part the person's role does not include is
 * not loaded at all; a part that fails comes back as { ok: false } and the page says so in that panel only,
 * so one failing query never blanks the dashboard.
 *
 * Nothing here computes a business figure: hq.ceo_overview and hq.business_summary count, lib/hq/ceo/rules.ts
 * works out what follows. The priorities reuse the command center's own reads and score.
 */

export type Part<T> = { ok: true; data: T } | { ok: false } | null;

// The views are typed loosely on purpose: only the columns named are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (db: HqClient, rel: string) => (db as any).from(rel);

const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const n = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

async function part<T>(label: string, fn: () => Promise<{ ok: true; data: T } | { ok: false }>): Promise<Part<T>> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[hq] ceo ${label} threw:`, e instanceof Error ? e.name : "unknown");
    return { ok: false };
  }
}

export type ProjectSummary = {
  id: string;
  ref: string;
  name: string;
  status: string;
  priority: string;
  ownerName: string | null;
  targetDate: string | null;
  daysToTarget: number | null;
  progressPct: number | null;
  progressDone: number;
  progressTotal: number;
  health: string;
  healthReasons: string[];
  overdue: number;
  blocked: number;
  nextMilestone: string | null;
  nextMilestoneDue: string | null;
};

export type Launch = { project: LaunchProject; milestones: LaunchMilestone[]; readiness: Readiness };

export type DecisionsSummary = { proposed: number; decidedInPeriod: number; recent: Array<{ id: string; ref: string; title: string; status: string; date: string }> };

export type CeoData = {
  overview: Part<CeoOverview>;
  business: Part<BusinessSummary>;
  growthPanel: Part<GrowthPanel>;
  priorities: Part<Priority[]>;
  launch: Part<Launch | null>;
  projects: Part<ProjectSummary[]>;
  decisions: Part<DecisionsSummary>;
  decisionsForMe: number | null;
  newEnquiries: number | null;
  planning: Part<PlanningItem[]>;
};

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

async function loadProjects(db: HqClient): Promise<{ ok: true; data: ProjectSummary[] } | { ok: false }> {
  const { data, error } = await from(db, "project_overview")
    .select("id, ref, name, status, priority, owner_name, target_date, days_to_target, progress_pct, progress_done, progress_total, health, health_reasons, overdue_count, blocked_count, next_milestone_name, next_milestone_due")
    .is("deleted_at", null)
    .in("status", ["planning", "active", "on_hold"])
    .limit(60);
  if (error) {
    console.error("[hq] ceo projects failed:", error.code);
    return { ok: false };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    ref: s(r.ref) ?? "",
    name: s(r.name) ?? "",
    status: s(r.status) ?? "planning",
    priority: s(r.priority) ?? "normal",
    ownerName: s(r.owner_name),
    targetDate: s(r.target_date),
    daysToTarget: r.days_to_target === null || r.days_to_target === undefined ? null : n(r.days_to_target),
    progressPct: r.progress_pct === null || r.progress_pct === undefined ? null : n(r.progress_pct),
    progressDone: n(r.progress_done),
    progressTotal: n(r.progress_total),
    health: s(r.health) ?? "on_track",
    healthReasons: Array.isArray(r.health_reasons) ? (r.health_reasons as unknown[]).filter((x): x is string => typeof x === "string") : [],
    overdue: n(r.overdue_count),
    blocked: n(r.blocked_count),
    nextMilestone: s(r.next_milestone_name),
    nextMilestoneDue: s(r.next_milestone_due),
  }));
  // A few clearly prioritised objectives: active first, then by priority, then the nearest target date.
  rows.sort(
    (a, b) =>
      (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) ||
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
      (a.targetDate ?? "9999") .localeCompare(b.targetDate ?? "9999") ||
      a.name.localeCompare(b.name),
  );
  return { ok: true, data: rows };
}

async function loadDecisions(db: HqClient, period: Period): Promise<{ ok: true; data: DecisionsSummary } | { ok: false }> {
  const [proposed, decided, recent] = await Promise.all([
    from(db, "decisions").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("status", "proposed"),
    from(db, "decisions").select("id", { count: "exact", head: true }).is("deleted_at", null).neq("status", "proposed").gte("decision_date", period.from).lte("decision_date", period.to),
    from(db, "decisions").select("id, ref_number, title, status, decision_date").is("deleted_at", null).order("decision_date", { ascending: false }).order("created_at", { ascending: false }).limit(4),
  ]);
  const bad = [proposed, decided, recent].find((r) => r.error);
  if (bad) {
    console.error("[hq] ceo decisions failed:", bad.error.code);
    return { ok: false };
  }
  return {
    ok: true,
    data: {
      proposed: proposed.count ?? 0,
      decidedInPeriod: decided.count ?? 0,
      recent: ((recent.data ?? []) as Record<string, unknown>[]).map((d) => ({
        id: d.id as string,
        ref: `DEC-${String(n(d.ref_number)).padStart(4, "0")}`,
        title: s(d.title) ?? "",
        status: s(d.status) ?? "",
        date: s(d.decision_date) ?? "",
      })),
    },
  };
}

async function loadLeadFollowUps(db: HqClient): Promise<{ ok: true; data: LeadFollowUp[] } | { ok: false }> {
  const { data, error } = await from(db, "overdue_opportunities")
    .select("opportunity_id, ref, prospect_name, next_action, next_action_due, assigned_to_name, stage, missing_owner")
    .order("days_overdue", { ascending: false })
    .limit(25);
  if (error) {
    console.error("[hq] ceo lead follow-ups failed:", error.code);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.opportunity_id as string,
      ref: s(r.ref) ?? "",
      prospect: s(r.prospect_name) ?? "A lead",
      nextAction: s(r.next_action),
      due: s(r.next_action_due),
      ownerName: s(r.assigned_to_name),
      stage: s(r.stage) ?? "",
      missingOwner: r.missing_owner === true,
    })),
  };
}

/** Website enquiries still New and not handled, not handled more than a day after they arrived (a day to pick one up is fair). */
async function loadWaitingEnquiries(db: HqClient, today: string): Promise<{ ok: true; data: EnquiryWaiting[] } | { ok: false }> {
  const { data, error } = await from(db, "enquiries")
    .select("id, ref_number, name, kind, received_at")
    .eq("status", "new")
    .is("handled_at", null)
    .lt("received_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("received_at")
    .limit(10);
  if (error) {
    console.error("[hq] ceo enquiries failed:", error.code);
    return { ok: false };
  }
  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      ref: `ENQ-${String(n(r.ref_number)).padStart(4, "0")}`,
      name: s(r.name) ?? "Someone",
      kind: s(r.kind) ?? "contact",
      receivedOn: (s(r.received_at) ?? today).slice(0, 10),
    })),
  };
}

export const CEO_HREF = {
  lead: (id: string) => `${HQ_BASE}/growth/opportunities/${encodeURIComponent(id)}`,
  decision: (id: string) => `${HQ_BASE}/decisions/${encodeURIComponent(id)}`,
  enquiry: (id: string) => `${HQ_BASE}/growth/enquiries/${encodeURIComponent(id)}`,
  task: (id: string) => `${HQ_BASE}/operations/tasks/${encodeURIComponent(id)}`,
  project: (id: string) => `${HQ_BASE}/projects/${encodeURIComponent(id)}`,
  contact: (id: string) => `${HQ_BASE}/growth/contacts/${encodeURIComponent(id)}`,
  organisation: (id: string) => `${HQ_BASE}/growth/organisations/${encodeURIComponent(id)}`,
  property: (id: string) => `${HQ_BASE}/portfolio/${encodeURIComponent(id)}`,
};

export async function loadCeoData(db: HqClient, me: { id: string }, can: (c: Capability) => boolean, period: Period, today: string): Promise<CeoData> {
  const growth = can("growth.read");
  const portfolio = can("portfolio.read");
  const tasks = can("tasks.write");
  const projects = can("projects.read");
  const decisions = can("decisions.read");
  const none = Promise.resolve(null);

  const [overview, business, growthPanel, openTasks, leads, enquiries, launchProject, projectList, decisionSummary, mine, planning] = await Promise.all([
    growth || portfolio
      ? part<CeoOverview>("overview", async () => {
          const { data, error } = await db.rpc("ceo_overview", { p_from: period.from, p_to: period.to, p_prev_from: period.previous?.from, p_prev_to: period.previous?.to });
          if (error) {
            console.error("[hq] ceo_overview failed:", error.code);
            return { ok: false as const };
          }
          const parsed = parseCeoOverview(data);
          return parsed ? { ok: true as const, data: parsed } : { ok: false as const };
        })
      : none,
    growth || portfolio ? part("business", () => loadBusinessSummary(db)) : none,
    growth ? part("growth panel", () => loadGrowthPanel(db, today, me.id)) : none,
    tasks ? part("tasks", () => loadOpenTasks(db, me.id, "mine")) : none,
    growth ? part("leads", () => loadLeadFollowUps(db)) : none,
    growth ? part("enquiries", () => loadWaitingEnquiries(db, today)) : none,
    projects ? part("launch", () => loadLaunchProject(db)) : none,
    projects ? part("projects", () => loadProjects(db)) : none,
    decisions ? part("decisions", () => loadDecisions(db, period)) : none,
    decisions ? part("decisions for me", () => loadDecisionsForMe(db, me.id)) : none,
    can("planning.read") ? part("planning", () => loadPlanningItems(db, { liveOnly: true })) : none,
  ]);

  // The launch project's milestones and tasks, for readiness (the command center's own calculation).
  let launch: Part<Launch | null> = launchProject ? (launchProject.ok ? { ok: true, data: null } : { ok: false }) : null;
  if (launchProject?.ok && launchProject.data) {
    const p = launchProject.data;
    const [ms, pt] = await Promise.all([loadMilestones(db, p.id), loadProjectTasks(db, p.id)]);
    launch =
      ms.ok && pt.ok
        ? { ok: true, data: { project: p, milestones: ms.data, readiness: launchReadiness(ms.data, pt.data.filter((t) => t.parentId === null), { done: p.progressDone, total: p.progressTotal }, today) } }
        : { ok: false };
  }

  // Priorities: only from what loaded; a part that failed is left out (and the panel says so).
  const anyPriorityPart = openTasks || leads || enquiries || mine;
  const priorities: Part<Priority[]> = anyPriorityPart
    ? {
        ok: true,
        data: rankPriorities(
          {
            tasks: openTasks?.ok ? pickFocus(openTasks.data, today, me.id, PRIORITY_MAX).map((f) => ({ task: f.task, href: CEO_HREF.task(f.task.id) })) : [],
            leads: leads?.ok ? leads.data : [],
            decisions: mine?.ok ? mine.data.map((d) => ({ id: d.id, ref: d.ref, title: d.title })) : [],
            enquiries: enquiries?.ok ? enquiries.data : [],
            hrefs: CEO_HREF,
          },
          today,
          scoreTask,
          { why: whyLine, weight: weightWords },
        ),
      }
    : null;
  const failedPriorityPart = [openTasks, leads, enquiries, mine].some((p) => p && !p.ok);

  return {
    overview,
    business,
    growthPanel,
    priorities: failedPriorityPart && priorities?.ok && priorities.data.length === 0 ? { ok: false } : priorities,
    launch,
    projects: projectList,
    decisions: decisionSummary,
    decisionsForMe: mine?.ok ? mine.data.length : null,
    newEnquiries: enquiries?.ok ? enquiries.data.length : null,
    planning,
  };
}
