/*
 * The command-center tools (docs/hq-command-center.md section 5): the same lanes, focus score, launch
 * readiness and week plan as /hq, read through the SAME loaders (lib/hq/leadership/queries.ts) and rules
 * (lib/hq/leadership/rules.ts), so chat and the dashboard never disagree.
 *
 *   read   focus_today, workboard, launch_progress, waiting_on, weekly_leadership_review, list_planning_items
 *   write  set_task_waiting, resolve_waiting, move_task_to_lane, save_planning_item, set_launch_requirement
 *   bulk   plan_next_week (proposes by default; saves only the entries the person agreed, one transaction,
 *          idempotency key, the database's bulk budget)
 *
 * Everything runs as the person (RLS). Writes go through the RPCs (update_project_task, set_task_waiting,
 * resolve_task_waiting, bulk_update_tasks, save_planning_item, set_milestone_launch_gate), which check the
 * capability and the task-update rule again and write the task history and the audit trail. No tool here
 * changes a priority or a due date unless the person asked for that exact change (resolve_waiting due_date).
 * A planning amount is always said as anticipated, never as money held.
 */
import { HQ_PATHS, clean, plural } from "./core";
import { can, dbFailure, defineTool, link, resolveTask, respond, type ToolContext } from "./kit";
import { READ, WRITE, projectPath, resolveProject, rpcFailure, type RpcError } from "./project-kit";
import {
  focusTodayShape,
  launchProgressShape,
  listPlanningItemsShape,
  moveToLaneShape,
  planNextWeekShape,
  resolveWaitingShape,
  savePlanningItemShape,
  setLaunchRequirementShape,
  setTaskWaitingShape,
  waitingOnShape,
  weeklyReviewShape,
  workboardShape,
} from "./leadership-schemas";
import {
  LANES,
  LANE_LABEL,
  addDays,
  alsoDueToday,
  compareByScore,
  compareMilestone,
  dayWords,
  daysFrom,
  groupByLane,
  laneMove,
  laneOf,
  laneWhy,
  launchReadiness,
  pickFocus,
  planWeek,
  planningAmount,
  planningIsLive,
  planningStatusLabel,
  upcomingCommitments,
  waitsOf,
} from "../../leadership/rules";
import {
  LEADER_TASK_COLS,
  loadCompletedSince,
  loadDecisionsForMe,
  loadGrowthPanel,
  loadLaunchProject,
  loadMilestones,
  loadOpenTasks,
  loadPlanningItems,
  loadProjectTasks,
  toLeaderTask,
  type LaunchProject,
} from "../../leadership/queries";
import type { Lane, LeaderTask, PlanningItem } from "../../leadership/types";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
const rpc = (ctx: ToolContext): Rpc => (fn, args) => (ctx.db.rpc as unknown as (this: unknown, f: string, a: Record<string, unknown>) => ReturnType<Rpc>).call(ctx.db, fn, args);

const NO_PRIORITY = "Priorities and due dates are never changed by this: only what the person asked for.";
const NOT_MONEY = "A planning amount is anticipated, never a balance: never describe it as money held or available.";

/** Today as the database judges it (hq.today(), the business timezone): the same day the dashboard uses. */
async function hqToday(ctx: ToolContext): Promise<string> {
  const r = await ctx.db.rpc("today");
  return typeof r.data === "string" ? r.data : new Intl.DateTimeFormat("en-CA", { timeZone: ctx.staff.timezone }).format(new Date());
}

const taskUrl = (ctx: ToolContext, id: string) => link(ctx, HQ_PATHS.task(id));

function taskLine(ctx: ToolContext, t: LeaderTask, today: string, opts: { why?: string; owner?: boolean } = {}): string {
  const bits = [
    opts.why ?? laneWhy(t, today),
    t.projectRef ? `${t.projectRef} ${clean(t.projectName ?? "", 60)}${t.milestoneName ? ` / ${clean(t.milestoneName, 60)}` : ""}` : null,
    t.dueDate && !/^(Due|Overdue)/.test(opts.why ?? laneWhy(t, today)) ? `due ${dayWords(t.dueDate, today)}` : null,
    t.priority === "urgent" || t.priority === "high" ? `${t.priority} priority` : null,
    opts.owner ? (t.assignedToName ? clean(t.assignedToName, 60) : "unassigned") : null,
  ].filter(Boolean);
  return `- ${clean(t.title)} [id: ${t.id}] - ${bits.join(" - ")} ${taskUrl(ctx, t.id)}`;
}

async function scopeTasks(ctx: ToolContext, scope: "mine" | "everyone" | undefined) {
  const everyone = scope === "everyone";
  if (everyone && !can(ctx, "tasks.read_all")) return { ok: false as const, result: respond("refused", "Refused: seeing everyone's tasks needs tasks.read_all, which your HQ role does not include. Ask for scope mine instead.") };
  const r = await loadOpenTasks(ctx.db, ctx.staff.id, everyone ? "all" : "mine");
  if (!r.ok) return { ok: false as const, result: dbFailure("leadership tasks", { code: "load" }) };
  return { ok: true as const, tasks: r.data, everyone };
}

