/*
 * Tasks and the team: the same task views as the HQ tasks screen (built with the same predicate
 * code, lib/hq/tasks/rules.ts), and the staff directory reduced to names and roles.
 */
import { ROLE_LABEL, type StaffRole } from "../../constants";
import { buildPredicate, parseTaskListQuery, TASK_VIEWS, type TaskPredicate } from "../../tasks/rules";
import { listTasks as loadTasks } from "../../tasks/queries";
import { HQ_PATHS, clean, plural, rowLimit } from "./core";
import { can, day, dbFailure, defineTool, link, resolveTask, respond, today, type ToolContext, type ToolResult } from "./kit";
import { NO_PROJECTS_READ, TASK_COLS, loadMilestones, pickMilestone, resolveProject, taskLine, toTaskRows, visibilityNote, projectPath } from "./project-kit";
import { taskPriorityLabel, taskStatusLabel } from "./records";
import { listTasksShape, teamDirectoryShape } from "./schemas";

export const listTasks = defineTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "Lists tasks the way the HQ tasks screen does: my open tasks (default), due today, overdue, upcoming, waiting, completed, tasks I gave to others, or (with tasks.read_all) the team's and all tasks. Filter by title words, priority or status, and also by project and milestone (projects.read), the subtasks of a task (parent), or blocked (waiting on an unfinished task). With a project, milestone or parent and no view, it lists every open task in it that you can see. Only tasks you are allowed to see are listed. Read-only.",
  inputSchema: listTasksShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: null,
  kind: "read",
  handler: async (args, ctx) => {
    if (args.project || args.milestone || args.parent || args.blocked !== undefined) return listStructured(args, ctx);
    const n = rowLimit(args.limit);
    const canReadAll = can(ctx, "tasks.read_all");
    const query = parseTaskListQuery({ view: args.view, q: args.query, priority: args.priority, status: args.status }, { canReadAll, canFilterRelated: false });
    const fellBack = args.view && args.view !== query.view;
    const predicate = buildPredicate(query, { meId: ctx.staff.id, today: today(ctx), now: new Date() });
    const page = await loadTasks(ctx.db, predicate, { sort: query.sort, dir: query.dir, page: 1, pageSize: n, canGrowth: can(ctx, "growth.read"), canContractors: can(ctx, "contractors.read") });
    if (!page.ok) return dbFailure("list_tasks", { code: "load" });
    const def = TASK_VIEWS[query.view];
    const head = `${def.label}: ${def.description}${fellBack ? ` (The "${args.view}" view needs tasks.read_all, so this is your own list.)` : ""}`;
    if (page.data.total === 0) return respond("empty", `${head}\n${def.empty.title}.`, null, { count: 0, view: query.view });
    const t = today(ctx);
    const lines = page.data.rows.map((r) => {
      const overdue = r.dueDate && r.dueDate < t && (r.status === "to_do" || r.status === "in_progress" || r.status === "waiting");
      const rel = [
        r.related.contact?.label && `contact ${clean(r.related.contact.label)}`,
        r.related.organisation?.label && `organisation ${clean(r.related.organisation.label)}`,
        r.related.contractor?.label && `contractor ${clean(r.related.contractor.label)}`,
        r.related.referral?.label && `referral ${clean(r.related.referral.label)}`,
      ].filter(Boolean);
      return `- ${clean(r.title)} [id: ${r.id}] - ${taskStatusLabel(r.status)}, ${taskPriorityLabel(r.priority).toLowerCase()} priority - ${r.dueDate ? `due ${day(ctx, r.dueDate)}${overdue ? " (OVERDUE)" : ""}` : "no due date"} - ${r.assignedTo ? clean(r.assignedToName ?? "someone") : "unassigned"}${rel.length ? ` - ${rel.join(", ")}` : ""}`;
    });
    return respond("ok", `${head}\n${plural(page.data.total, "task")}${page.data.total > lines.length ? `, showing ${lines.length}` : ""}. Tasks: ${link(ctx, HQ_PATHS.tasks())}`, lines, {
      count: page.data.total,
      view: query.view,
      ids: page.data.rows.map((r) => r.id),
    });
  },
});

export const teamDirectory = defineTool({
  name: "team_directory",
  title: "Team directory",
  description: "Lists the active Planted staff: names and roles only (no contact details). Use it to find who to assign work to. Read-only; people and roles are managed only on the HQ People screen.",
  inputSchema: teamDirectoryShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "people.read",
  kind: "read",
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.db.from("staff_profiles").select("id, full_name, role").eq("is_active", true).eq("employment_status", "active").order("full_name").limit(200);
    if (error) return dbFailure("team_directory", error);
    const rows = data ?? [];
    if (rows.length === 0) return respond("empty", "No active staff are listed.");
    const lines = rows.map((r) => `- ${clean(r.full_name)} [id: ${r.id}] - ${r.role in ROLE_LABEL ? ROLE_LABEL[r.role as StaffRole] : r.role}${r.id === ctx.staff.id ? " (you)" : ""}`);
    return respond("ok", `${plural(rows.length, "active staff member")}.`, lines, { count: rows.length });
  },
});

