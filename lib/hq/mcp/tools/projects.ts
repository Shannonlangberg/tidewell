/*
 * Projects and milestones over MCP (docs/hq-projects.md section 3): list, open, create and change a
 * project; add, change and complete its milestones. Reads need projects.read, writes projects.write.
 * Every read runs as the person (RLS: everyone with projects.read sees projects; the tasks inside still
 * follow the task rule, so counts are of the tasks THEY can see). Every write goes through the 0144 RPCs
 * (create_project, update_project, create_milestone, update_milestone, complete_milestone,
 * reopen_milestone), which check the capability again, validate, and write the activity and audit.
 *
 * Not here (HQ screens only): archiving or restoring a project, links to documents, related records,
 * reordering milestones. Nothing is ever deleted.
 */
import { appendNote, changeLine, clean, plural, rowLimit } from "./core";
import { can, day, dbFailure, defineTool, link, resolveStaff, respond, today, when, type ToolContext } from "./kit";
import {
  OVERVIEW_COLS,
  READ,
  TASK_COLS,
  WRITE,
  blockageLines,
  blockages,
  healthWord,
  loadMilestones,
  milestoneLine,
  nextActions,
  pickMilestone,
  projectHeadLine,
  projectPath,
  resolveProject,
  rpcFailure,
  statusWord,
  taskLine,
  toProjectRows,
  toTaskRows,
  visibilityNote,
  type RpcError,
} from "./project-kit";
import { completeMilestoneShape, createMilestoneShape, createProjectShape, getProjectShape, listProjectsShape, updateMilestoneShape, updateProjectShape } from "./project-schemas";

const NOT_HERE = "It never deletes anything; archiving or restoring a project, document links and related records are done in HQ only.";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
/** The client's rpc, bound to it (untyped arguments: the RPCs check every value themselves). */
const rpc = (ctx: ToolContext): Rpc => (fn, args) => (ctx.db.rpc as unknown as (this: unknown, f: string, a: Record<string, unknown>) => ReturnType<Rpc>).call(ctx.db, fn, args);

async function ownerFor(ctx: ToolContext, raw: string | undefined) {
  if (!raw) return { ok: true as const, id: null as string | null, label: null as string | null };
  const r = await resolveStaff(ctx, raw, "write");
  if (!r.ok) return r;
  return { ok: true as const, id: r.record.id, label: r.record.label };
}

// ── list_projects ────────────────────────────────────────────

export const listProjects = defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "Lists HQ projects in ONE call: number (PRJ-0001), name, status, health (on track, at risk, off track), progress (n of m done), target date, owner and next milestone, with links. Default: open projects (planning, active, on hold). Filters: status, health, owner, words of the name. Use it first for 'how are our projects going'; open one with get_project only when the person asks about that project. Counts include only the tasks you can see. Read-only.",
  inputSchema: listProjectsShape,
  annotations: READ,
  capability: "projects.read",
  kind: "read",
  handler: async (args, ctx) => {
    let owner: { id: string; label: string } | null = null;
    if (args.owner) {
      const r = await resolveStaff(ctx, args.owner, "read");
      if (!r.ok) return r.result;
      owner = { id: r.record.id, label: r.record.label };
    }
    const n = rowLimit(args.limit);
    const status = args.status ?? "open";
    let q = ctx.db.from("project_overview").select(OVERVIEW_COLS, { count: "exact" }).is("deleted_at", null);
    if (status === "open") q = q.in("status", ["planning", "active", "on_hold"]);
    else if (status !== "all") q = q.eq("status", status);
    if (args.health) q = q.eq("health", args.health);
    if (owner) q = q.eq("owner_id", owner.id);
    if (args.query) q = q.ilike("name", `%${args.query.replace(/[%_*\\,()"]/g, " ").trim()}%`);
    const { data, error, count } = await q.order("target_date", { ascending: true, nullsFirst: false }).order("name").limit(n);
    if (error) return dbFailure("list_projects", error);
    const rows = toProjectRows(data);
    const filters = [status === "open" ? "open" : status === "all" ? "all statuses" : statusWord(status), args.health ? healthWord(args.health) : null, owner ? `owned by ${clean(owner.label)}` : null, args.query ? `name has "${clean(args.query, 60)}"` : null].filter(Boolean).join(", ");
    if (rows.length === 0) return respond("empty", `No projects found (${filters}). Projects: ${link(ctx, "/hq/projects")}`, null, { count: 0 });
    const lines = rows.flatMap((p) => [projectHeadLine(ctx, p), ...(p.next_milestone_name ? [`    next milestone: ${clean(p.next_milestone_name)}${p.next_milestone_due ? `, due ${day(ctx, p.next_milestone_due)}` : ""}`] : [])]);
    const total = count ?? rows.length;
    return respond("ok", `${plural(total, "project")} (${filters})${total > rows.length ? `; showing ${rows.length}` : ""}. Projects: ${link(ctx, "/hq/projects")}`, lines, { count: rows.length, total, ids: rows.map((p) => p.id) }, visibilityNote(ctx));
  },
});