/** A planning item by PLN number, id, or words; "funding" / "$25,000" picks the one live funding item. */
async function resolvePlanning(ctx: ToolContext, query: string, mode: "live" | "any"): Promise<{ ok: true; item: PlanningItem } | { ok: false; result: ReturnType<typeof respond> }> {
  if (!can(ctx, "planning.read")) return { ok: false, result: respond("refused", "Refused: planning items (such as anticipated funding) need planning.read, which your HQ role does not include.") };
  const r = await loadPlanningItems(ctx.db);
  if (!r.ok) return { ok: false, result: dbFailure("planning items", { code: "load" }) };
  const items = mode === "live" ? r.data.filter((p) => planningIsLive(p) || p.kind === "context") : r.data;
  const q = query.trim().toLowerCase();
  const ref = /^pln[-\s]?0*(\d{1,9})$/.exec(q);
  let hits = ref ? items.filter((p) => p.ref.toLowerCase() === `pln-${ref[1].padStart(4, "0")}`) : items.filter((p) => p.id === q);
  if (!hits.length) hits = items.filter((p) => p.title.toLowerCase().includes(q));
  if (!hits.length && /fund|money|\$|grant|loan|\d{2,}/.test(q)) hits = items.filter((p) => p.kind === "funding" && planningIsLive(p));
  if (hits.length === 1) return { ok: true, item: hits[0] };
  if (hits.length === 0) return { ok: false, result: respond("not_found", `No ${mode === "live" ? "live " : ""}planning item matches "${clean(query, 80)}". list_planning_items shows them all.`) };
  return { ok: false, result: respond("ambiguous", `Several planning items match "${clean(query, 80)}". Say which one.`, hits.slice(0, 8).map((p) => `- ${p.ref} ${clean(p.title)} [id: ${p.id}] (${planningStatusLabel(p.kind, p.status)})`), { candidates: hits.slice(0, 8).map((p) => ({ id: p.id, label: p.title })) }) };
}

function planningLine(p: PlanningItem, today: string): string {
  const amount = p.kind === "funding" ? planningAmount(p.amountAnticipated) : null;
  const expected = p.expectedBy ? `expected ${dayWords(p.expectedBy, today)}` : p.expectedText ? `expected: ${clean(p.expectedText, 120)} (their words)` : "no expected date recorded";
  return `- ${p.ref} ${clean(p.title)} [id: ${p.id}] - ${p.kind}${amount ? ` - ${amount} ANTICIPATED (a planning figure, not a balance)` : ""} - ${planningStatusLabel(p.kind, p.status)} - ${p.kind === "context" ? `recorded ${p.createdAt.slice(0, 10)}` : expected}`;
}

async function launchFor(ctx: ToolContext, project: string | undefined): Promise<{ ok: true; project: LaunchProject } | { ok: false; result: ReturnType<typeof respond> }> {
  if (!can(ctx, "projects.read")) return { ok: false, result: respond("refused", "Refused: projects need projects.read, which your HQ role does not include.") };
  if (project) {
    const found = await resolveProject(ctx, project, "read");
    if (!found.ok) return found;
    const p = found.project;
    return { ok: true, project: { id: p.id, ref: p.ref, name: p.name, status: p.status, health: p.health, healthReasons: p.health_reasons ?? [], targetDate: p.target_date, progressDone: p.progress_done, progressTotal: p.progress_total, blockedCount: p.blocked_count, overdueCount: p.overdue_count, how: "setting" } };
  }
  const r = await loadLaunchProject(ctx.db);
  if (!r.ok) return { ok: false, result: dbFailure("launch project", { code: "load" }) };
  if (!r.data) return { ok: false, result: respond("empty", "No project is set as the business launch, and no single live project has \"business launch\" in its name. Name the project (project argument), or a director can choose it on the HQ dashboard.") };
  return { ok: true, project: r.data };
}

// ── focus_today ──────────────────────────────────────────────

export const focusToday = defineTool({
  name: "focus_today",
  title: "My focus today",
  description:
    "Answers 'what's my focus today?' in ONE call, exactly as the HQ dashboard shows it: at most three of the person's own tasks that can move now, ranked by a fixed, explainable score (overdue, due soon, planned for today, official priority, launch requirements, milestones, how many tasks it unblocks, relationship follow-ups, business development), each with its reasons and whether it is 'important and due now' or 'important, not pressing'; then the other tasks due today, how many are waiting, and decisions waiting for them. Waiting tasks are never focus. Read-only: " +
    NO_PRIORITY,
  inputSchema: focusTodayShape,
  annotations: READ,
  capability: "tasks.write",
  kind: "read",
  handler: async (args, ctx) => {
    const [today, mine, decisions] = await Promise.all([hqToday(ctx), loadOpenTasks(ctx.db, ctx.staff.id, "mine"), can(ctx, "decisions.read") ? loadDecisionsForMe(ctx.db, ctx.staff.id) : Promise.resolve(null)]);
    if (!mine.ok) return dbFailure("focus_today", { code: "load" });
    const picks = pickFocus(mine.data, today, ctx.staff.id, args.limit ?? 3);
    const also = alsoDueToday(mine.data, today, ctx.staff.id, new Set(picks.map((p) => p.task.id)));
    const lanes = groupByLane(mine.data.filter((t) => t.assignedTo === ctx.staff.id), today);
    const head = [picks.length ? `Your focus for ${dayWords(today, today)} (${today}), in order:` : "Nothing needs you right now: your open tasks are done, waiting on something, or not yours."];
    const data: string[] = picks.map((p, i) => `${i + 1}. ${clean(p.task.title)} [id: ${p.task.id}] - ${p.weight} - why: ${p.why}${p.task.projectRef ? ` - ${p.task.projectRef} ${clean(p.task.projectName ?? "", 60)}` : ""} ${taskUrl(ctx, p.task.id)}`);
    if (also.length) data.push("", `Also due today or overdue (${also.length}):`, ...also.slice(0, 10).map((t) => taskLine(ctx, t, today)));
    data.push("", `In motion: ${lanes.in_motion.length}. Waiting: ${lanes.waiting.length}. Coming next: ${lanes.coming_next.length}.`);
    if (decisions?.ok) data.push(decisions.data.length ? `Decisions waiting for you (${decisions.data.length}): ${decisions.data.slice(0, 5).map((d) => `${d.ref} ${clean(d.title, 80)}`).join("; ")}` : "No proposed decision is waiting for you.");
    return respond(picks.length ? "ok" : "empty", head, data, { task_ids: picks.map((p) => p.task.id), scores: picks.map((p) => ({ id: p.task.id, score: p.scored.score, factors: p.scored.factors })) }, `Dashboard: ${link(ctx, "/hq")}. The ranking only suggests; it changed nothing.`);
  },
});