type ListArgs = { view?: string; query?: string; priority?: string; status?: string; project?: string; milestone?: string; parent?: string; blocked?: boolean; limit?: number };

/**
 * list_tasks with a project, milestone, parent or blocked filter: the same view predicate as the tasks
 * screen (lib/hq/tasks/rules.ts), applied to hq.task_overview (which carries project, milestone and blocked).
 * With a project, milestone or parent and NO view, every open task in it that the person can see.
 */
async function listStructured(args: ListArgs, ctx: ToolContext): Promise<ToolResult> {
  if ((args.project || args.milestone) && !can(ctx, "projects.read")) return respond("refused", NO_PROJECTS_READ);
  const n = rowLimit(args.limit);
  const canReadAll = can(ctx, "tasks.read_all");
  const scoped = !!(args.project || args.milestone || args.parent);
  const query = parseTaskListQuery({ view: args.view ?? "mine", q: args.query, priority: args.priority, status: args.status }, { canReadAll, canFilterRelated: false });
  const p: TaskPredicate = buildPredicate(query, { meId: ctx.staff.id, today: today(ctx), now: new Date() });
  const what: string[] = [];
  let projectId: string | null = null;
  let milestoneId: string | null = null;
  let parentId: string | null = null;
  if (args.project) {
    const found = await resolveProject(ctx, args.project, "read");
    if (!found.ok) return found.result;
    projectId = found.project.id;
    what.push(`in ${found.project.ref} ${clean(found.project.name, 80)}`);
    if (args.milestone) {
      const m = pickMilestone(await loadMilestones(ctx, [projectId]), found.project, args.milestone);
      if (!m.ok) return m.result;
      milestoneId = m.milestone.id;
      what.push(`milestone ${clean(m.milestone.name, 80)}`);
    }
  } else if (args.milestone) return respond("invalid", "Not done: a milestone belongs to a project. Say which project as well.");
  if (args.parent) {
    const found = await resolveTask(ctx, args.parent, "read");
    if (!found.ok) return found.result;
    parentId = found.record.id;
    what.push(`subtasks of ${clean(found.record.label, 80)}`);
  }
  if (args.blocked === true) what.push("blocked");
  if (args.blocked === false) what.push("not blocked");

  let q = ctx.db.from("task_overview").select(TASK_COLS, { count: "exact" }).is("deleted_at", null);
  // With a scope and no explicit view, every open task in it the person can see (any assignee).
  const anyone = scoped && !args.view;
  if (p.statuses.length) q = q.in("status", p.statuses);
  if (!anyone) {
    if (p.assignee.kind === "is") q = q.eq("assigned_to", p.assignee.id);
    else if (p.assignee.kind === "none") q = q.is("assigned_to", null);
    else if (p.assignee.kind === "not") q = q.or(`assigned_to.is.null,assigned_to.neq.${p.assignee.id}`);
    if (p.createdBy) q = q.eq("created_by", p.createdBy);
  }
  if (p.due?.eq) q = q.eq("due_date", p.due.eq);
  if (p.due?.lt) q = q.lt("due_date", p.due.lt);
  if (p.due?.gt) q = q.gt("due_date", p.due.gt);
  if (p.due?.lte) q = q.lte("due_date", p.due.lte);
  if (p.completedSince) q = q.gte("completed_at", p.completedSince);
  if (p.priority) q = q.eq("priority", p.priority);
  if (p.title) q = q.ilike("title", `%${p.title.replace(/[%_*\\,()"]/g, " ").trim()}%`);
  if (projectId) q = q.eq("project_id", projectId);
  if (milestoneId) q = q.eq("milestone_id", milestoneId);
  if (parentId) q = q.eq("parent_task_id", parentId);
  if (args.blocked !== undefined) q = q.eq("is_blocked", args.blocked);
  const { data, error, count } = await q.order("is_overdue", { ascending: false }).order("due_date", { ascending: true, nullsFirst: false }).order("sort_order").order("created_at").limit(n);
  if (error) return dbFailure("list_tasks (structured)", error);
  const rows = toTaskRows(data);
  const def = TASK_VIEWS[query.view];
  const label = anyone ? "Open tasks you can see" : `${def.label}: ${def.description}`;
  const scope = what.length ? ` (${what.join(", ")})` : "";
  const where = projectId ? link(ctx, projectPath(projectId)) : link(ctx, HQ_PATHS.tasks());
  if (rows.length === 0) return respond("empty", `${label}${scope}: none.`, null, { count: 0, view: query.view });
  const total = count ?? rows.length;
  return respond("ok", `${label}${scope}: ${plural(total, "task")}${total > rows.length ? `, showing ${rows.length}` : ""}. ${where}`, rows.map((t) => taskLine(ctx, t, { project: !projectId })), { count: total, view: query.view, ids: rows.map((t) => t.id) }, projectId ? visibilityNote(ctx) : null);
}