// ── get_project ──────────────────────────────────────────────

export const getProject = defineTool({
  name: "get_project",
  title: "Open a project",
  description:
    "Opens ONE project (PRJ-0001, id or name) as an overview in a single call: status, health and the plain reasons for it, progress, target date, milestones with due dates and done state, what is blocked and the first open task blocking each, overdue tasks, the next three actions, related records, recent activity, and `version` (for update_project). Counts and lists hold only the tasks you can see. Use it for 'how is the launch going' or before changing a project; for several projects use list_projects. Read-only.",
  inputSchema: getProjectShape,
  annotations: READ,
  capability: "projects.read",
  kind: "read",
  handler: async (args, ctx) => {
    const found = await resolveProject(ctx, args.project, "read");
    if (!found.ok) return found.result;
    const p = found.project;
    const td = today(ctx);
    const [milestones, tasksRes, activity, linksRes, docs] = await Promise.all([
      loadMilestones(ctx, [p.id]),
      ctx.db.from("task_overview").select(TASK_COLS).eq("project_id", p.id).is("deleted_at", null).limit(300),
      ctx.db.from("project_activity").select("at, kind, summary").eq("project_id", p.id).order("at", { ascending: false }).order("id", { ascending: false }).limit(8),
      ctx.db.from("project_links").select("contact_id, organisation_id, contractor_id, opportunity_id").eq("project_id", p.id).limit(50),
      ctx.db.from("project_documents").select("title, url").eq("project_id", p.id).order("added_at", { ascending: false }).limit(10),
    ]);
    if (tasksRes.error || activity.error || linksRes.error || docs.error) return dbFailure("get_project", tasksRes.error ?? activity.error ?? linksRes.error ?? docs.error);
    const tasks = toTaskRows(tasksRes.data);
    const open = tasks.filter((t) => t.status === "to_do" || t.status === "in_progress" || t.status === "waiting");
    const blocked = await blockages(ctx, open.filter((t) => t.is_blocked), tasks);
    const overdue = open.filter((t) => t.is_overdue).sort((a, b) => b.overdue_days - a.overdue_days);
    const next = nextActions(open, 3);

    // related records, labelled only where the person may read them
    const linkIds = (k: "contact_id" | "organisation_id" | "contractor_id" | "opportunity_id") => (linksRes.data ?? []).map((l) => l[k]).filter((v): v is string => !!v);
    const [contacts, orgs, contractors, opps] = await Promise.all([
      can(ctx, "growth.read") && linkIds("contact_id").length ? ctx.db.from("contacts").select("id, full_name").in("id", linkIds("contact_id")) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      can(ctx, "growth.read") && linkIds("organisation_id").length ? ctx.db.from("organisations").select("id, name").in("id", linkIds("organisation_id")) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      can(ctx, "contractors.read") && linkIds("contractor_id").length ? ctx.db.from("contractors").select("id, business_name").in("id", linkIds("contractor_id")) : Promise.resolve({ data: [] as { id: string; business_name: string }[] }),
      can(ctx, "growth.read") && linkIds("opportunity_id").length ? ctx.db.from("opportunities").select("id, prospect_name, display_number").in("id", linkIds("opportunity_id")) : Promise.resolve({ data: [] as { id: string; prospect_name: string | null; display_number: number }[] }),
    ]);
    const related = [
      ...(contacts.data ?? []).map((c) => `contact ${clean(c.full_name)} [id: ${c.id}]`),
      ...(orgs.data ?? []).map((o) => `organisation ${clean(o.name)} [id: ${o.id}]`),
      ...(contractors.data ?? []).map((c) => `contractor ${clean(c.business_name)} [id: ${c.id}]`),
      ...(opps.data ?? []).map((o) => `lead ${clean(o.prospect_name ?? `LEAD-${String(o.display_number).padStart(4, "0")}`)} [id: ${o.id}]`),
    ];
    const hiddenLinks = (linksRes.data ?? []).length - related.length;

    const url = link(ctx, projectPath(p.id));
    const lines: string[] = [
      `${p.ref}: ${clean(p.name)}`,
      `Status: ${statusWord(p.status)} · Priority: ${p.priority} · Owner: ${p.owner_name ? clean(p.owner_name) : "nobody"}`,
      `Dates: ${p.start_date ? `from ${day(ctx, p.start_date)}` : "no start date"}${p.target_date ? `, target ${day(ctx, p.target_date)}${p.days_to_target !== null ? ` (${p.days_to_target >= 0 ? `${p.days_to_target} days left` : `${-p.days_to_target} days ago`})` : ""}` : ", no target date"}`,
      `Health: ${healthWord(p.health)}`,
      ...(p.health_reasons ?? []).map((r) => `  - ${clean(r, 200)}`),
      `Progress: ${p.progress_total ? `${p.progress_done} of ${p.progress_total} top-level tasks done (${p.progress_pct}%)` : "no tasks yet"}; ${plural(p.open_count, "open task")}, ${p.overdue_count} overdue, ${p.blocked_count} blocked`,
      p.description ? `Description: ${clean(p.description, 600)}` : null,
      "",
      `Milestones (${p.milestones_done} of ${p.milestone_count} done):`,
      ...(milestones.length ? milestones.slice(0, 20).map((m) => milestoneLine(ctx, m, td)) : ["- none yet"]),
      "",
      "Next actions:",
      ...(next.length ? next.map((t) => taskLine(ctx, t)) : ["- nothing open that can be started now"]),
      ...(blocked.length ? ["", "Blocked:", ...blockageLines(ctx, blocked, 8)] : []),
      ...(overdue.length ? ["", `Overdue (${overdue.length}):`, ...overdue.slice(0, 8).map((t) => taskLine(ctx, t))] : []),
      ...(related.length || hiddenLinks > 0 ? ["", `Related: ${related.join("; ")}${hiddenLinks > 0 ? `${related.length ? "; " : ""}${hiddenLinks} record(s) your role cannot see` : ""}`] : []),
      ...((docs.data ?? []).length ? ["", "Document links:", ...(docs.data ?? []).map((d) => `- ${clean(d.title)}: ${clean(d.url, 300)}`)] : []),
      ...((activity.data ?? []).length ? ["", "Recent activity:", ...(activity.data ?? []).map((a) => `- ${when(ctx, a.at)}: ${clean(a.summary, 200)}`)] : []),
      p.notes ? `\nNotes (start):\n${clean(p.notes, 800, { multiline: true })}` : null,
    ].filter((l): l is string => l !== null);
    return respond("ok", [`${p.ref} ${clean(p.name)}: ${healthWord(p.health)}, ${p.progress_pct}% done. ${url}`, found.note ?? ""], lines, {
      id: p.id,
      ref: p.ref,
      url,
      version: p.version,
      health: p.health,
      progress_pct: p.progress_pct,
      milestone_ids: milestones.map((m) => m.id),
      next_task_ids: next.map((t) => t.id),
      blocked_task_ids: blocked.map((b) => b.task.id),
    }, visibilityNote(ctx));
  },
});

