/*
 * Input schemas for the Projects, richer-task and bulk-task MCP tools (zod raw shapes), docs/hq-projects.md
 * section 3. Imports only zod: the vocabularies are written out and pinned to lib/hq/projects/rules.ts and
 * lib/hq/constants.ts by project-schemas.test.mts.
 *
 * These are the first gate, not the last: the RPCs validate every value again (and decide visibility,
 * permissions, cycles and the bulk budget).
 */
import { z } from "zod";

export const PROJECT_STATUS_VALUES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
/** A new project starts in one of these (completed and cancelled are later decisions). */
export const NEW_PROJECT_STATUS_VALUES = ["planning", "active", "on_hold"] as const;
export const PROJECT_HEALTH_VALUES = ["on_track", "at_risk", "off_track", "on_hold", "done"] as const;
export const TASK_PRIORITY_VALUES_P = ["low", "normal", "high", "urgent"] as const;
export const TASK_STATUS_VALUES_P = ["to_do", "in_progress", "waiting", "completed", "cancelled"] as const;
/** A task created in bulk starts open. */
export const NEW_TASK_STATUS_VALUES = ["to_do", "in_progress", "waiting"] as const;

/** Bounds (the database enforces the same or wider ones). */
export const BULK_MAX = 50;
export const BULK_DEPENDS_MAX = 10;
export const BULK_CHECKLIST_MAX = 12;
export const CHECKLIST_MAX = 50;
export const CHECKLIST_TEXT_MAX = 300;
export const COMMENT_MAX = 4000;
export const NAME_MAX = 200;
export const PROJECT_DESCRIPTION_MAX = 5000;
export const NOTES_MAX = 50_000;
export const MILESTONE_DESCRIPTION_MAX = 2000;
export const TASK_DESCRIPTION_MAX = 4000;
export const BLOCKED_REASON_MAX = 500;
export const NEW_PROJECT_MILESTONES_MAX = 12;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (what: string) => z.string().regex(DATE, "Use YYYY-MM-DD.").describe(`${what} (YYYY-MM-DD, in the person's own timezone).`);
const optDate = (what: string) => date(what).optional().describe(`Optional. ${what} (YYYY-MM-DD, in the person's own timezone).`);
const clearableDate = (what: string) =>
  z
    .union([z.string().regex(DATE, "Use YYYY-MM-DD."), z.literal("none")])
    .optional()
    .describe(`Optional. ${what} (YYYY-MM-DD), or "none" to clear it.`);
const limit = z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10).");
const person = (what: string) => z.string().trim().min(1).max(200).optional().describe(`Optional. ${what}: "me", a team member's name, or their id.`);

const project = (extra = "") =>
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(`The project: its number as HQ shows it (PRJ-0001), its id from an earlier result, or its name (if several match you get candidates to choose from).${extra ? ` ${extra}` : ""}`);
const optProject = (extra = "") => project(extra).optional().describe(`Optional. The project: PRJ-0001, its id, or its name.${extra ? ` ${extra}` : ""}`);
const milestone = (extra = "") =>
  z.string().trim().min(1).max(200).describe(`The milestone: its name within the project (any case), or its id from an earlier result.${extra ? ` ${extra}` : ""}`);
const task = (what: string) =>
  z.string().trim().min(1).max(200).describe(`${what}: its id from an earlier result (best), or words of its title (if several match you get candidates to choose from).`);
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/, "Letters, digits and . _ : - only.")
  .describe(
    "Required. A key that makes this call safe to retry: generate ONE fresh UUID for each distinct plan and REUSE exactly the same key (and the same entries) if you retry after a timeout or error. A repeat with the same key returns the first result and creates nothing again; the same key with DIFFERENT entries is refused, so a changed plan needs a new key.",
  );
const atomic = z
  .boolean()
  .optional()
  .describe("Optional. true = all or nothing: if any entry is invalid, nothing at all is written. false (default) = the valid entries are saved and each invalid one is reported with its reasons (entries that depend on a failed one fail too).");

// ── projects ─────────────────────────────────────────────────

const newMilestone = z
  .object({
    name: z.string().trim().min(1).max(NAME_MAX).describe("The milestone's name (unique within the project)."),
    due_date: optDate("When it is due"),
    description: z.string().trim().max(MILESTONE_DESCRIPTION_MAX).optional().describe(`Optional. A line about what it means (at most ${MILESTONE_DESCRIPTION_MAX} characters).`),
  })
  .describe("One milestone of the new project.");

