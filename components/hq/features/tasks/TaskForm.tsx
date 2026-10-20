"use client";

import { useActionState, useState } from "react";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "@/lib/hq/constants";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/hq/tasks/rules";
import { TASK_FORM_LABELS, type TaskFormInitial } from "@/lib/hq/tasks/rules";
import { isPastDate } from "@/lib/hq/tasks/rules";
import { Checkbox, RadioGroup } from "../../Choice";
import { LinkButton } from "../../Button";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { Icon } from "../../icons";
import { SectionLabel } from "../../Primitives";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The task form, for create and edit. One column, the title first and focused on create, so a
 * task can be added with the keyboard in a few seconds: type the title, press Enter.
 *
 * It is a Server Action form (useActionState): on a failed save the server sends back what was
 * typed (`state.data.values`) and every field is given that as its default, because React 19
 * resets an uncontrolled form after an action (see the note in components/hq/Field.tsx).
 * Errors are field-level and linked from the summary at the top.
 *
 * Linked records: people who can read growth data (`canLink`) get a contact and an
 * organisation picker, plus a checkbox for a referral or opportunity the task is already
 * linked to. Everyone else sees no linking controls at all; the server refuses related ids from
 * them regardless. Records linked from another page (the query contract) are listed with a
 * link that opens in a new tab, so the person can check what the task will be attached to
 * without losing what they have typed.
 */

export type LinkedSummary = {
  kind: "contact" | "organisation" | "referral" | "opportunity" | "contractor";
  /** null when the name could not be read */
  label: string | null;
  /** null when there is no page to open */
  href: string | null;
};

export type TaskFormProps = {
  mode: "create" | "edit";
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  initial: TaskFormInitial;
  /** The id of the task being edited. */
  taskId?: string;
  /** updated_at of the task when the form was loaded: a save is refused if it has changed since. */
  version?: string;
  /** A safe /hq path to return to after creating (already validated by the page). */
  returnTo?: string | null;
  staff: readonly PickerOption[];
  contacts: readonly PickerOption[];
  organisations: readonly PickerOption[];
  /** Phase 2: choices for the related contractor, and whether the person may link one (contractors.read). */
  contractors?: readonly PickerOption[];
  canLinkContractors?: boolean;
  canLink: boolean;
  /** Records the task is (or will be) linked to, for the "Linked to" line. */
  linked: readonly LinkedSummary[];
  /** The id and label of a referral or opportunity link, shown as a checkbox so it can be removed. */
  referralLink: { id: string; label: string | null } | null;
  opportunityLink: { id: string; label: string | null } | null;
  today: string;
  cancelHref: string;
  /**
   * Edit only: the person may not give this task to anyone else (they are its assignee but did not
   * create it and cannot see every task, so the database would refuse). The assignee is then shown, not offered.
   */
  lockAssignee?: { id: string; name: string } | null;
  /** Extra hidden fields posted with the form (for example the decision a new task will be linked to). */
  hiddenFields?: Record<string, string>;
};

const KIND_NOUN: Record<LinkedSummary["kind"], string> = {
  contact: "Contact",
  organisation: "Organisation",
  referral: "Referral",
  opportunity: "Lead",
  contractor: "Contractor",
};