// ── create_project ───────────────────────────────────────────

export const createProject = defineTool({
  name: "create_project",
  title: "Create a project",
  description: `Creates ONE project: name, description, owner (default you), status (planning by default), priority, start and target dates, notes, and optionally up to 12 milestones in the same call (names and due dates, in order). Say what will be created and get a yes first. Then add the tasks with bulk_create_tasks (one call for the whole plan), not one create_task per task. Returns the PRJ number, its link and each milestone's id. ${NOT_HERE}`,
  inputSchema: createProjectShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const owner = await ownerFor(ctx, args.owner);
    if (!owner.ok) return owner.result;
    if (args.start_date && args.target_date && args.target_date < args.start_date) return respond("invalid", "Not saved: the target date can't be before the start date.");
    const names = (args.milestones ?? []).map((m) => m.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return respond("invalid", "Not saved: two milestones have the same name. Each milestone of a project needs its own name.");
    const { data, error } = await rpc(ctx)("create_project", {
      p_name: args.name,
      p_description: args.description ?? null,
      p_owner: owner.id,
      p_status: args.status ?? "planning",
      p_priority: args.priority ?? "normal",
      p_start: args.start_date ?? null,
      p_target: args.target_date ?? null,
      p_notes: args.notes ?? null,
    });
    if (error) return rpcFailure("create_project", error);
    const pr = data as { project_id: string; ref: string; name: string; status: string };
    const url = link(ctx, projectPath(pr.project_id));
    const made: Array<{ id: string; name: string }> = [];
    const failed: string[] = [];
    // Milestones one after another (order matters); each is its own small write through create_milestone.
    for (const m of args.milestones ?? []) {
      const r = await rpc(ctx)("create_milestone", { p_project: pr.project_id, p_name: m.name, p_description: m.description ?? null, p_due: m.due_date ?? null });
      if (r.error) failed.push(`${clean(m.name, 80)}: ${clean(r.error.message ?? "not saved", 200)}`);
      else made.push({ id: (r.data as { milestone_id: string }).milestone_id, name: m.name });
    }
    const lines = [
      `${pr.ref}: ${clean(pr.name)}`,
      `Status: ${statusWord(pr.status)} · Owner: ${owner.label ? clean(owner.label) : clean(ctx.staff.fullName)}`,
      args.target_date ? `Target: ${day(ctx, args.target_date)}` : null,
      ...made.map((m, i) => `Milestone ${i + 1}: ${clean(m.name)} [id: ${m.id}]`),
    ].filter((l): l is string => !!l);
    return respond(
      "ok",
      [`Created project ${pr.ref} [id: ${pr.project_id}]: ${url}`, made.length ? `With ${plural(made.length, "milestone")}.` : "", failed.length ? `${plural(failed.length, "milestone")} could not be added: ${failed.join("; ")}` : ""],
      lines,
      { id: pr.project_id, ref: pr.ref, url, created: "project", milestones: made, milestones_failed: failed.length },
    );
  },
});

