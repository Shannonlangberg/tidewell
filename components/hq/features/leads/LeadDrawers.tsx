"use client";

import { useActionState, useState, type ReactNode } from "react";
import { logLeadActivity, updateLeadDetails, updateLeadNextStep } from "@/app/hq/(app)/growth/opportunities/actions";
import { INTERACTION_LABEL, INTERACTION_TYPES } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { ACTIVITY_LABELS } from "@/lib/hq/leads/forms";
import { DIRECT_LEAD_SOURCES, LEAD_FORM_LABELS, LEAD_SOURCE_LABEL } from "@/lib/hq/leads/rules";
import { Button, type ButtonProps } from "../../Button";
import { Checkbox } from "../../Choice";
import { Drawer } from "../../Drawer";
import { Field, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { InlineNote } from "../../Primitives";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";
import { useCloseWhenDone } from "../referrals/useCloseWhenDone";

/*
 * The drawers on a lead's page. Each button only OPENS a form: the Server Action (and the database
 * behind it) does the work and the permission check. Each drawer stays open on a failed save and
 * keeps what was typed; it closes once the save has redirected back.
 */

function useSession(startOpen = false) {
  const [open, setOpen] = useState(startOpen);
  const [session, setSession] = useState(0);
  return {
    open,
    session,
    show: () => {
      setSession((n) => n + 1);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

// ── next step: owner, next action, follow-up date ────────────

export type NextStepInitial = { opportunityId: string; version: string; assignedTo: string; nextAction: string; nextActionDue: string };

export function NextStepButton({ initial, staff, today, label = "Change", variant, size = "sm" }: { initial: NextStepInitial; staff: readonly PickerOption[]; today: string; label?: ReactNode; variant?: ButtonProps["variant"]; size?: ButtonProps["size"] }) {
  const s = useSession();
  return (
    <>
      <Button size={size} variant={variant} onClick={s.show}>
        {label}
      </Button>
      <NextStepSession key={s.session} open={s.open} onClose={s.hide} initial={initial} staff={staff} today={today} />
    </>
  );
}

function NextStepSession({ open, onClose, initial, staff, today }: { open: boolean; onClose: () => void; initial: NextStepInitial; staff: readonly PickerOption[]; today: string }) {
  const [state, formAction, pending] = useActionState(updateLeadNextStep, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  useCloseWhenDone(state, pending, onClose);
  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title="Next step"
        description="Who owns the lead, what happens next and when. An open lead always has all three."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving next step">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LEAD_FORM_LABELS} idPrefix="next" />
          <input type="hidden" name="opportunity_id" value={initial.opportunityId} />
          <input type="hidden" name="version" value={initial.version} />
          <NativeSelectPicker name="assigned_to" idPrefix="next" label="Owner" required options={staff} defaultValue={retainedText(values, "assigned_to", initial.assignedTo)} error={fieldError(state, "assigned_to")} />
          <TextInput name="next_action" idPrefix="next" label="Next action" required maxLength={300} defaultValue={retainedText(values, "next_action", initial.nextAction)} error={fieldError(state, "next_action")} data-autofocus />
          <DateInput name="next_action_due" idPrefix="next" label="Follow-up date" required min={today} defaultValue={retainedText(values, "next_action_due", initial.nextActionDue < today ? today : initial.nextActionDue)} error={fieldError(state, "next_action_due")} />
        </div>
      </Drawer>
    </form>
  );
}

// ── the lead's details ───────────────────────────────────────

export type LeadDetailsInitial = {
  opportunityId: string;
  prospectName: string;
  prospectPhone: string;
  prospectEmail: string;
  propertySuburb: string;
  propertyAddress: string;
  /** Empty for a lead introduced by a referral partner: its source cannot change. */
  source: string;
  expectedCloseDate: string;
  estimatedValue: string;
  notes: string;
};

export function EditLeadButton({ initial, today }: { initial: LeadDetailsInitial; today: string }) {
  const s = useSession();
  return (
    <>
      <Button size="sm" onClick={s.show}>
        Edit details
      </Button>
      <EditLeadSession key={s.session} open={s.open} onClose={s.hide} initial={initial} today={today} />
    </>
  );
}

function EditLeadSession({ open, onClose, initial, today }: { open: boolean; onClose: () => void; initial: LeadDetailsInitial; today: string }) {
  const [state, formAction, pending] = useActionState(updateLeadDetails, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  useCloseWhenDone(state, pending, onClose);
  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title="Edit the lead"
        description="The owner and next step, the stage and any credit for a partner are changed on their own, not here."
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving lead">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LEAD_FORM_LABELS} idPrefix="editlead" />
          <input type="hidden" name="opportunity_id" value={initial.opportunityId} />
          <InlineNote>Only record details the person has agreed to share.</InlineNote>
          <TextInput name="prospect_name" idPrefix="editlead" label="Name" required maxLength={200} defaultValue={retainedText(values, "prospect_name", initial.prospectName)} error={fieldError(state, "prospect_name")} />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput name="prospect_phone" idPrefix="editlead" type="tel" label="Phone" defaultValue={retainedText(values, "prospect_phone", initial.prospectPhone)} error={fieldError(state, "prospect_phone")} />
            <TextInput name="prospect_email" idPrefix="editlead" type="email" label="Email" defaultValue={retainedText(values, "prospect_email", initial.prospectEmail)} error={fieldError(state, "prospect_email")} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <TextInput name="property_suburb" idPrefix="editlead" label="Property suburb" maxLength={120} defaultValue={retainedText(values, "property_suburb", initial.propertySuburb)} error={fieldError(state, "property_suburb")} />
            <TextInput name="property_address" idPrefix="editlead" label="Property address" maxLength={300} defaultValue={retainedText(values, "property_address", initial.propertyAddress)} error={fieldError(state, "property_address")} />
          </div>
          {initial.source ? (
            <Select
              name="source"
              idPrefix="editlead"
              label="Where did the lead come from?"
              options={DIRECT_LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))}
              defaultValue={retainedText(values, "source", initial.source)}
              error={fieldError(state, "source")}
            />
          ) : null}
          <DateInput name="expected_close_date" idPrefix="editlead" label="Expected to sign by" min={today} defaultValue={retainedText(values, "expected_close_date", initial.expectedCloseDate)} error={fieldError(state, "expected_close_date")} hint="Optional." />
          <TextInput
            name="estimated_value"
            idPrefix="editlead"
            label="Estimated yearly value, in dollars (an estimate)"
            inputMode="decimal"
            hint="Your own estimate of a year's management fees. Leave it blank if you don't know."
            defaultValue={retainedText(values, "estimated_value", initial.estimatedValue)}
            error={fieldError(state, "estimated_value")}
          />
          <Textarea name="notes" idPrefix="editlead" label="Notes" rows={4} maxLength={2000} defaultValue={retainedText(values, "notes", initial.notes)} error={fieldError(state, "notes")} />
        </div>
      </Drawer>
    </form>
  );
}

// ── log a call, meeting or note ──────────────────────────────

export function LogLeadActivityButton({
  opportunityId,
  prospectName,
  nowLocal,
  today,
  staff,
  staffId,
  canCreateTasks,
  defaultType = "phone_call",
  label = "Log a call or note",
  variant = "primary",
  startOpen = false,
}: {
  opportunityId: string;
  prospectName: string;
  nowLocal: string;
  today: string;
  staff: readonly PickerOption[];
  staffId: string;
  canCreateTasks: boolean;
  defaultType?: string;
  label?: ReactNode;
  variant?: ButtonProps["variant"];
  /** Open straight away (Today's "Log" button links here with ?log=phone_call). */
  startOpen?: boolean;
}) {
  const s = useSession(startOpen);
  return (
    <>
      <Button variant={variant} icon="phone" onClick={s.show}>
        {label}
      </Button>
      <LogSession
        key={s.session}
        open={s.open}
        onClose={s.hide}
        opportunityId={opportunityId}
        prospectName={prospectName}
        nowLocal={nowLocal}
        today={today}
        staff={staff}
        staffId={staffId}
        canCreateTasks={canCreateTasks}
        defaultType={defaultType}
      />
    </>
  );
}

function LogSession({
  open,
  onClose,
  opportunityId,
  prospectName,
  nowLocal,
  today,
  staff,
  staffId,
  canCreateTasks,
  defaultType,
}: {
  open: boolean;
  onClose: () => void;
  opportunityId: string;
  prospectName: string;
  nowLocal: string;
  today: string;
  staff: readonly PickerOption[];
  staffId: string;
  canCreateTasks: boolean;
  defaultType: string;
}) {
  const [state, formAction, pending] = useActionState(logLeadActivity, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const [task, setTask] = useState(retainedText(values, "create_task") === "on");
  useCloseWhenDone(state, pending, onClose);
  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title="Log a call or note"
        description={`With ${prospectName}. It goes on this lead's timeline.`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Logging">Log it</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={ACTIVITY_LABELS} idPrefix="leadlog" />
          <input type="hidden" name="opportunity_id" value={opportunityId} />
          <Select
            name="interaction_type"
            idPrefix="leadlog"
            label="What was it?"
            required
            options={INTERACTION_TYPES.map((t) => ({ value: t, label: INTERACTION_LABEL[t] }))}
            defaultValue={retainedText(values, "interaction_type", defaultType)}
            error={fieldError(state, "interaction_type")}
          />
          <Field name="occurred_at" idPrefix="leadlog" label="When" required error={fieldError(state, "occurred_at")} hint="Back-date it if you are catching up. It can't be in the future.">
            {(a11y) => <input {...a11y} name="occurred_at" type="datetime-local" className="hq-input hq-input--date" autoComplete="off" max={nowLocal} defaultValue={retainedText(values, "occurred_at", nowLocal)} />}
          </Field>
          <Textarea name="summary" idPrefix="leadlog" label="What was said" required rows={4} maxLength={4000} defaultValue={retainedText(values, "summary")} error={fieldError(state, "summary")} data-autofocus />
          <TextInput name="next_action" idPrefix="leadlog" label="New next action" maxLength={300} hint="Optional. Leave blank to keep the current one." defaultValue={retainedText(values, "next_action")} error={fieldError(state, "next_action")} />
          <DateInput name="next_action_due" idPrefix="leadlog" label="Follow-up date" min={today} hint="Optional, unless you give a new next action." defaultValue={retainedText(values, "next_action_due")} error={fieldError(state, "next_action_due")} />
          {canCreateTasks ? (
            <>
              <Checkbox
                name="create_task"
                idPrefix="leadlog"
                label="Also create a follow-up task"
                hint="Linked to this lead, due on the follow-up date."
                defaultChecked={task}
                onChange={(e) => setTask(e.currentTarget.checked)}
                error={fieldError(state, "create_task")}
              />
              {task ? <NativeSelectPicker name="task_assignee" idPrefix="leadlog" label="Task for" options={staff} defaultValue={retainedText(values, "task_assignee", staffId)} error={fieldError(state, "task_assignee")} /> : null}
            </>
          ) : null}
        </div>
      </Drawer>
    </form>
  );
}
