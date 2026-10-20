/*
 * Task writes: create one task, or change one task's status, due date, priority, assignee or
 * description. The input is re-read with the HQ task form's own validator (readTaskFields), the
 * linked records and assignee are checked through RLS (checkTaskReferences), and the write runs
 * as the person, so the database's policies and audit trigger apply exactly as on the screen.
 */
import type { Tables } from "../../db";
import { FormReader } from "../../forms";
import { TASK_FORM_LABELS, canTransition, isPastDate, readTaskFields } from "../../tasks/rules";
import { checkTaskReferences } from "../../tasks/write";
import { HQ_PATHS, changeLine, clean, invalidText, sameValue } from "./core";
import { can, day, dbFailure, defineTool, link, resolveContact, resolveContractor, resolveOrganisation, resolveStaff, resolveTask, respond, today, type ToolContext } from "./kit";
import { taskPriorityLabel, taskStatusLabel } from "./records";
import { NO_PROJECTS_READ, TASK_COLS, loadMilestones, pickMilestone, resolveProject, rpcFailure, toTaskRows, type ProjectRow } from "./project-kit";
import { createTaskShape, updateTaskShape } from "./schemas";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

type Ref = { id: string | null; label: string | null };

/**
 * Where a task goes in a project (create_task's project, milestone and parent): resolved as the person,
 * needing projects.write. A parent without a project puts the task in the parent's project (subtasks
 * share their parent's project; the database refuses anything else).
 */
async function placementFor(ctx: ToolContext, args: { project?: string; milestone?: string; parent?: string }) {
  type Out = { project: ProjectRow | null; milestoneId: string | null; milestoneName: string | null; parent: { id: string; title: string; projectId: string | null } | null };
  const out: Out = { project: null, milestoneId: null, milestoneName: null, parent: null };
  if (!args.project && !args.milestone && !args.parent) return { ok: true as const, ...out };
  if ((args.project || args.milestone) && !can(ctx, "projects.read")) return { ok: false as const, result: respond("refused", NO_PROJECTS_READ) };
  if ((args.project || args.milestone) && !can(ctx, "projects.write")) return { ok: false as const, result: respond("refused", "Refused: your HQ role does not include projects.write, so a task cannot be put in a project. Nothing was changed.") };
  if (args.parent) {
    const found = await resolveTask(ctx, args.parent, "write");
    if (!found.ok) return found;
    const { data, error } = await ctx.db.from("task_overview").select(TASK_COLS).eq("id", found.record.id).maybeSingle();
    if (error) return { ok: false as const, result: dbFailure("create_task parent", error) };
    const row = toTaskRows(data ? [data] : [])[0];
    if (!row) return { ok: false as const, result: respond("not_found", "The parent task could not be found. Nothing was changed.") };
    out.parent = { id: row.id, title: row.title, projectId: row.project_id };
  }
  if (args.project) {
    const found = await resolveProject(ctx, args.project, "write");
    if (!found.ok) return found;
    out.project = found.project;
  } else if (out.parent?.projectId) {
    const found = await resolveProject(ctx, out.parent.projectId, "read");
    if (found.ok) out.project = found.project;
  }
  if (args.milestone) {
    if (!out.project) return { ok: false as const, result: respond("invalid", "Not saved: a milestone belongs to a project. Say which project as well.") };
    const m = pickMilestone(await loadMilestones(ctx, [out.project.id]), out.project, args.milestone);
    if (!m.ok) return m;
    out.milestoneId = m.milestone.id;
    out.milestoneName = m.milestone.name;
  }
  return { ok: true as const, ...out };
}

/** "me" / a name / an id / "nobody" -> a staff id or null. */
async function assigneeFor(ctx: ToolContext, raw: string | undefined, fallbackMe: boolean) {
  const v = (raw ?? (fallbackMe ? "me" : "")).trim();
  if (!v || /^(nobody|no one|none|unassigned)$/i.test(v)) return { ok: true as const, ref: { id: null, label: null } as Ref };
  const found = await resolveStaff(ctx, v, "write");
  if (!found.ok) return found;
  return { ok: true as const, ref: { id: found.record.id, label: found.record.label } as Ref };
}

function form(values: Record<string, string | null | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== null && v !== undefined) fd.set(k, v);
  return fd;
}