// ── workboard ────────────────────────────────────────────────

export const workboard = defineTool({
  name: "workboard",
  title: "The workboard",
  description:
    "The HQ workboard in ONE call: open tasks in four leadership lanes, worked out from each task's real status, dependencies and waiting fields (never stored as a status): do_now (free to start and needed now: overdue, due within two days, planned for today, or urgent), in_motion (in progress), waiting (held up by another task, a planning item such as the funding, someone outside, or a held-up reason), coming_next (free to start, not yet pressing, or planned for a later day). Each task with why it is in its lane. scope mine (default) or everyone. Read-only.",
  inputSchema: workboardShape,
  annotations: READ,
  capability: "tasks.write",
  kind: "read",
  handler: async (args, ctx) => {
    const [today, s] = await Promise.all([hqToday(ctx), scopeTasks(ctx, args.scope)]);
    if (!s.ok) return s.result;
    const lanes = groupByLane(s.tasks, today);
    const show: readonly Lane[] = args.lane ? [args.lane] : LANES;
    const data: string[] = [];
    for (const l of show) {
      data.push(`${LANE_LABEL[l]} (${lanes[l].length}):`);
      if (!lanes[l].length) data.push("- nothing");
      data.push(...lanes[l].slice(0, 15).map((t) => taskLine(ctx, t, today, { owner: s.everyone })));
      if (lanes[l].length > 15) data.push(`- and ${lanes[l].length - 15} more`);
      data.push("");
    }
    return respond("ok", `Workboard (${s.everyone ? "everyone's open tasks you can see" : "yours"}), today ${today}:`, data, { counts: Object.fromEntries(LANES.map((l) => [l, lanes[l].length])) }, `To move one: move_task_to_lane. Dashboard: ${link(ctx, "/hq#cc-board")}`);
  },
});

// ── launch_progress ──────────────────────────────────────────

export const launchProgress = defineTool({
  name: "launch_progress",
  title: "Business launch progress",
  description:
    "Answers 'how is the launch going?' and 'what is blocking business launch?' in ONE call, for the business launch project (or a named project): launch readiness as launch requirements met (milestones marked required to open) SEPARATELY from tasks done (so admin tasks never count like licensing), the milestones in order with dates, the next actionable milestone and its best next task, every task holding the launch up with what it waits on, and dated commitments in the next three weeks. When no milestone is marked as required, it says so and gives no readiness figure. Read-only.",
  inputSchema: launchProgressShape,
  annotations: READ,
  capability: "projects.read",
  kind: "read",
  handler: async (args, ctx) => {
    const l = await launchFor(ctx, args.project);
    if (!l.ok) return l.result;
    const p = l.project;
    const [today, ms, tasks] = await Promise.all([hqToday(ctx), loadMilestones(ctx.db, p.id), loadProjectTasks(ctx.db, p.id)]);
    if (!ms.ok || !tasks.ok) return dbFailure("launch_progress", { code: "load" });
    const r = launchReadiness(ms.data, tasks.data, { done: p.progressDone, total: p.progressTotal }, today);
    const blockers = tasks.data.filter((t) => laneOf(t, today) === "waiting" && t.parentId === null);
    const head = [`${p.ref} ${clean(p.name)} (${p.health.replace(/_/g, " ")}): ${link(ctx, projectPath(p.id))}`];
    if (p.how === "name") head.push("(Found by its name; a director can confirm it as the launch project on the dashboard.)");
    const data = [
      r.gatesTotal ? `Ready to open: ${r.gatesDone} of ${r.gatesTotal} launch requirements met${r.openGates.length ? ` (still to meet: ${r.openGates.map((m) => clean(m.name, 80)).join(", ")})` : ""}.` : "Ready to open: no milestone is marked as required to open, so there is no readiness figure (set_launch_requirement marks them).",
      `Tasks done: ${r.tasksDone} of ${r.tasksTotal} (every task counts the same; this is not launch readiness).`,
      "",
      "Milestones:",
      ...[...ms.data].sort(compareMilestone).map((m) => `- ${clean(m.name)}${m.launchGate ? " [required to open]" : ""} - ${m.status === "done" ? "done" : m.dueDate ? `${(daysFrom(today, m.dueDate) ?? 0) < 0 ? "was due" : "due"} ${dayWords(m.dueDate, today)}` : "no date"}${r.nextMilestone?.id === m.id ? " <- next" : ""}`),
      "",
      r.nextAction ? `Next action: ${clean(r.nextAction.title)} [id: ${r.nextAction.id}] (${laneWhy(r.nextAction, today)}) ${taskUrl(ctx, r.nextAction.id)}` : "Next action: nothing in the next milestone can move right now.",
      "",
      `Blocking the launch (${blockers.length}):`,
      ...(blockers.length ? blockers.slice(0, 15).map((t) => taskLine(ctx, t, today, { why: waitsOf(t).map((w) => w.text).join("; ") })) : ["- nothing is held up"]),
      "",
      "Coming up in three weeks:",
      ...(upcomingCommitments(ms.data, tasks.data, today).slice(0, 10).map((c) => `- ${clean(c.title)} (${c.kind}) - ${c.overdue ? "was due " : ""}${dayWords(c.date, today)}`) || []),
      ...p.healthReasons.map((h) => `Health: ${clean(h, 200)}`),
    ];
    return respond("ok", head, data, { project_id: p.id, gates_done: r.gatesDone, gates_total: r.gatesTotal, tasks_done: r.tasksDone, tasks_total: r.tasksTotal, blocked_task_ids: blockers.map((t) => t.id) });
  },
});

