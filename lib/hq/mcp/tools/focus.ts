/*
 * What to do next and what is late or stuck (docs/hq-projects.md section 3): founder_priorities (the
 * person's next actionable tasks, ranked by the SAME score as the dashboard's focus and focus_today
 * (lib/hq/leadership/rules.ts pickFocus), with its "why", and for a named project what is
 * holding it up), list_overdue (hq.overdue_tasks plus projects at risk) and what_is_blocking (a
 * project's blocked tasks and the first open task blocking each). Read-only, as the person (RLS): only
 * tasks they can see are listed or counted.
 */
import { HQ_PATHS, clean, plural, rowLimit } from "./core";
import { can, day, dbFailure, defineTool, link, respond, today, type ToolContext } from "./kit";
import { taskPriorityLabel } from "./records";
import { NO_PROJECTS_READ, READ, TASK_COLS, blockageLines, blockages, healthWord, projectHeadLine, projectPath, resolveProject, toProjectRows, toTaskRows, visibilityNote, OVERVIEW_COLS, type Blockage, type ProjectRow } from "./project-kit";
import { founderPrioritiesShape, listOverdueShape, whatIsBlockingShape } from "./project-schemas";
import { loadOpenTasks } from "../../leadership/queries";
import { pickFocus } from "../../leadership/rules";

type FocusRow = { task_id: string; title: string; priority: string; due_date: string | null; project_ref: string | null; project_name: string | null; milestone_name: string | null; why: string; rank: number };

/** The open tasks that unblock the most, across a set of blockages ("do these first"). */
function rootsRanked(list: readonly Blockage[]): Array<{ id: string; title: string; count: number }> {
  const m = new Map<string, { id: string; title: string; count: number }>();
  for (const b of list) for (const r of b.roots) m.set(r.id, { id: r.id, title: r.title, count: (m.get(r.id)?.count ?? 0) + 1 });
  return [...m.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

async function projectBlockers(ctx: ToolContext, p: ProjectRow): Promise<{ list: Blockage[]; held: ReturnType<typeof toTaskRows> } | null> {
  const { data, error } = await ctx.db.from("task_overview").select(TASK_COLS).eq("project_id", p.id).is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]).limit(300);
  if (error) return null;
  const open = toTaskRows(data);
  const list = await blockages(ctx, open.filter((t) => t.is_blocked), open);
  const held = open.filter((t) => !t.is_blocked && t.blocked_reason);
  return { list, held };
}