export const createTask = defineTool({
  name: "create_task",
  title: "Create a task",
  description:
    "Creates ONE task in HQ: a title, optional description, due date, priority, assignee (default you; a name, \"me\" or \"nobody\"), optionally the contact, organisation or contractor it is about, and (with projects.write) the project, milestone and parent task it belongs to. Validated like the HQ task form and saved as you. Returns what was created and its HQ link. For more than two or three tasks use bulk_create_tasks (one call for the whole plan) instead of repeating this. It does not delete or archive anything.",
  inputSchema: createTaskShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "write",
  handler: async (args, ctx) => {
    const who = await assigneeFor(ctx, args.assignee, true);
    if (!who.ok) return who.result;
    const place = await placementFor(ctx, args);
    if (!place.ok) return place.result;
    const links: Record<string, Ref> = {};
    if (args.contact) {
      if (!can(ctx, "growth.read")) return respond("refused", "Refused: your role cannot link tasks to contacts (it needs growth.read). Nothing was created.");
      const r = await resolveContact(ctx, args.contact, "write");
      if (!r.ok) return r.result;
      links.contact = { id: r.record.id, label: r.record.label };
    }
    if (args.organisation) {
      if (!can(ctx, "growth.read")) return respond("refused", "Refused: your role cannot link tasks to organisations (it needs growth.read). Nothing was created.");
      const r = await resolveOrganisation(ctx, args.organisation, "write");
      if (!r.ok) return r.result;
      links.organisation = { id: r.record.id, label: r.record.label };
    }
    if (args.contractor) {
      if (!can(ctx, "contractors.read")) return respond("refused", "Refused: your role cannot link tasks to contractors (it needs contractors.read). Nothing was created.");
      const r = await resolveContractor(ctx, args.contractor, "write");
      if (!r.ok) return r.result;
      links.contractor = { id: r.record.id, label: r.record.label };
    }

    const reader = new FormReader(
      form({
        title: args.title,
        description: args.description,
        due_date: args.due_date,
        priority: args.priority ?? "normal",
        assigned_to: who.ref.id,
        related_contact_id: links.contact?.id,
        related_organisation_id: links.organisation?.id,
        related_contractor_id: links.contractor?.id,
      }),
    );
    const values = readTaskFields(reader);
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, TASK_FORM_LABELS));
    const checked = await checkTaskReferences(ctx.db, values, { canLink: can(ctx, "growth.read"), canLinkContractors: can(ctx, "contractors.read") });
    if (checked.ok === "error") return dbFailure("create_task references", { code: "check" });
    if (checked.ok === false) return respond("invalid", invalidText(checked.fieldErrors, TASK_FORM_LABELS));

    const inProject = !!place.project;
    const { data, error } = await ctx.db
      .from("tasks")
      .insert({
        title: values.title,
        description: values.description,
        due_date: values.dueDate,
        priority: values.priority,
        status: "to_do",
        assigned_to: values.assignedTo,
        related_contact_id: values.contactId,
        related_organisation_id: values.organisationId,
        related_contractor_id: values.contractorId,
        source: inProject ? "project" : "manual",
        ...(inProject ? { project_id: place.project!.id, milestone_id: place.milestoneId } : {}),
        ...(place.parent ? { parent_task_id: place.parent.id } : {}),
      })
      .select("id")
      .single();
    if (error || !data) return inProject || place.parent ? rpcFailure("create_task", error) : dbFailure("create_task", error);

    const url = link(ctx, HQ_PATHS.task(data.id));
    const lines = [
      `Title: ${clean(values.title)}`,
      values.description ? `Description: ${clean(values.description, 400)}` : null,
      `Due: ${values.dueDate ? day(ctx, values.dueDate) : "no due date"}`,
      `Priority: ${taskPriorityLabel(values.priority)}`,
      `Assigned to: ${who.ref.label ? clean(who.ref.label) : "nobody"}`,
      links.contact ? `Contact: ${clean(links.contact.label)}` : null,
      links.organisation ? `Organisation: ${clean(links.organisation.label)}` : null,
      links.contractor ? `Contractor: ${clean(links.contractor.label)}` : null,
      place.project ? `Project: ${place.project.ref} ${clean(place.project.name)}${place.milestoneName ? ` · Milestone: ${clean(place.milestoneName)}` : ""}` : null,
      place.parent ? `Subtask of: ${clean(place.parent.title)}` : null,
    ].filter((l): l is string => !!l);
    const warn = values.dueDate && isPastDate(values.dueDate, today(ctx)) ? "Note: the due date is already in the past, so the task is overdue." : null;
    return respond("ok", [`Created 1 task [id: ${data.id}]: ${url}`, warn ?? ""], lines, { id: data.id, url, created: "task" });
  },
});