// ── waiting_on ───────────────────────────────────────────────

export const waitingOn = defineTool({
  name: "waiting_on",
  title: "What is waiting, and on whom",
  description:
    "Everything that is held up, in ONE call: planning items such as anticipated funding (amount said as ANTICIPATED, never a balance) with the tasks that wait on each; then each task waiting on someone or something outside (who or what, since when if recorded, the expected reply if known, its project and the next follow-up; follow-ups due now are flagged). With item (for example 'the funding', 'the $25,000'), answers 'what can I do before it arrives?': the tasks waiting on it, and the person's tasks that can move now without it, best first. Never invents a date. Read-only. " +
    NOT_MONEY,
  inputSchema: waitingOnShape,
  annotations: READ,
  capability: "tasks.write",
  kind: "read",
  handler: async (args, ctx) => {
    const [today, s, plans] = await Promise.all([hqToday(ctx), scopeTasks(ctx, args.scope), can(ctx, "planning.read") ? loadPlanningItems(ctx.db) : Promise.resolve(null)]);
    if (!s.ok) return s.result;
    const visible = can(ctx, "planning.read") && can(ctx, "tasks.read_all") ? await loadOpenTasks(ctx.db, ctx.staff.id, "all") : { ok: true as const, data: s.tasks };
    const all = visible.ok ? visible.data : s.tasks;
    if (args.item) {
      const found = await resolvePlanning(ctx, args.item, "any");
      if (!found.ok) return found.result;
      const it = found.item;
      const waiting = all.filter((t) => t.planningItemId === it.id && t.status !== "completed" && t.status !== "cancelled");
      const free = s.tasks
        .filter((t) => t.assignedTo === ctx.staff.id && t.planningItemId !== it.id && laneOf(t, today) !== null && laneOf(t, today) !== "waiting" && t.subtaskOpen === 0)
        .sort((a, b) => compareByScore(a, b, today));
      const data = [
        planningLine(it, today),
        "",
        `Waiting on it (${waiting.length}):`,
        ...(waiting.length ? waiting.map((t) => taskLine(ctx, t, today, { why: "waiting on it", owner: true })) : ["- nothing"]),
        "",
        `You can do these now, without it (${free.length}), best first:`,
        ...(free.length ? free.slice(0, 12).map((t) => taskLine(ctx, t, today)) : ["- nothing else of yours can move right now"]),
      ];
      if (!planningIsLive(it)) data.unshift(`Note: it is marked ${planningStatusLabel(it.kind, it.status).toLowerCase()}.`);
      return respond("ok", `Before ${clean(it.title, 80)} ${it.status === "received" ? "(marked received)" : "arrives"}:`, data, { item_id: it.id, waiting_task_ids: waiting.map((t) => t.id), free_task_ids: free.slice(0, 12).map((t) => t.id) }, NOT_MONEY);
    }
    const live = plans?.ok ? plans.data.filter(planningIsLive) : [];
    const waits = s.tasks.filter((t) => laneOf(t, today) === "waiting");
    const data: string[] = [];
    if (live.length) {
      data.push("Planning items:");
      for (const p of live) {
        const on = all.filter((t) => t.planningItemId === p.id);
        data.push(planningLine(p, today), ...on.map((t) => `    waiting on it: ${clean(t.title)} [id: ${t.id}]`));
      }
      data.push("");
    }
    data.push(`Waiting (${waits.length}):`);
    for (const t of waits) {
      const fu = daysFrom(today, t.nextFollowUp);
      data.push(
        `- ${clean(t.title)} [id: ${t.id}] - on: ${waitsOf(t).map((w) => w.text.replace(/^Waiting on /, "")).join("; ")} - since: ${t.waitingSince ? dayWords(t.waitingSince, today) : "not recorded"} - reply expected: ${t.expectedResponse ? dayWords(t.expectedResponse, today) : "not known"} - next follow-up: ${t.nextFollowUp ? `${dayWords(t.nextFollowUp, today)}${fu !== null && fu <= 0 ? " (DUE)" : ""}` : "none set"}${t.projectRef ? ` - ${t.projectRef} ${clean(t.projectName ?? "", 60)}` : ""} ${taskUrl(ctx, t.id)}`,
      );
    }
    if (!waits.length) data.push("- nothing is waiting");
    return respond(waits.length || live.length ? "ok" : "empty", `What is held up (${s.everyone ? "everyone" : "yours"}), today ${today}:`, data, { waiting_task_ids: waits.map((t) => t.id), planning_item_ids: live.map((p) => p.id) }, live.some((p) => p.kind === "funding") ? NOT_MONEY : null);
  },
});

// ── weekly_leadership_review ─────────────────────────────────