// ── update_project ───────────────────────────────────────────

export const updateProject = defineTool({
  name: "update_project",
  title: "Update a project",
  description: `Changes ONE project (PRJ-0001, id or name): name, description, owner, status (planning, active, on_hold, completed, cancelled, with an optional note), priority, start or target date ("none" clears), or ADDS a dated note to its notes (the existing notes are kept). Only the fields given change; the result lists before and after. Refused if someone changed it since you read it. Archiving is not a status: ${NOT_HERE}`,
  inputSchema: updateProjectShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveProject(ctx, args.project, "write");
    if (!found.ok) return found.result;
    const p = found.project;
    const owner = await ownerFor(ctx, args.owner);
    if (!owner.ok) return owner.result;
    const clear: string[] = [];
    if (args.start_date === "none") clear.push("start_date");
    if (args.target_date === "none") clear.push("target_date");
    let notes: string | null = null;
    if (args.add_note) {
      const a = appendNote(p.notes, args.add_note, `${day(ctx, today(ctx))}, ${ctx.staff.fullName}`, 50_000);
      if (!a.ok) return respond("invalid", `Not saved: ${a.message}`);
      notes = a.value;
    }
    const { data, error } = await rpc(ctx)("update_project", {
      p_id: p.id,
      p_expected_version: p.version,
      p_name: args.name ?? null,
      p_description: args.description ?? null,
      p_owner: owner.id,
      p_status: args.status ?? null,
      p_priority: args.priority ?? null,
      p_start: args.start_date && args.start_date !== "none" ? args.start_date : null,
      p_target: args.target_date && args.target_date !== "none" ? args.target_date : null,
      p_notes: notes,
      p_clear: clear.length ? clear : null,
      p_note: args.status_note ?? null,
    });
    if (error) return rpcFailure("update_project", error, "Not changed");
    const r = data as { changed: boolean; changed_fields: string[]; status: string; name: string; owner_id: string | null; priority: string; start_date: string | null; target_date: string | null; version: number };
    const url = link(ctx, projectPath(p.id));
    if (!r.changed) return respond("unchanged", `Nothing to change: ${p.ref} already has those values. ${url}`, [`Project: ${clean(p.name)}`], { id: p.id, url });
    const f = new Set(r.changed_fields ?? []);
    const lines = [`Project: ${p.ref} ${clean(r.name)}`];
    if (f.has("name")) lines.push(changeLine("Name", p.name, r.name));
    if (f.has("status")) lines.push(changeLine("Status", statusWord(p.status), statusWord(r.status)));
    if (f.has("owner")) lines.push(changeLine("Owner", p.owner_name, owner.label));
    if (f.has("priority")) lines.push(changeLine("Priority", p.priority, r.priority));
    if (f.has("start_date")) lines.push(changeLine("Start", p.start_date ? day(ctx, p.start_date) : null, r.start_date ? day(ctx, r.start_date) : null));
    if (f.has("target_date")) lines.push(changeLine("Target", p.target_date ? day(ctx, p.target_date) : null, r.target_date ? day(ctx, r.target_date) : null));
    if (f.has("description")) lines.push(changeLine("Description", p.description, args.description));
    if (f.has("notes")) lines.push(`- Notes: added "${clean(args.add_note, 300)}"`);
    return respond("ok", `Updated project ${p.ref} [id: ${p.id}]: ${url}`, lines, { id: p.id, url, changed: [...f], version: r.version });
  },
});

