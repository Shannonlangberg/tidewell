import { INTERACTION_TYPES, type InteractionType } from "../constants";
import { FormReader } from "../forms";
import { checkOccurredAt, zonedLocalToDate } from "../growth/dates";
import { checkExpectedClose, checkFollowUp, DIRECT_LEAD_SOURCES, type LeadSource } from "./rules";

/*
 * The lead forms that need the person's timezone or the HQ date helpers (the add-a-lead fields are
 * in rules.ts, pure). Used by the Server Actions and the MCP tools, so the screen and the chat give
 * the same answers. The database checks every rule again.
 */

export type LeadActivityValues = {
  type: InteractionType;
  occurredAt: Date;
  summary: string;
  nextAction: string | null;
  nextActionDue: string | null;
  createTask: boolean;
  taskAssignee: string | null;
};

export const ACTIVITY_LABELS: Record<string, string> = {
  interaction_type: "Type",
  occurred_at: "When",
  summary: "What was said",
  next_action: "Next action",
  next_action_due: "Follow-up date",
  create_task: "Create a task",
  task_assignee: "Task for",
};

export function readLeadActivityForm(
  formData: FormData,
  ctx: { timezone: string; today: string; staffId: string; canCreateTasks: boolean; now?: Date },
): { reader: FormReader; values: LeadActivityValues } {
  const now = ctx.now ?? new Date();
  const f = new FormReader(formData);
  const type = f.oneOf("interaction_type", INTERACTION_TYPES, { required: true }) ?? "phone_call";
  const whenText = f.requiredText("occurred_at", { label: "The time", max: 32 });
  let occurredAt = now;
  if (whenText) {
    const when = zonedLocalToDate(whenText, ctx.timezone);
    const check = checkOccurredAt(when, now);
    if (!check.ok) f.errors.occurred_at = check.message;
    else if (when) occurredAt = when;
  }
  const summary = f.requiredText("summary", { label: "What was said", max: 4000 });
  const nextAction = f.text("next_action", { label: "The next action", max: 300 });
  const nextActionDue = checkFollowUp(f, "next_action_due", ctx.today, false);
  if (nextAction && !nextActionDue && !f.errors.next_action_due) f.errors.next_action_due = "Choose when the next action is due.";
  const createTask = f.bool("create_task");
  if (createTask && !ctx.canCreateTasks) f.errors.create_task = "You don't have permission to create tasks.";
  const taskAssignee = f.uuid("task_assignee") ?? (createTask ? ctx.staffId : null);
  return { reader: f, values: { type, occurredAt, summary, nextAction, nextActionDue, createTask, taskAssignee } };
}

export type LeadEditValues = {
  prospectName: string | null;
  prospectPhone: string | null;
  prospectEmail: string | null;
  propertySuburb: string | null;
  propertyAddress: string | null;
  source: LeadSource | null;
  expectedCloseDate: string | null;
  estimateCents: number | null;
  notes: string | null;
};

/** The lead's details drawer (everything but the owner, the next step and the stage). */
export function readLeadDetailsForm(formData: FormData, ctx: { today: string; currentClose: string | null }): { reader: FormReader; values: LeadEditValues } {
  const f = new FormReader(formData);
  const prospectName = f.requiredText("prospect_name", { max: 200, label: "The name" });
  const prospectPhone = f.phone("prospect_phone");
  const prospectEmail = f.email("prospect_email");
  const propertySuburb = f.text("property_suburb", { max: 120, label: "The suburb" });
  const propertyAddress = f.text("property_address", { max: 300, label: "The address" });
  const source = f.oneOf("source", DIRECT_LEAD_SOURCES);
  // An unchanged close date that has since passed is kept as it is; a new one must be today or later.
  const closeRaw = f.date("expected_close_date");
  const expectedCloseDate = closeRaw && closeRaw === ctx.currentClose ? closeRaw : checkExpectedClose(f, "expected_close_date", ctx.today);
  const estimateCents = f.dollarsToCents("estimated_value");
  const notes = f.text("notes", { max: 2000, label: "Notes" });
  return { reader: f, values: { prospectName: prospectName || null, prospectPhone, prospectEmail, propertySuburb, propertyAddress, source, expectedCloseDate, estimateCents, notes } };
}
