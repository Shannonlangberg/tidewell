/*
 * Input schemas for the command-center MCP tools (lib/hq/mcp/tools/leadership.ts; docs/hq-command-center.md
 * section 5). Imports only zod: the vocabularies are written out and pinned to lib/hq/leadership/rules.ts
 * by leadership-schemas.test.mts. The RPCs validate every value again.
 */
import { z } from "zod";

export const LANE_VALUES = ["do_now", "in_motion", "waiting", "coming_next"] as const;
export const PLANNING_KIND_VALUES = ["funding", "dependency", "context"] as const;
export const PLANNING_STATUS_VALUES = ["anticipated", "confirmed", "received", "current", "closed"] as const;
export const RESOLVE_NEXT_VALUES = ["in_progress", "to_do", "completed"] as const;
export const PLAN_ENTRIES_MAX = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const optDate = (what: string) => z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe(`Optional. ${what} (YYYY-MM-DD). Only a date the person actually gave: never guess one.`);
const task = (what: string) => z.string().trim().min(1).max(200).describe(`${what}: its id from an earlier result (best), or words of its title (if several match you get candidates to choose from).`);
const planningRef = (what: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(`${what}: its number (PLN-0001), its id, or words of its title. "the funding" or "the $25,000" finds the one live funding item when there is exactly one.`);

export const focusTodayShape = {
  limit: z.number().int().min(1).max(5).optional().describe("Optional. How many focus tasks, 1 to 5 (default 3; the dashboard shows 3)."),
};

export const workboardShape = {
  scope: z.enum(["mine", "everyone"]).optional().describe("Optional. mine (default: my tasks, and unassigned ones I created) or everyone (every open task I can see; needs tasks.read_all)."),
  lane: z.enum(LANE_VALUES).optional().describe("Optional. Only one lane: do_now, in_motion, waiting or coming_next."),
};

export const launchProgressShape = {
  project: z.string().trim().min(1).max(200).optional().describe("Optional. A project (PRJ-0001, id or name). Default: the business launch project HQ tracks."),
};

export const waitingOnShape = {
  item: planningRef("Optional. A planning item to focus on, for 'what can I do before the funding arrives?'"),
  scope: z.enum(["mine", "everyone"]).optional().describe("Optional. mine (default) or everyone (needs tasks.read_all)."),
};

export const weeklyReviewShape = {
  scope: z.enum(["mine", "everyone"]).optional().describe("Optional. mine (default) or everyone (needs tasks.read_all) for the task figures."),
};

export const listPlanningItemsShape = {
  include_closed: z.boolean().optional().describe("Optional. true = also items that were received or closed."),
};

export const setTaskWaitingShape = {
  task: task("The task to move into Waiting"),
  waiting_on: z.string().trim().min(1).max(200).optional().describe("Optional. Who or what it waits on, in a few words (for example 'Ailo to reply after the demo'). Give this, or planning_item, or both."),
  planning_item: planningRef("Optional. The planning item it waits on (for example the anticipated funding)"),
  since: optDate("When the wait began"),
  expected_reply: optDate("When a reply is expected"),
  follow_up: optDate("When to follow up next"),
  note: z.string().trim().min(1).max(4000).optional().describe("Optional. A short note for the task's comments."),
};

export const resolveWaitingShape = {
  task: task("The task whose wait is over"),
  what_happened: z.string().trim().min(1).max(4000).optional().describe("Optional. What happened, in the person's words (for example 'Ailo called back; demo booked for Thursday'). Saved as a comment on the task."),
  next: z.enum(RESOLVE_NEXT_VALUES).optional().describe("Optional. What the task becomes: in_progress (default), to_do, or completed when nothing more is needed."),
  follow_up: optDate("The next follow-up, if the person gave one"),
  due_date: optDate("A new due date, only if the person asked to change it"),
};

export const moveToLaneShape = {
  task: task("The task to move"),
  lane: z.enum(LANE_VALUES).describe("Where to: do_now (to do, planned for today), in_motion (in progress), waiting (needs waiting_on unless the task already records it), coming_next (to do, planned for a later day)."),
  waiting_on: z.string().trim().min(1).max(200).optional().describe("For lane waiting: who or what it waits on."),
  planned_for: optDate("For lane coming_next: the day to plan it for (default next Monday)"),
};

const planEntry = z
  .object({
    task: z.string().trim().min(1).max(200).describe("The task's id from the proposal."),
    planned_for: z.string().regex(DATE, "Use YYYY-MM-DD.").describe("The day from the proposal (YYYY-MM-DD)."),
  })
  .describe("One task and the day planned for it.");

export const planNextWeekShape = {
  per_day: z.number().int().min(1).max(12).optional().describe("Optional. At most this many tasks a day (default 4)."),
  week_start: z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe("Optional. The Monday the week starts (default next Monday)."),
  apply: z
    .array(planEntry)
    .min(1)
    .max(PLAN_ENTRIES_MAX)
    .optional()
    .describe("Optional. ONLY after the person has seen the proposal and agreed: the entries to save, exactly as proposed (or as the person changed them). Without this the tool only proposes and changes nothing."),
  idempotency_key: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9._:-]+$/, "Letters, digits and . _ : - only.")
    .optional()
    .describe("Required with apply. One fresh UUID per plan, REUSED unchanged on a retry (a repeat changes nothing again)."),
};

export const savePlanningItemShape = {
  item: planningRef("Optional. The planning item to change; leave out to add a new one"),
  kind: z.enum(PLANNING_KIND_VALUES).optional().describe("For a new item: funding (an amount that is anticipated, never a balance), dependency (an outside party or event several tasks wait on) or context (a note on the current situation)."),
  title: z.string().trim().min(1).max(200).optional().describe("Optional for a change, required for a new item. A short title."),
  detail: z.string().trim().max(2000).optional().describe("Optional. More detail; \"\" clears it."),
  amount: z.number().int().min(0).max(100_000_000).optional().describe("Optional, funding only. The ANTICIPATED amount in whole AUD, exactly as the person said it. A planning figure, never treated as money held."),
  expected: z.string().trim().max(200).optional().describe("Optional. When it is expected, in the person's own words ('within a month'); \"\" clears it."),
  expected_by: optDate("A real expected date"),
  status: z
    .enum(PLANNING_STATUS_VALUES)
    .optional()
    .describe("Optional. funding and dependency: anticipated, confirmed, received or closed; context: current or closed. Set received ONLY when the person says it has actually arrived."),
};

export const setLaunchRequirementShape = {
  milestone: z.string().trim().min(1).max(200).describe("The milestone: its name in the project (any case) or its id."),
  required: z.boolean().describe("true = it must be done before the business can open (counts towards launch readiness); false = not."),
  project: z.string().trim().min(1).max(200).optional().describe("Optional. The project (PRJ-0001, id or name). Default: the business launch project."),
};