export const weeklyLeadershipReview = defineTool({
  name: "weekly_leadership_review",
  title: "Weekly leadership review",
  description:
    "Answers 'give me my weekly leadership review' in ONE call, from HQ records only: what was completed in the last seven days, what is in motion, what is waiting (and which follow-ups are due), what is overdue, decisions waiting for the person, business launch readiness (requirements met apart from tasks done), growth counts (new leads, appraisals, follow-ups, partners to contact, Connect / Cultivate / Champion, managed properties against the goal), planning items (anticipated, never balances), and what is due or planned in the next seven days. No rates, forecasts or invented figures. Read-only.",
  inputSchema: weeklyReviewShape,
  annotations: READ,
  capability: "tasks.write",
  kind: "read",
  handler: async (args, ctx) => {
    const today = await hqToday(ctx);
    const since = new Date(Date.parse(`${addDays(today, -7)}T00:00:00Z`)).toISOString();
    const everyone = args.scope === "everyone";
    if (everyone && !can(ctx, "tasks.read_all")) return respond("refused", "Refused: everyone's tasks need tasks.read_all. Ask for scope mine instead.");
    const scope = everyone ? "all" : "mine";
    const [open, done, decisions, growth, plans, launch] = await Promise.all([
      loadOpenTasks(ctx.db, ctx.staff.id, scope),
      loadCompletedSince(ctx.db, ctx.staff.id, since, scope),
      can(ctx, "decisions.read") ? loadDecisionsForMe(ctx.db, ctx.staff.id) : Promise.resolve(null),
      can(ctx, "growth.read") ? loadGrowthPanel(ctx.db, today, ctx.staff.id) : Promise.resolve(null),
      can(ctx, "planning.read") ? loadPlanningItems(ctx.db, { liveOnly: true }) : Promise.resolve(null),
      can(ctx, "projects.read") ? loadLaunchProject(ctx.db) : Promise.resolve(null),
    ]);
    if (!open.ok || !done.ok) return dbFailure("weekly_leadership_review", { code: "load" });
    const lanes = groupByLane(open.data, today);
    const overdue = open.data.filter((t) => (daysFrom(today, t.dueDate) ?? 0) < 0);
    const followUps = lanes.waiting.filter((t) => t.nextFollowUp && (daysFrom(today, t.nextFollowUp) ?? 1) <= 7);
    const nextWeek = open.data.filter((t) => {
      const d = daysFrom(today, t.dueDate);
      const p = daysFrom(today, t.plannedFor);
      return (d !== null && d >= 0 && d <= 7) || (p !== null && p >= 0 && p <= 7);
    }).sort((a, b) => compareByScore(a, b, today));
    const data: string[] = [
      `Completed in the last 7 days (${done.data.length}):`,
      ...(done.data.length ? done.data.slice(0, 15).map((t) => `- ${clean(t.title)}${t.projectRef ? ` (${t.projectRef})` : ""}`) : ["- nothing recorded as completed"]),
      "",
      `In motion (${lanes.in_motion.length}):`,
      ...lanes.in_motion.slice(0, 10).map((t) => taskLine(ctx, t, today, { owner: everyone })),
      "",
      `Waiting (${lanes.waiting.length}); follow-ups due within a week: ${followUps.length}`,
      ...lanes.waiting.slice(0, 10).map((t) => taskLine(ctx, t, today, { why: waitsOf(t).map((w) => w.text).join("; "), owner: everyone })),
      "",
      `Overdue (${overdue.length}):`,
      ...(overdue.length ? overdue.slice(0, 10).map((t) => taskLine(ctx, t, today, { owner: everyone })) : ["- nothing overdue"]),
    ];
    if (decisions?.ok) data.push("", `Decisions waiting for you (${decisions.data.length})${decisions.data.length ? ": " + decisions.data.map((d) => `${d.ref} ${clean(d.title, 80)}`).join("; ") : ""}`);
    if (launch?.ok && launch.data) {
      const p = launch.data;
      const [ms, pt] = await Promise.all([loadMilestones(ctx.db, p.id), loadProjectTasks(ctx.db, p.id)]);
      if (ms.ok && pt.ok) {
        const r = launchReadiness(ms.data, pt.data, { done: p.progressDone, total: p.progressTotal }, today);
        data.push("", `Business launch (${p.ref} ${clean(p.name, 80)}, ${p.health.replace(/_/g, " ")}): ${r.gatesTotal ? `${r.gatesDone} of ${r.gatesTotal} launch requirements met` : "no launch requirements marked yet"}; tasks done ${r.tasksDone} of ${r.tasksTotal}; next milestone ${r.nextMilestone ? clean(r.nextMilestone.name, 80) : "none"}.`);
      }
    }
    if (growth?.ok) {
      const g = growth.data;
      data.push(
        "",
        `Growth (counts from HQ records): ${g.newLeads} new leads in 14 days; ${g.appraisalsRequested} appraisals requested; ${g.followUpsDue + g.leadFollowUpsDue} follow-ups due; ${g.partnersNever + g.partnersQuiet} partners to contact (${g.partnersNever} never contacted); partners by stage: Connect ${g.stages.connect}, Cultivate ${g.stages.cultivate}, Champion ${g.stages.champion}${g.managed !== null && g.goal !== null ? `; ${g.managed} of ${g.goal} managed properties (actual)` : ""}.`,
      );
    }
    if (plans?.ok && plans.data.length) data.push("", "Planning items (anticipated, not balances):", ...plans.data.map((p) => planningLine(p, today)));
    data.push("", `Due or planned in the next 7 days (${nextWeek.length}):`, ...nextWeek.slice(0, 15).map((t) => taskLine(ctx, t, today, { owner: everyone })));
    return respond("ok", `Weekly leadership review for ${ctx.staff.fullName}, week to ${today} (${everyone ? "everyone's tasks" : "your tasks"}):`, data, { completed: done.data.length, in_motion: lanes.in_motion.length, waiting: lanes.waiting.length, overdue: overdue.length }, `To plan next week: plan_next_week (it proposes first). Dashboard: ${link(ctx, "/hq")}`);
  },
});