// ── milestones ───────────────────────────────────────────────

async function projectAndMilestone(ctx: ToolContext, projectQ: string, milestoneQ: string) {
  const found = await resolveProject(ctx, projectQ, "write");
  if (!found.ok) return found;
  const list = await loadMilestones(ctx, [found.project.id]);
  const m = pickMilestone(list, found.project, milestoneQ);
  if (!m.ok) return m;
  return { ok: true as const, project: found.project, milestone: m.milestone };
}

export const createMilestone = defineTool({
  name: "create_milestone",
  title: "Add a milestone",
  description: `Adds ONE milestone to a project: its name (unique in the project), optional due date and description; it goes last in the order. For several at once when creating a project, use create_project's milestones. ${NOT_HERE}`,
  inputSchema: createMilestoneShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveProject(ctx, args.project, "write");
    if (!found.ok) return found.result;
    const p = found.project;
    const { data, error } = await rpc(ctx)("create_milestone", { p_project: p.id, p_name: args.name, p_description: args.description ?? null, p_due: args.due_date ?? null });
    if (error) return rpcFailure("create_milestone", error);
    const m = data as { milestone_id: string; name: string; due_date: string | null };
    return respond("ok", `Added milestone to ${p.ref} [id: ${m.milestone_id}]: ${link(ctx, projectPath(p.id))}`, [`Milestone: ${clean(m.name)}`, `Due: ${m.due_date ? day(ctx, m.due_date) : "no due date"}`, `Project: ${p.ref} ${clean(p.name)}`], { id: m.milestone_id, project_id: p.id, created: "milestone" });
  },
});