export const founderPriorities = defineTool({
  name: "founder_priorities",
  title: "My priorities",
  description:
    "Answers 'what are my priorities', 'what should I do next' in ONE call: the person's next actionable tasks (default 3) from HQ's focus list, each with WHY it is first (overdue, due soon, urgent, unblocks others). Only tasks assigned to them that are open, not waiting on another task and not a parent whose subtasks are the work. With a project (for example 'what is stopping us launching?'), also what is holding that project up: its blocked tasks and the first open task blocking each, and which tasks to do first to unblock the most. Read-only.",
  inputSchema: founderPrioritiesShape,
  annotations: READ,
  capability: null,
  kind: "read",
  handler: async (args, ctx) => {
    if (args.project && !can(ctx, "projects.read")) return respond("refused", NO_PROJECTS_READ);
    const n = args.limit ?? 3;
    const [open, todayRes, proj] = await Promise.all([loadOpenTasks(ctx.db, ctx.staff.id, "mine"), ctx.db.rpc("today"), args.project ? resolveProject(ctx, args.project, "read") : Promise.resolve(null)]);
    if (!open.ok) return dbFailure("founder_priorities", { code: "load" });
    if (proj && !proj.ok) return proj.result;
    const todayIs = typeof todayRes.data === "string" ? todayRes.data : today(ctx);
    const rows: FocusRow[] = pickFocus(open.data, todayIs, ctx.staff.id, n).map((p, i) => ({
      task_id: p.task.id, title: p.task.title, priority: p.task.priority, due_date: p.task.dueDate,
      project_ref: p.task.projectRef, project_name: p.task.projectName, milestone_name: p.task.milestoneName, why: p.why, rank: i + 1,
    }));
    const head: string[] = [];
    const data: string[] = [];
    if (rows.length === 0) head.push("Nothing is waiting on you: you have no open tasks that can be started now (none assigned to you, or every one is waiting on another task).");
    else {
      head.push(`Your ${rows.length === 1 ? "top priority" : `top ${rows.length} priorities`}, in order (the same ranking as the dashboard's focus):`);
      for (const r of rows) {
        const where = r.project_ref ? `${r.project_ref} ${clean(r.project_name ?? "", 60)}${r.milestone_name ? ` / ${clean(r.milestone_name, 60)}` : ""}` : null;
        data.push(`${r.rank}. ${clean(r.title)} [id: ${r.task_id}] - why: ${clean(r.why, 120)}${r.due_date ? ` - due ${day(ctx, r.due_date)}` : ""} - ${taskPriorityLabel(r.priority).toLowerCase()} priority${where ? ` - ${where}` : ""} ${link(ctx, HQ_PATHS.task(r.task_id))}`);
      }
    }
    const extra: Record<string, unknown> = { task_ids: rows.map((r) => r.task_id) };
    if (proj && proj.ok) {
      const p = proj.project;
      const b = await projectBlockers(ctx, p);
      if (!b) return dbFailure("founder_priorities project", { code: "load" });
      data.push("", `What is holding up ${p.ref} ${clean(p.name)} (${healthWord(p.health)}):`);
      if (b.list.length === 0 && b.held.length === 0) data.push("- Nothing is blocked: no open task in it is waiting on another task.");
      const roots = rootsRanked(b.list);
      if (roots.length) data.push(`Do these first (they unblock the most): ${roots.slice(0, 5).map((r) => `${clean(r.title, 80)} [id: ${r.id}] (unblocks ${r.count})`).join("; ")}`);
      data.push(...blockageLines(ctx, b.list, 8));
      for (const h of b.held.slice(0, 5)) data.push(`- ${clean(h.title)} [id: ${h.id}] is held up: ${clean(h.blocked_reason, 200)}`);
      for (const r of p.health_reasons ?? []) data.push(`Health: ${clean(r, 200)}`);
      extra.project_id = p.id;
      extra.blocked_count = b.list.length;
      head.push(`Project: ${link(ctx, projectPath(p.id))}`);
    }
    const note = visibilityNote(ctx);
    return respond(rows.length || extra.project_id ? "ok" : "empty", head, data, extra, args.project && note ? note : null);
  },
});