// ── list_planning_items ──────────────────────────────────────

export const listPlanningItems = defineTool({
  name: "list_planning_items",
  title: "Planning items",
  description: "Lists founder-reported planning items: anticipated funding (a planning figure, never a balance), outside dependencies several tasks wait on, and notes on the current situation, each with status, expected timing as recorded (the person's own words, or a date only when known) and how many open tasks wait on it. Read-only. " + NOT_MONEY,
  inputSchema: listPlanningItemsShape,
  annotations: READ,
  capability: "planning.read",
  kind: "read",
  handler: async (args, ctx) => {
    const [today, r] = await Promise.all([hqToday(ctx), loadPlanningItems(ctx.db, { liveOnly: !args.include_closed })]);
    if (!r.ok) return dbFailure("list_planning_items", { code: "load" });
    const counts = new Map<string, number>();
    const { data } = await ctx.db.from("tasks").select("planning_item_id").not("planning_item_id", "is", null).is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]).limit(1000);
    for (const t of (data ?? []) as { planning_item_id: string }[]) counts.set(t.planning_item_id, (counts.get(t.planning_item_id) ?? 0) + 1);
    const lines = r.data.map((p) => `${planningLine(p, today)}${p.kind !== "context" ? ` - ${plural(counts.get(p.id) ?? 0, "open task")} waiting` : ""}${p.detail ? `\n    ${clean(p.detail, 400)}` : ""}`);
    return respond(r.data.length ? "ok" : "empty", r.data.length ? `${plural(r.data.length, "planning item")}:` : "No planning items recorded.", lines, { ids: r.data.map((p) => p.id) }, NOT_MONEY);
  },
});

// ── writes ───────────────────────────────────────────────────

async function freshTask(ctx: ToolContext, id: string): Promise<LeaderTask | null> {
  const { data } = await ctx.db.from("task_overview").select(LEADER_TASK_COLS).eq("id", id).is("deleted_at", null).maybeSingle();
  return data ? toLeaderTask(data as Record<string, unknown>) : null;
}

export const setTaskWaiting = defineTool({
  name: "set_task_waiting",
  title: "Move a task into Waiting",
  description:
    "Puts ONE task into Waiting with what it waits on, for example 'move training into Waiting on funding' (planning_item: the funding) or 'the accountant is waiting on their quote' (waiting_on in words). Optionally since when, the expected reply and the next follow-up, ONLY when the person gave them (never guess a date), and a note for its comments. Changes status and the waiting fields only: " +
    NO_PRIORITY +
    " Recorded in the task history and audit trail.",
  inputSchema: setTaskWaitingShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "write",
  handler: async (args, ctx) => {
    if (!args.waiting_on && !args.planning_item) return respond("invalid", "Not changed: say what it is waiting on (waiting_on in words, or planning_item such as the funding).");
    const found = await resolveTask(ctx, args.task, "write");
    if (!found.ok) return found.result;
    let item: PlanningItem | null = null;
    if (args.planning_item) {
      const p = await resolvePlanning(ctx, args.planning_item, "live");
      if (!p.ok) return p.result;
      if (!planningIsLive(p.item)) return respond("invalid", `Not changed: ${clean(p.item.title)} is ${planningStatusLabel(p.item.kind, p.item.status).toLowerCase()}, so nothing can wait on it.`);
      item = p.item;
    }
    const { error } = await rpc(ctx)("set_task_waiting", { p_task: found.record.id, p_waiting_on: args.waiting_on ?? null, p_planning_item: item?.id ?? null, p_since: args.since ?? null, p_expected: args.expected_reply ?? null, p_follow_up: args.follow_up ?? null, p_note: args.note ?? null });
    if (error) return rpcFailure("set_task_waiting", error, "Not changed");
    const today = await hqToday(ctx);
    const t = await freshTask(ctx, found.record.id);
    const lines = t
      ? [`Task: ${clean(t.title)}`, `Now: Waiting - ${waitsOf(t).map((w) => w.text).join("; ")}`, `Since: ${t.waitingSince ?? "not recorded"} - reply expected: ${t.expectedResponse ?? "not known"} - next follow-up: ${t.nextFollowUp ?? "none set"}`, `Priority (${t.priority}) and due date (${t.dueDate ?? "none"}) unchanged. Lane: ${LANE_LABEL[laneOf(t, today) ?? "waiting"]}.`]
      : [];
    return respond("ok", `Moved into Waiting [id: ${found.record.id}]: ${taskUrl(ctx, found.record.id)}`, lines, { id: found.record.id, planning_item_id: item?.id ?? null });
  },
});

export const resolveWaitingTool = defineTool({
  name: "resolve_waiting",
  title: "The wait is over",
  description:
    "For ONE task that was waiting, when the wait is over, for example 'Ailo has called me back, update the task': clears what it waited on (kept in its history), moves it to in_progress (default), to_do, or completed if nothing more is needed, and saves what happened as a comment. Optionally the next follow-up, and a new due date ONLY if the person asked for it. Never changes priority. A task that is not waiting is refused with a plain message.",
  inputSchema: resolveWaitingShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveTask(ctx, args.task, "write");
    if (!found.ok) return found.result;
    const { data, error } = await rpc(ctx)("resolve_task_waiting", { p_task: found.record.id, p_next: args.next ?? "in_progress", p_note: args.what_happened ?? null, p_follow_up: args.follow_up ?? null, p_due: args.due_date ?? null });
    if (error) {
      if ((error as { hint?: string }).hint === "not_waiting") return respond("invalid", `Not changed: "${clean(found.record.label, 120)}" is not waiting on anything. To change its status use update_task.`);
      return rpcFailure("resolve_task_waiting", error, "Not changed");
    }
    const r = data as { was_waiting_on?: string | null; status?: string };
    return respond("ok", `Updated [id: ${found.record.id}]: ${taskUrl(ctx, found.record.id)}`, [`Task: ${clean(found.record.label)}`, `Was waiting on: ${clean(r.was_waiting_on ?? "something", 200)}`, `Now: ${String(r.status ?? args.next ?? "in_progress").replace(/_/g, " ")}`, args.what_happened ? `Comment added: ${clean(args.what_happened, 300)}` : null, args.follow_up ? `Next follow-up: ${args.follow_up}` : null, args.due_date ? `Due date changed to ${args.due_date} (as asked)` : "Due date unchanged."].filter((l): l is string => !!l), { id: found.record.id });
  },
});