export function TaskForm(props: TaskFormProps) {
  const { mode, action, initial, taskId, version, returnTo, staff, contacts, organisations, contractors = [], canLinkContractors = false, canLink, linked, referralLink, opportunityLink, today, cancelHref, lockAssignee, hiddenFields } = props;
  const [state, formAction] = useActionState(action, idle);

  // After a failed save the server returns what was typed; until then, the starting values.
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback: string): string => (retained ? (retained[name] ?? "") : fallback);

  const priority = (TASK_PRIORITIES as readonly string[]).includes(v("priority", initial.priority)) ? (v("priority", initial.priority) as TaskPriority) : "normal";
  const [due, setDue] = useState(initial.dueDate);
  const past = isPastDate(due, today);

  const referralChecked = retained ? retained.related_referral_id === referralLink?.id : true;
  const opportunityChecked = retained ? retained.related_opportunity_id === opportunityLink?.id : true;

  return (
    <form action={formAction} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={TASK_FORM_LABELS} />
      {taskId ? <input type="hidden" name="id" value={taskId} /> : null}
      {version ? <input type="hidden" name="version" value={version} /> : null}
      {returnTo ? <input type="hidden" name="return" value={returnTo} /> : null}
      {Object.entries(hiddenFields ?? {}).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}

      <TextInput
        name="title"
        label="Title"
        required
        maxLength={TITLE_MAX}
        autoFocus={mode === "create"}
        error={fieldError(state, "title")}
        defaultValue={v("title", initial.title)}
        hint="What needs doing, in a few words."
      />

      <Textarea
        name="description"
        label="Description"
        rows={4}
        maxLength={DESCRIPTION_MAX}
        error={fieldError(state, "description")}
        defaultValue={v("description", initial.description)}
        hint="Optional. Anything that will help whoever picks this up."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <DateInput
            name="due_date"
            label="Due date"
            error={fieldError(state, "due_date")}
            defaultValue={v("due_date", initial.dueDate)}
            onChange={(e) => setDue(e.currentTarget.value)}
            hint="Optional."
          />
          <div aria-live="polite">
            {past ? (
              <p className="flex items-start gap-2 text-[13px] text-grey-text">
                <Icon name="clock" size={15} className="mt-0.5 shrink-0" />
                <span>That date has passed, so the task will show as overdue straight away. You can still save it.</span>
              </p>
            ) : null}
          </div>
        </div>
        <RadioGroup
          key={`priority-${priority}`}
          name="priority"
          legend="Priority"
          segmented
          defaultValue={priority}
          error={fieldError(state, "priority")}
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] }))}
        />
      </div>

      {lockAssignee ? (
        <div className="grid gap-1.5">
          <input type="hidden" name="assigned_to" value={lockAssignee.id} />
          <p className="hq-field__label">Assigned to</p>
          <p className="text-[15px] font-medium">{lockAssignee.name}</p>
          <p className="hq-field__hint">Only the person who created this task, or someone who can see everyone&rsquo;s tasks, can give it to someone else.</p>
        </div>
      ) : (
        <NativeSelectPicker
          name="assigned_to"
          label="Assigned to"
          placeholder="Unassigned"
          options={staff}
          error={fieldError(state, "assigned_to")}
          defaultValue={v("assigned_to", initial.assignedTo)}
          hint="They will see it in their tasks. Leave it unassigned and only you, and people who can see all tasks, will."
        />
      )}

      {canLink || canLinkContractors ? (
        <fieldset className="grid gap-5 border-0 p-0">
          <legend className="sr-only">Linked records</legend>
          <SectionLabel as="h2" className="border-b border-line pb-3">
            Linked records
          </SectionLabel>

          {linked.length > 0 ? (
            <div className="grid gap-2 text-[14px]">
              <p className="text-grey-text">{mode === "create" ? "This task will be linked to:" : "This task is linked to:"}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {linked.map((l) => (
                  <li key={l.kind}>
                    {l.href && l.label ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hq-chip hq-chip--plain no-underline hover:underline"
                      >
                        <span>
                          {KIND_NOUN[l.kind]}: {l.label}
                        </span>
                        <Icon name="arrow-up-right" size={13} />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="hq-chip hq-chip--plain">
                        {KIND_NOUN[l.kind]}: {l.label ?? "name not available"}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canLink ? (
          <div className="grid gap-5 sm:grid-cols-2">
            <NativeSelectPicker
              name="related_contact_id"
              label="Contact"
              placeholder="No contact"
              options={contacts}
              error={fieldError(state, "related_contact_id")}
              defaultValue={v("related_contact_id", initial.contactId)}
            />
            <NativeSelectPicker
              name="related_organisation_id"
              label="Organisation"
              placeholder="No organisation"
              options={organisations}
              error={fieldError(state, "related_organisation_id")}
              defaultValue={v("related_organisation_id", initial.organisationId)}
            />
          </div>
          ) : null}

          {canLinkContractors ? (
            <NativeSelectPicker
              name="related_contractor_id"
              label="Contractor"
              placeholder="No contractor"
              options={contractors}
              error={fieldError(state, "related_contractor_id")}
              defaultValue={v("related_contractor_id", initial.contractorId)}
            />
          ) : null}

          {canLink && referralLink ? (
            <Checkbox
              key={`ref-${referralChecked}`}
              name="related_referral_id"
              value={referralLink.id}
              label={referralLink.label ? `Linked to referral ${referralLink.label}` : "Linked to a referral"}
              hint="Untick to remove the link."
              defaultChecked={referralChecked}
              error={fieldError(state, "related_referral_id")}
            />
          ) : null}
          {canLink && opportunityLink ? (
            <Checkbox
              key={`opp-${opportunityChecked}`}
              name="related_opportunity_id"
              value={opportunityLink.id}
              label={opportunityLink.label ? `Linked to the lead ${opportunityLink.label}` : "Linked to a lead"}
              hint="Untick to remove the link."
              defaultChecked={opportunityChecked}
              error={fieldError(state, "related_opportunity_id")}
            />
          ) : null}
        </fieldset>
      ) : null}

      <FormActions>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
        <SubmitButton pendingLabel={mode === "create" ? "Creating task" : "Saving task"}>{mode === "create" ? "Create task" : "Save changes"}</SubmitButton>
      </FormActions>
    </form>
  );
}