export const updateMilestone = defineTool({
  name: "update_milestone",
  title: "Change a milestone",
  description: `Changes ONE milestone of a project (by its name or id): a new name, due date ("none" clears), description, or reopen=true to reopen one that was marked done. ${NOT_HERE}`,
  inputSchema: updateMilestoneShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const r = await projectAndMilestone(ctx, args.project, args.milestone);
    if (!r.ok) return r.result;
    const { project: p, milestone: m } = r;
    const lines = [`Milestone: ${clean(m.name)} (${p.ref})`];
    let changed = false;
    if (args.name || args.description !== undefined || args.due_date) {
      const res = await rpc(ctx)("update_milestone", {
        p_id: m.id,
        p_name: args.name ?? null,
        p_description: args.description ? args.description : null,
        p_due: args.due_date && args.due_date !== "none" ? args.due_date : null,
        p_clear: [...(args.due_date === "none" ? ["due_date"] : []), ...(args.description === "" ? ["description"] : [])],
      });
      if (res.error) return rpcFailure("update_milestone", res.error, "Not changed");
      const after = res.data as { changed: boolean; name: string; due_date: string | null };
      if (after.changed) {
        changed = true;
        if (after.name !== m.name) lines.push(changeLine("Name", m.name, after.name));
        if (after.due_date !== m.due_date) lines.push(changeLine("Due", m.due_date ? day(ctx, m.due_date) : null, after.due_date ? day(ctx, after.due_date) : null));
        if (args.description !== undefined) lines.push(changeLine("Description", m.description, args.description));
      }
    }
    if (args.reopen) {
      const res = await rpc(ctx)("reopen_milestone", { p_id: m.id });
      if (res.error) return rpcFailure("reopen_milestone", res.error, "Not changed");
      if ((res.data as { changed: boolean }).changed) {
        changed = true;
        lines.push(changeLine("Status", "done", "open"));
      }
    }
    const url = link(ctx, projectPath(p.id));
    if (!changed) return respond("unchanged", `Nothing to change: the milestone already has those values. ${url}`, lines, { id: m.id });
    return respond("ok", `Changed milestone [id: ${m.id}] of ${p.ref}: ${url}`, lines, { id: m.id, project_id: p.id });
  },
});

export const completeMilestone = defineTool({
  name: "complete_milestone",
  title: "Complete a milestone",
  description: `Marks ONE milestone of a project done. Refused while any of its tasks are still open (the reply says how many); only if the person says to complete it anyway, call again with force=true and a note saying why. ${NOT_HERE}`,
  inputSchema: completeMilestoneShape,
  annotations: WRITE,
  capability: "projects.write",
  kind: "write",
  handler: async (args, ctx) => {
    const r = await projectAndMilestone(ctx, args.project, args.milestone);
    if (!r.ok) return r.result;
    const { project: p, milestone: m } = r;
    if (args.force && !args.note) return respond("invalid", "Not changed: completing a milestone that still has open tasks needs a note saying why.");
    const { data, error } = await rpc(ctx)("complete_milestone", { p_id: m.id, p_force: args.force ?? false, p_note: args.note ?? null });
    if (error) {
      if (error.hint === "milestone_open_tasks") {
        const open = await ctx.db.from("task_overview").select(TASK_COLS).eq("milestone_id", m.id).is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]).limit(10);
        return respond("refused", `Not changed: ${clean(error.message, 300)}. Ask whether to finish them first or complete the milestone anyway (force with a note).`, toTaskRows(open.data).map((t) => taskLine(ctx, t)), { code: "milestone_open_tasks" });
      }
      return rpcFailure("complete_milestone", error, "Not changed");
    }
    const d = data as { changed: boolean; open_tasks: number };
    const url = link(ctx, projectPath(p.id));
    if (!d.changed) return respond("unchanged", `Nothing to change: "${clean(m.name, 80)}" was already done. ${url}`, null, { id: m.id });
    return respond("ok", `Completed milestone [id: ${m.id}] of ${p.ref}${d.open_tasks ? ` with ${plural(d.open_tasks, "open task")} (note recorded)` : ""}: ${url}`, [`Milestone: ${clean(m.name)}`, changeLine("Status", "open", "done")], { id: m.id, project_id: p.id, open_tasks: d.open_tasks });
  },
});