export const moveTaskToLane = defineTool({
  name: "move_task_to_lane",
  title: "Move a task on the workboard",
  description:
    "Moves ONE task to a workboard lane, exactly as dragging it on the HQ dashboard: do_now (to do, planned for today), in_motion (in progress), waiting (with waiting_on unless already recorded), coming_next (to do, planned for a later day; default next Monday). It changes the status and the person's own plan (planned_for) only: " +
    NO_PRIORITY +
    " A task that waits on another unfinished task stays in Waiting until that is done; the result says so.",
  inputSchema: moveToLaneShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveTask(ctx, args.task, "write");
    if (!found.ok) return found.result;
    const [today, t] = await Promise.all([hqToday(ctx), freshTask(ctx, found.record.id)]);
    if (!t) return respond("not_found", "That task could not be found. It may have been archived. Nothing was changed.");
    const move = laneMove(t, args.lane, today, { waitingOn: args.waiting_on ?? null, plannedFor: args.planned_for ?? null });
    if (!move.ok) return respond("invalid", `Not changed: ${move.message}`);
    const { error } = await rpc(ctx)("update_project_task", { p_id: t.id, p_patch: move.patch });
    if (error) return rpcFailure("move_task_to_lane", error, "Not changed");
    const after = await freshTask(ctx, t.id);
    return respond("ok", `Moved [id: ${t.id}]: ${taskUrl(ctx, t.id)}`, [`Task: ${clean(t.title)}`, `Lane: ${LANE_LABEL[laneOf(t, today) ?? "coming_next"]} -> ${after ? LANE_LABEL[laneOf(after, today) ?? args.lane] : LANE_LABEL[args.lane]}`, `Changed: ${Object.keys(move.patch).join(", ")}`, move.note ?? ""].filter(Boolean), { id: t.id, patch: move.patch });
  },
});

export const planNextWeek = defineTool({
  name: "plan_next_week",
  title: "Organise my tasks for next week",
  description:
    "Answers 'organise my tasks for next week'. FIRST call it WITHOUT apply: it PROPOSES a day (planned_for) for each of the person's movable open tasks across Monday to Friday (at most per_day a day, best first, never later than a due date that falls in the week), lists tasks due before the week starts (this week's work, not moved), tasks that do not fit, and waiting tasks with their follow-ups. Nothing changes. Show the proposal; ONLY if the person agrees, call again with apply = the entries (task id and day) and a fresh idempotency_key: it then saves planned_for for those tasks in one transaction (the bulk budget applies). Only the plan changes: " +
    NO_PRIORITY,
  inputSchema: planNextWeekShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "bulk",
  handler: async (args, ctx) => {
    const today = await hqToday(ctx);
    if (args.apply) {
      if (!args.idempotency_key) return respond("invalid", "Not changed: apply needs an idempotency_key (one fresh UUID for this plan, reused on a retry).");
      const ids = args.apply.map((e) => e.task.toLowerCase());
      if (ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) return respond("invalid", "Not changed: apply takes the task ids from the proposal.");
      const { data, error } = await rpc(ctx)("bulk_update_tasks", { p_updates: args.apply.map((e) => ({ id: e.task.toLowerCase(), planned_for: e.planned_for })), p_idempotency_key: args.idempotency_key, p_atomic: true });
      if (error) return rpcFailure("plan_next_week", error, "Not changed");
      const r = data as { updated_count?: number; changed_count?: number; unchanged_count?: number; failed_count?: number; duplicate?: boolean; failed?: { index: number; errors: string[] }[] };
      const lines = [`Saved a planned day for ${r.updated_count ?? r.changed_count ?? args.apply.length - (r.failed_count ?? 0)} task(s); ${r.failed_count ?? 0} failed${r.duplicate ? " (a repeat of an earlier call: nothing changed again)" : ""}.`, ...(r.failed ?? []).map((f) => `- entry ${f.index + 1}: ${clean(f.errors.join("; "), 300)}`), "Due dates and priorities are unchanged."];
      return respond(r.failed_count ? "invalid" : "ok", "Next week's plan saved:", lines, { result: r }, `Workboard: ${link(ctx, "/hq#cc-board")}`);
    }
    const mine = await loadOpenTasks(ctx.db, ctx.staff.id, "mine");
    if (!mine.ok) return dbFailure("plan_next_week", { code: "load" });
    const p = planWeek(mine.data, today, ctx.staff.id, { weekStart: args.week_start, perDay: args.per_day });
    const data: string[] = [];
    for (const d of p.days) {
      const on = p.entries.filter((e) => e.plannedFor === d);
      data.push(`${dayWords(d, today)} (${d}):`, ...(on.length ? on.map((e) => `- ${clean(e.title)} [id: ${e.taskId}] - ${clean(e.why, 160)}${e.dueDate ? ` - due ${dayWords(e.dueDate, today)}` : ""}`) : ["- nothing planned"]));
    }
    if (p.dueBefore.length) data.push("", `Due before the week starts (this week's work, not moved) (${p.dueBefore.length}):`, ...p.dueBefore.map((t) => taskLine(ctx, t, today)));
    if (p.overflow.length) data.push("", `Did not fit (left in Coming next) (${p.overflow.length}):`, ...p.overflow.slice(0, 15).map((t) => taskLine(ctx, t, today)));
    if (p.waiting.length) data.push("", `Waiting (not planned) (${p.waiting.length}):`, ...p.waiting.map((w) => `- ${clean(w.task.title)} [id: ${w.task.id}] - ${waitsOf(w.task).map((x) => x.text).join("; ")}${w.followUpInWeek ? ` - follow up ${dayWords(w.task.nextFollowUp!, today)}` : w.task.nextFollowUp ? "" : " - no follow-up set"}`));
    return respond(p.entries.length ? "ok" : "empty", `PROPOSAL for the week of ${dayWords(p.weekStart, today)} (nothing has changed yet):`, data, { proposal: p.entries.map((e) => ({ task: e.taskId, planned_for: e.plannedFor })), week_start: p.weekStart }, "If the person agrees, call plan_next_week again with apply set to the proposal entries (as returned in structured content) and a fresh idempotency_key.");
  },
});