export const createProjectShape = {
  name: z.string().trim().min(1).max(NAME_MAX).describe(`The project's name (at most ${NAME_MAX} characters; unique among live projects).`),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional().describe(`Optional. What the project is for, in a few lines (at most ${PROJECT_DESCRIPTION_MAX} characters).`),
  owner: person('Who owns it (default "me")'),
  status: z.enum(NEW_PROJECT_STATUS_VALUES).optional().describe("Optional. planning (default), active or on_hold."),
  priority: z.enum(TASK_PRIORITY_VALUES_P).optional().describe("Optional. low, normal (default), high or urgent."),
  start_date: optDate("When it starts"),
  target_date: optDate("When it should be finished (not before the start date)"),
  notes: z.string().trim().max(NOTES_MAX).optional().describe("Optional. Longer notes, in simple markdown (headings, lists, links)."),
  milestones: z
    .array(newMilestone)
    .max(NEW_PROJECT_MILESTONES_MAX)
    .optional()
    .describe(`Optional. Up to ${NEW_PROJECT_MILESTONES_MAX} milestones to add straight away, in order (saves separate create_milestone calls).`),
};

export const listProjectsShape = {
  status: z
    .enum(["open", "all", ...PROJECT_STATUS_VALUES])
    .optional()
    .describe("Optional. open (default: planning, active and on hold), all, or one status: planning, active, on_hold, completed, cancelled."),
  health: z.enum(PROJECT_HEALTH_VALUES).optional().describe("Optional. Only projects with this health: on_track, at_risk, off_track, on_hold, done."),
  owner: person("Only projects this person owns"),
  query: z.string().trim().max(100).optional().describe("Optional. Words to match in the project's name."),
  limit,
};

export const getProjectShape = { project: project() };

export const updateProjectShape = {
  project: project(),
  name: z.string().trim().min(1).max(NAME_MAX).optional().describe("Optional. A new name."),
  description: z.string().trim().max(PROJECT_DESCRIPTION_MAX).optional().describe("Optional. Replaces the description."),
  owner: person("A new owner"),
  status: z
    .enum(PROJECT_STATUS_VALUES)
    .optional()
    .describe("Optional. New status: planning, active, on_hold, completed or cancelled. Archiving a project is not a status: it is done in HQ only."),
  status_note: z.string().trim().max(500).optional().describe("Optional. Why the status changed (recorded in the project's history)."),
  priority: z.enum(TASK_PRIORITY_VALUES_P).optional().describe("Optional. New priority."),
  start_date: clearableDate("New start date"),
  target_date: clearableDate("New target date"),
  add_note: z.string().trim().min(1).max(4000).optional().describe("Optional. A note to ADD to the end of the project's notes (dated and signed). The existing notes are kept."),
};

export const createMilestoneShape = {
  project: project(),
  name: z.string().trim().min(1).max(NAME_MAX).describe("The milestone's name (unique within the project)."),
  due_date: optDate("When it is due"),
  description: z.string().trim().max(MILESTONE_DESCRIPTION_MAX).optional().describe("Optional. What it means."),
};

export const updateMilestoneShape = {
  project: project(),
  milestone: milestone(),
  name: z.string().trim().min(1).max(NAME_MAX).optional().describe("Optional. A new name."),
  due_date: clearableDate("New due date"),
  description: z.string().trim().max(MILESTONE_DESCRIPTION_MAX).optional().describe("Optional. Replaces the description."),
  reopen: z.boolean().optional().describe("Optional. true = reopen a milestone that was marked done."),
};

export const completeMilestoneShape = {
  project: project(),
  milestone: milestone(),
  force: z.boolean().optional().describe("Optional. true = mark it done even though some of its tasks are still open (needs a note saying why). Only when the person said so."),
  note: z.string().trim().max(500).optional().describe("Optional (required with force). A note for the history."),
};

// ── tasks ────────────────────────────────────────────────────

export const getTaskShape = { task: task("The task") };

export const completeTaskShape = {
  task: task("The task to mark completed"),
  note: z.string().trim().max(1000).optional().describe("Optional. A short note for the task's history (for example 'Enrolled in the course')."),
};

export const addTaskDependencyShape = {
  task: task("The task that has to wait"),
  depends_on: task("The task it waits for (it must be finished first)"),
};

export const removeTaskDependencyShape = {
  task: task("The task that was waiting"),
  depends_on: task("The task it no longer waits for"),
};

export const addTaskCommentShape = {
  task: task("The task"),
  body: z.string().trim().min(1).max(COMMENT_MAX).describe(`The comment, as the person said it (at most ${COMMENT_MAX} characters).`),
};

const checklistItem = z.union([
  z.string().trim().min(1).max(CHECKLIST_TEXT_MAX).describe("An item that is not done yet."),
  z
    .object({
      text: z.string().trim().min(1).max(CHECKLIST_TEXT_MAX).describe(`The item (at most ${CHECKLIST_TEXT_MAX} characters).`),
      done: z.boolean().optional().describe("Optional. true = ticked."),
    })
    .describe("An item, ticked or not."),
]);

export const setTaskChecklistShape = {
  task: task("The task"),
  items: z
    .array(checklistItem)
    .max(CHECKLIST_MAX)
    .describe(
      `The WHOLE checklist, in order (at most ${CHECKLIST_MAX} items): it replaces the current one. To tick or add one item, read the task first (get_task) and send the full list back with the change. An empty list clears it.`,
    ),
};

// ── bulk ─────────────────────────────────────────────────────