export const listOverdue = defineTool({
  name: "list_overdue",
  title: "What's overdue",
  description:
    "Answers 'what's overdue?' in ONE call: open tasks past their due date, most overdue first (mine by default; scope all = every task you can see, which is everyone's with tasks.read_all), each with how many days, who has it, its project and whether it is blocked; plus the projects that are at risk or off track, with the reasons (needs projects.read). Optionally one project. Read-only.",
  inputSchema: listOverdueShape,
  annotations: READ,
  capability: null,
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit, 15);
    const canProjects = can(ctx, "projects.read");
    if (args.project && !canProjects) return respond("refused", NO_PROJECTS_READ);
    const proj = args.project ? await resolveProject(ctx, args.project, "read") : null;
    if (proj && !proj.ok) return proj.result;
    const scope = args.scope ?? "mine";
    const [od, risky] = await Promise.all([
      ctx.db.rpc("overdue_tasks", { p_scope: scope, p_project: proj?.ok ? proj.project.id : undefined }),
      canProjects && !proj
        ? ctx.db.from("project_overview").select(OVERVIEW_COLS).is("deleted_at", null).in("health", ["off_track", "at_risk"]).order("target_date", { ascending: true, nullsFirst: false }).limit(10)
        : Promise.resolve({ data: [] as unknown[], error: null }),
    ]);
    if (od.error) return dbFailure("overdue_tasks", od.error);
    if (risky.error) return dbFailure("list_overdue projects", risky.error);
    type Row = { task_id: string; title: string; priority: string; due_date: string; overdue_days: number; assignee_name: string | null; assigned_to: string | null; project_ref: string | null; project_name: string | null; is_blocked: boolean };
    const rows = (od.data ?? []) as Row[];
    const projects = toProjectRows(risky.data);
    const scopeWord = scope === "all" ? (can(ctx, "tasks.read_all") ? "everyone's" : "yours and the ones you created") : "yours";
    const head = [
      rows.length ? `${plural(rows.length, "overdue task")} (${scopeWord}${proj?.ok ? `, in ${proj.project.ref}` : ""}), most overdue first${rows.length > n ? `; showing ${n}` : ""}. Today is ${day(ctx, today(ctx))}.` : `No overdue tasks (${scopeWord}${proj?.ok ? `, in ${proj.project.ref}` : ""}).`,
    ];
    const data = rows.slice(0, n).map((r) => `- ${clean(r.title)} [id: ${r.task_id}] - ${r.overdue_days} day${r.overdue_days === 1 ? "" : "s"} overdue (due ${day(ctx, r.due_date)}) - ${r.assigned_to ? clean(r.assignee_name ?? "someone") : "unassigned"}${r.priority === "urgent" || r.priority === "high" ? ` - ${r.priority}` : ""}${r.project_ref ? ` - ${r.project_ref} ${clean(r.project_name ?? "", 60)}` : ""}${r.is_blocked ? " - BLOCKED (waiting on another task)" : ""}`);
    if (projects.length) {
      data.push("", `Projects at risk or off track (${projects.length}):`);
      for (const p of projects) {
        data.push(projectHeadLine(ctx, p));
        for (const r of (p.health_reasons ?? []).slice(0, 3)) data.push(`    - ${clean(r, 200)}`);
      }
    } else if (canProjects && !proj) data.push("", "No project is at risk or off track.");
    const outcome = rows.length || projects.length ? "ok" : "empty";
    return respond(outcome, head, data, { count: rows.length, task_ids: rows.slice(0, n).map((r) => r.task_id), project_ids: projects.map((p) => p.id) }, visibilityNote(ctx));
  },
});

export const whatIsBlocking = defineTool({
  name: "what_is_blocking",
  title: "What is blocking a project",
  description:
    "For ONE project ('what is stopping us launching?'): every blocked task (waiting on an unfinished task) and the first OPEN task blocking each, following the chain to the work that can start now; which tasks to do first to unblock the most; tasks held up for another reason (their blocked reason); and the project's health reasons. A blocking task you cannot see is counted, not named. Read-only.",
  inputSchema: whatIsBlockingShape,
  annotations: READ,
  capability: "projects.read",
  kind: "read",
  handler: async (args, ctx) => {
    const proj = await resolveProject(ctx, args.project, "read");
    if (!proj.ok) return proj.result;
    const p = proj.project;
    const b = await projectBlockers(ctx, p);
    if (!b) return dbFailure("what_is_blocking", { code: "load" });
    const head = [projectHeadLine(ctx, p), proj.note ?? ""];
    if (b.list.length === 0 && b.held.length === 0) {
      return respond("empty", [...head, `Nothing in ${p.ref} is blocked: no open task you can see is waiting on another task or marked as held up.`], (p.health_reasons ?? []).map((r) => `Health: ${clean(r, 200)}`), { project_id: p.id, blocked_count: 0 }, visibilityNote(ctx));
    }
    const roots = rootsRanked(b.list);
    const data: string[] = [];
    if (roots.length) data.push(`Do these first (each unblocks the most): ${roots.slice(0, 5).map((r) => `${clean(r.title, 80)} [id: ${r.id}] (unblocks ${r.count})`).join("; ")}`, "");
    data.push(...blockageLines(ctx, b.list, 15));
    if (b.held.length) data.push("", "Held up for another reason:", ...b.held.slice(0, 10).map((h) => `- ${clean(h.title)} [id: ${h.id}]: ${clean(h.blocked_reason, 200)}`));
    data.push("", ...(p.health_reasons ?? []).map((r) => `Health: ${clean(r, 200)}`));
    return respond("ok", [...head, `${plural(b.list.length, "blocked task")}${b.held.length ? ` and ${b.held.length} held up` : ""} in ${p.ref}.`], data, { project_id: p.id, blocked_count: b.list.length, first_blockers: roots.map((r) => r.id) }, visibilityNote(ctx));
  },
});