export const savePlanningItemTool = defineTool({
  name: "save_planning_item",
  title: "Record planning information",
  description:
    "Adds or changes ONE planning item: anticipated funding (amount = what the person ANTICIPATES, in whole AUD, exactly as they said it), an outside dependency, or a note on the current situation. Timing in the person's own words (expected), or expected_by only when they gave a real date. Mark funding received ONLY when the person says it has actually arrived. Never record a figure or date the person did not give. " +
    NOT_MONEY,
  inputSchema: savePlanningItemShape,
  annotations: WRITE,
  capability: "planning.write",
  kind: "write",
  handler: async (args, ctx) => {
    let id: string | null = null;
    let version: number | null = null;
    if (args.item) {
      const found = await resolvePlanning(ctx, args.item, "any");
      if (!found.ok) return found.result;
      id = found.item.id;
      version = found.item.version;
    } else {
      if (!args.kind || !args.title) return respond("invalid", "Not saved: a new planning item needs a kind (funding, dependency or context) and a title.");
    }
    if (args.amount !== undefined && args.kind && args.kind !== "funding") return respond("invalid", "Not saved: only a funding item has an amount.");
    const clear = [args.detail === "" && "detail", args.expected === "" && "expected_text"].filter((x): x is string => !!x);
    const { data, error } = await rpc(ctx)("save_planning_item", {
      p_id: id,
      p_kind: id ? null : args.kind,
      p_title: args.title ?? null,
      p_detail: args.detail || null,
      p_amount: args.amount ?? null,
      p_expected_text: args.expected || null,
      p_expected_by: args.expected_by ?? null,
      p_status: args.status ?? null,
      p_clear: clear.length ? clear : null,
      p_version: version,
    });
    if (error) return rpcFailure("save_planning_item", error, "Not saved");
    const r = data as { ref: string; title: string; kind: PlanningItem["kind"]; status: PlanningItem["status"]; amount_anticipated: number | null; changed: boolean; id: string };
    const amount = r.kind === "funding" ? planningAmount(r.amount_anticipated === null ? null : Number(r.amount_anticipated)) : null;
    return respond(r.changed ? "ok" : "unchanged", `${id ? (r.changed ? "Saved" : "Nothing to change in") : "Added"} ${r.ref} ${clean(r.title)}: ${link(ctx, "/hq#cc-waiting")}`, [`Status: ${planningStatusLabel(r.kind, r.status)}${amount ? ` - ${amount} anticipated (a planning figure)` : ""}`], { id: r.id }, NOT_MONEY);
  },
});

export const setLaunchRequirement = defineTool({
  name: "set_launch_requirement",
  title: "Mark a launch requirement",
  description: "Marks ONE milestone of the business launch project (or a named project) as required before the business can open, or not. Launch readiness counts only these milestones, apart from task completion. Writes project activity. Change only what the person asked.",
  inputSchema: setLaunchRequirementShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const l = await launchFor(ctx, args.project);
    if (!l.ok) return l.result;
    const ms = await loadMilestones(ctx.db, l.project.id);
    if (!ms.ok) return dbFailure("set_launch_requirement", { code: "load" });
    const q = args.milestone.trim().toLowerCase();
    const hits = ms.data.filter((m) => m.id === q || m.name.toLowerCase() === q);
    const near = hits.length ? hits : ms.data.filter((m) => m.name.toLowerCase().includes(q));
    if (near.length !== 1) return respond(near.length ? "ambiguous" : "not_found", near.length ? "Several milestones match. Say which one." : `No milestone "${clean(args.milestone, 80)}" in ${l.project.ref}.`, (near.length ? near : ms.data).slice(0, 12).map((m) => `- ${clean(m.name)} [id: ${m.id}]${m.launchGate ? " (required to open)" : ""}`));
    const m = near[0];
    const { data, error } = await rpc(ctx)("set_milestone_launch_gate", { p_id: m.id, p_gate: args.required });
    if (error) return rpcFailure("set_launch_requirement", error, "Not changed");
    const changed = (data as { changed?: boolean }).changed !== false;
    return respond(changed ? "ok" : "unchanged", `${changed ? "Updated" : "Already so"}: ${clean(m.name)} is ${args.required ? "" : "not "}required to open (${l.project.ref}). ${link(ctx, "/hq#cc-launch")}`, null, { milestone_id: m.id });
  },
});
