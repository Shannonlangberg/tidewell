/*
 * Tasks and the team: the same task views as the HQ tasks screen (built with the same predicate
 * code, lib/hq/tasks/rules.ts), and the staff directory reduced to names and roles.
 */
import { ROLE_LABEL, type StaffRole } from "../../constants";
import { buildPredicate, parseTaskListQuery, TASK_VIEWS } from "../../tasks/rules";
import { listTasks as loadTasks } from "../../tasks/queries";
import { HQ_PATHS, clean, plural, rowLimit } from "./core";
import { can, day, dbFailure, defineTool, link, respond, today } from "./kit";
import { taskPriorityLabel, taskStatusLabel } from "./records";
import { listTasksShape, teamDirectoryShape } from "./schemas";

export const listTasks = defineTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "Lists tasks the way the HQ tasks screen does: my open tasks (default), due today, overdue, upcoming, waiting, completed, tasks I gave to others, or (with tasks.read_all) the team's and all tasks. Filter by title words, priority or status. Only tasks you are allowed to see are listed. Read-only.",
  inputSchema: listTasksShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: null,
  kind: "read",
  handler: async (args, ctx) => {
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