export const updateTask = defineTool({
  name: "update_task",
  title: "Update a task",
  description:
    "Changes ONE task you can see, found by its title words or id: status (to_do, in_progress, waiting, completed, cancelled), due date, priority, assignee, description, and (with projects.write) its project or milestone, or a note on why it is held up (blocked_reason). Only the fields you give change; the result lists exactly what changed (before and after) and the HQ link. A completed or cancelled task must be reopened (to_do) first. For the same change to several tasks use bulk_update_tasks (one call). It never archives or deletes a task.",
  inputSchema: updateTaskShape,
  annotations: WRITE,
  capability: "tasks.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveTask(ctx, args.task, "write");
    if (!found.ok) return found.result;
    const { data: cur, error } = await ctx.db
      .from("tasks")
      .select("id, title, description, status, priority, due_date, assigned_to, created_by, updated_at, related_contact_id, related_organisation_id, related_contractor_id, related_referral_id, related_opportunity_id, project_id, milestone_id, blocked_reason")
      .eq("id", found.record.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) return dbFailure("update_task load", error);
    if (!cur) return respond("not_found", "That task could not be found. It may have been archived. Nothing was changed.");

    let assignee: Ref = { id: cur.assigned_to, label: null };
    if (args.assignee !== undefined) {
      const who = await assigneeFor(ctx, args.assignee, false);
      if (!who.ok) return who.result;
      assignee = who.ref;
      if (assignee.id !== cur.assigned_to && !(cur.created_by === ctx.staff.id || can(ctx, "tasks.read_all")) && assignee.id !== ctx.staff.id) {
        return respond("refused", "Refused: only the person who created this task, or someone who can see everyone's tasks, can give it to someone else. Nothing was changed.");
      }
    }
    const dueDate = args.due_date === undefined ? cur.due_date : args.due_date === "none" ? null : args.due_date;
    const reader = new FormReader(
      form({
        title: cur.title,
        description: args.description !== undefined ? args.description : cur.description,
        due_date: dueDate,
        priority: args.priority ?? cur.priority,
        assigned_to: assignee.id,
      }),
    );
    const values = readTaskFields(reader);
    if (!reader.ok) return respond("invalid", invalidText(reader.errors, TASK_FORM_LABELS));
    if (values.assignedTo !== cur.assigned_to) {
      const checked = await checkTaskReferences(ctx.db, { ...values, contactId: null, organisationId: null, referralId: null, opportunityId: null, contractorId: null }, { canLink: true, canLinkContractors: true });
      if (checked.ok === "error") return dbFailure("update_task assignee", { code: "check" });
      if (checked.ok === false) return respond("invalid", invalidText(checked.fieldErrors, TASK_FORM_LABELS));
    }

    const status = args.status ?? cur.status;
    if (status !== cur.status && !canTransition(cur.status, status)) {
      return respond(
        "invalid",
        `Not changed: a task that is ${taskStatusLabel(cur.status).toLowerCase()} can't be marked ${taskStatusLabel(status).toLowerCase()}.${cur.status === "completed" || cur.status === "cancelled" ? " Reopen it (status to_do) first." : ""}`,
      );
    }

    // Project, milestone and the held-up note (projects.write for the first two; the database checks again).
    let projectId = cur.project_id;
    let milestoneId = cur.milestone_id;
    let projectLabel: { before: string | null; after: string | null } | null = null;
    let milestoneLabel: { before: string | null; after: string | null } | null = null;
    if (args.project !== undefined || args.milestone !== undefined) {
      if (!can(ctx, "projects.read")) return respond("refused", NO_PROJECTS_READ);
      if (!can(ctx, "projects.write")) return respond("refused", "Refused: your HQ role does not include projects.write, so a task cannot be moved between projects or milestones. Nothing was changed.");
      const curProject = cur.project_id ? await resolveProject(ctx, cur.project_id, "read") : null;
      const curRow = curProject && curProject.ok ? curProject.project : null;
      let target = curRow;
      if (args.project !== undefined) {
        if (/^none$/i.test(args.project)) target = null;
        else {
          const found = await resolveProject(ctx, args.project, "write");
          if (!found.ok) return found.result;
          target = found.project;
        }
        projectId = target?.id ?? null;
        if (projectId !== cur.project_id) {
          projectLabel = { before: curRow ? `${curRow.ref} ${curRow.name}` : null, after: target ? `${target.ref} ${target.name}` : null };
          milestoneId = null;
        }
      }
      const ms = await loadMilestones(ctx, [cur.project_id, projectId].filter((v): v is string => !!v));
      const nameOf = (id: string | null) => (id ? (ms.find((m) => m.id === id)?.name ?? null) : null);
      if (args.milestone !== undefined) {
        if (/^none$/i.test(args.milestone)) milestoneId = null;
        else {
          if (!target) return respond("invalid", "Not changed: a milestone belongs to a project, and this task is not in one. Say which project as well.");
          const m = pickMilestone(ms, target, args.milestone);
          if (!m.ok) return m.result;
          milestoneId = m.milestone.id;
        }
      }
      if (milestoneId !== cur.milestone_id) milestoneLabel = { before: nameOf(cur.milestone_id), after: nameOf(milestoneId) };
    }
    const blockedReason = args.blocked_reason === undefined ? cur.blocked_reason : args.blocked_reason.trim() || null;

    const next = { status, due_date: values.dueDate, priority: values.priority, assigned_to: values.assignedTo, description: values.description, project_id: projectId, milestone_id: milestoneId, blocked_reason: blockedReason };
    const before = { status: cur.status, due_date: cur.due_date, priority: cur.priority, assigned_to: cur.assigned_to, description: cur.description, project_id: cur.project_id, milestone_id: cur.milestone_id, blocked_reason: cur.blocked_reason };
    const update: Record<string, unknown> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (!sameValue(next[k], before[k])) update[k] = next[k];
    const url = link(ctx, HQ_PATHS.task(cur.id));
    if (Object.keys(update).length === 0) return respond("unchanged", `Nothing to change: the task already has those values. ${url}`, [`Task: ${clean(cur.title)}`], { id: cur.id, url });

    // Compare-and-set on updated_at: if someone else changed it meanwhile, nothing is written. No RETURNING
    // (a reassigned task may no longer be visible to the person who handed it over).
    const res = await ctx.db.from("tasks").update(update as Tables["tasks"]["Update"], { count: "exact" }).eq("id", cur.id).eq("updated_at", cur.updated_at).is("deleted_at", null);
    if (res.error) return "project_id" in update || "milestone_id" in update ? rpcFailure("update_task", res.error, "Not changed") : dbFailure("update_task", res.error);
    if (!res.count) return respond("unchanged", "Not changed: the task was changed by someone else a moment ago, or you may not edit it. Look at it in HQ and try again.", null, { id: cur.id, url });

    const names = new Map<string, string>();
    const ids = [before.assigned_to, next.assigned_to].filter((v): v is string => !!v);
    if ("assigned_to" in update && ids.length) {
      const s = await ctx.db.from("staff_profiles").select("id, full_name").in("id", ids);
      for (const r of s.data ?? []) names.set(r.id, r.full_name);
    }
    const lines = [`Task: ${clean(cur.title)}`];
    if ("status" in update) lines.push(changeLine("Status", taskStatusLabel(before.status), taskStatusLabel(next.status)));
    if ("due_date" in update) lines.push(changeLine("Due", before.due_date ? day(ctx, before.due_date) : null, next.due_date ? day(ctx, next.due_date) : null));
    if ("priority" in update) lines.push(changeLine("Priority", taskPriorityLabel(before.priority), taskPriorityLabel(next.priority)));
    if ("assigned_to" in update) lines.push(changeLine("Assigned to", before.assigned_to ? (names.get(before.assigned_to) ?? "someone") : "nobody", next.assigned_to ? (names.get(next.assigned_to) ?? "someone") : "nobody"));
    if ("description" in update) lines.push(changeLine("Description", before.description, next.description));
    if (projectLabel) lines.push(changeLine("Project", projectLabel.before, projectLabel.after));
    if (milestoneLabel) lines.push(changeLine("Milestone", milestoneLabel.before, milestoneLabel.after));
    if ("blocked_reason" in update) lines.push(changeLine("Held up because", before.blocked_reason, next.blocked_reason));
    return respond("ok", `Updated 1 task [id: ${cur.id}]: ${url}`, lines, { id: cur.id, url, changed: Object.keys(update) });
  },
});
