import { INTERACTION_TYPES, RELATIONSHIP_STATUSES, type InteractionType, type RelationshipStatus } from "../constants";
import { FormReader } from "../forms";
import { checkFollowUpDate, checkOccurredAt, taskNeedsDate, todayInZone, zonedLocalToDate } from "../growth/dates";

/*
 * Reads and validates the "log a call / meeting / note" form. All the rules the person sees are
 * enforced here, on the server: a real type, a time that is not in the future, a required
 * summary, a follow-up date that is today or later, and "create a task" only when there is a date
 * to give it and the person may create tasks.
 */

export type InteractionFormValues = {
  contactId: string | null;
  organisationId: string | null;
  returnTo: "contact" | "organisation" | "list";
  type: InteractionType;
  occurredAt: Date;
  summary: string;
  nextAction: string | null;
  followUpDate: string | null;
  createTask: boolean;
  taskAssignee: string | null;
  newStatus: RelationshipStatus | null;
};

export function readInteractionForm(
  formData: FormData,
  ctx: { timezone: string; staffId: string; canCreateTasks: boolean; now?: Date },
): { reader: FormReader; values: InteractionFormValues } {
  const now = ctx.now ?? new Date();
  const f = new FormReader(formData);

  const contactId = f.uuid("contact_id");
  const organisationId = f.uuid("organisation_id");
  if (!contactId && !organisationId && !f.errors.contact_id && !f.errors.organisation_id) {
    f.errors.contact_id = "Choose who this was with.";
  }
  const returnRaw = f.oneOf("return_to", ["contact", "organisation", "list"] as const, { fallback: "list" }) ?? "list";

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

  const newStatus = f.oneOf("new_status", RELATIONSHIP_STATUSES);
  if (newStatus && !contactId) f.errors.new_status = "A relationship status belongs to a person, so choose a contact first.";

  return {
    reader: f,
    values: { contactId, organisationId, returnTo: returnRaw, type, occurredAt, summary, nextAction, followUpDate, createTask, taskAssignee, newStatus },
  };
}
