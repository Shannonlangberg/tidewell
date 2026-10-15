import { INTERACTION_TYPES, type InteractionType } from "../constants";
import { FormReader } from "../forms";
import { checkFollowUpDate, checkOccurredAt, taskNeedsDate, todayInZone, zonedLocalToDate } from "../growth/dates";

/*
 * Reads and validates the "log contact" form for a contractor: a real interaction type, a time that
 * is not in the future, a required summary, a follow-up date that is today or later, and "create a
 * follow-up task" only when there is a date to give it and the person may create tasks. The only
 * status change on offer is prospect to contacted (record_contractor_contact refuses anything else).
 */

export type ContactFormValues = {
  contractorId: string;
  type: InteractionType;
  occurredAt: Date;
  summary: string;
  nextAction: string | null;
  followUpDate: string | null;
  createTask: boolean;
  taskAssignee: string | null;
  markContacted: boolean;
};

export function readContactForm(
  formData: FormData,
  ctx: { timezone: string; staffId: string; canCreateTasks: boolean; now?: Date },
): { reader: FormReader; values: ContactFormValues } {
  const now = ctx.now ?? new Date();
  const f = new FormReader(formData);

  const contractorId = f.uuid("contractor_id", { required: true, label: "The contractor" }) ?? "";
  const type = f.oneOf("interaction_type", INTERACTION_TYPES, { required: true }) ?? "phone_call";

  const whenText = f.requiredText("occurred_at", { label: "The time", max: 32 });
  let occurredAt = now;
  if (whenText) {
    const when = zonedLocalToDate(whenText, ctx.timezone);
    const check = checkOccurredAt(when, now);
    if (!check.ok) f.errors.occurred_at = check.message;
    else if (when) occurredAt = when;
  }

  const summary = f.requiredText("summary", { label: "Summary", max: 4000 });
  const nextAction = f.text("next_action", { label: "Next action", max: 500 });

  const followRaw = f.date("follow_up_date");
  let followUpDate: string | null = null;
  if (followRaw) {
    const check = checkFollowUpDate(followRaw, todayInZone(ctx.timezone, now));
    if (!check.ok) f.errors.follow_up_date = check.message;
    else followUpDate = check.value;
  }

  const createTask = f.bool("create_task");
  if (createTask && !f.errors.follow_up_date) {
    if (taskNeedsDate(createTask, followUpDate)) f.errors.create_task = "Set a follow-up date to create a task.";
    else if (!ctx.canCreateTasks) f.errors.create_task = "You don't have permission to create tasks.";
  }
  const taskAssignee = f.uuid("task_assignee") ?? (createTask ? ctx.staffId : null);
  const markContacted = f.bool("mark_contacted");

  return { reader: f, values: { contractorId, type, occurredAt, summary, nextAction, followUpDate, createTask, taskAssignee, markContacted } };
}