const ref = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, "Letters, digits and . _ - only.")
  .describe("A short key YOU choose for this entry, unique in this call (for example t1, t2 or licence). Other entries use it in parent_ref and depends_on. Default: the entry's position (1, 2, 3 ...).");

const bulkTask = z
  .object({
    ref: ref.optional(),
    title: z.string().trim().min(1).max(NAME_MAX).describe(`What needs doing (at most ${NAME_MAX} characters).`),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX).optional().describe(`Optional. More detail (at most ${TASK_DESCRIPTION_MAX} characters).`),
    assignee: z.string().trim().min(1).max(200).optional().describe('Optional. Who does it: "me" (default), a team member\'s name or id, or "nobody".'),
    priority: z.enum(TASK_PRIORITY_VALUES_P).optional().describe("Optional. low, normal (default), high or urgent."),
    status: z.enum(NEW_TASK_STATUS_VALUES).optional().describe("Optional. to_do (default), in_progress or waiting."),
    due_date: optDate("When it is due"),
    project: optProject("Default: the call's project."),
    milestone: z.string().trim().min(1).max(200).optional().describe("Optional. The milestone in its project: the milestone's name (any case) or id."),
    parent_ref: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("Optional. Makes this a subtask (one level only): the ref of another entry in this call, or the id of an existing task in the same project."),
    depends_on: z
      .array(z.string().trim().min(1).max(60).describe("A ref of another entry in this call, or the id of an existing task."))
      .max(BULK_DEPENDS_MAX)
      .optional()
      .describe(`Optional. Up to ${BULK_DEPENDS_MAX} tasks that must be finished before this one can start: refs of entries in this call, or ids of existing tasks. Cycles are refused.`),
    checklist: z
      .array(z.string().trim().min(1).max(CHECKLIST_TEXT_MAX).describe("One checklist item."))
      .max(BULK_CHECKLIST_MAX)
      .optional()
      .describe(`Optional. Up to ${BULK_CHECKLIST_MAX} checklist items (not ticked).`),
    contact: z.string().trim().min(1).max(200).optional().describe("Optional. The contact (person) this task is about: name or id (needs growth.read)."),
    organisation: z.string().trim().min(1).max(200).optional().describe("Optional. The organisation this task is about: name or id (needs growth.read)."),
    contractor: z.string().trim().min(1).max(200).optional().describe("Optional. The contractor this task is about: business name or id (needs contractors.read)."),
  })
  .describe("One task to create.");

export const bulkCreateTasksShape = {
  tasks: z.array(bulkTask).min(1, "Give at least one task.").max(BULK_MAX, `At most ${BULK_MAX} tasks in one call.`).describe(`The tasks to create, 1 to ${BULK_MAX}, in the order of the plan.`),
  project: optProject("The project every entry goes into unless the entry names another (by name, PRJ-0001 or id)."),
  idempotency_key: idempotencyKey,
  atomic,
};

const bulkUpdate = z
  .object({
    task: task("The task to change"),
    title: z.string().trim().min(1).max(NAME_MAX).optional().describe("Optional. A new title."),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX).optional().describe("Optional. Replaces the description."),
    status: z.enum(TASK_STATUS_VALUES_P).optional().describe("Optional. New status (a completed or cancelled task must be reopened to to_do first)."),
    assignee: z.string().trim().min(1).max(200).optional().describe('Optional. New assignee: "me", a name, an id, or "nobody".'),
    priority: z.enum(TASK_PRIORITY_VALUES_P).optional().describe("Optional. New priority."),
    due_date: clearableDate("New due date"),
    project: z.string().trim().min(1).max(200).optional().describe('Optional. Move it into this project (PRJ-0001, id or name), or "none" to take it out of its project.'),
    milestone: z.string().trim().min(1).max(200).optional().describe('Optional. The milestone in its (new) project, by name or id, or "none".'),
    add_dependency: z.string().trim().min(1).max(60).optional().describe("Optional. The id of a task this one must now wait for."),
    complete: z.boolean().optional().describe("Optional. true = mark it completed (same as status completed)."),
  })
  .describe("One change to one existing task.");

export const bulkUpdateTasksShape = {
  updates: z.array(bulkUpdate).min(1, "Give at least one change.").max(BULK_MAX, `At most ${BULK_MAX} changes in one call.`).describe(`The changes, 1 to ${BULK_MAX}, one entry per task.`),
  idempotency_key: idempotencyKey,
  atomic,
};

// ── focus and overviews ──────────────────────────────────────

export const founderPrioritiesShape = {
  limit: z.number().int().min(1).max(10).optional().describe("Optional. How many priorities, 1 to 10 (default 3)."),
  project: optProject("Also say what is holding this project up (its first open blockers)."),
};

export const listOverdueShape = {
  scope: z.enum(["mine", "all"]).optional().describe("Optional. mine (default: tasks assigned to me) or all (everyone's; needs tasks.read_all, otherwise your own)."),
  project: optProject("Only this project's overdue tasks."),
  limit,
};

export const whatIsBlockingShape = { project: project() };
