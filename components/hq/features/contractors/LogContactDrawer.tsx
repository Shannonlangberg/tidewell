"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { recordContractorContact } from "@/app/hq/(app)/partners/actions";
import { INTERACTION_LABEL, INTERACTION_TYPES, type InteractionType } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { nowLocalInput } from "@/lib/hq/growth/dates";
import { parseLogParam } from "@/lib/hq/growth/params";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { Button } from "../../Button";
import { Checkbox, RadioGroup } from "../../Choice";
import { Drawer } from "../../Drawer";
import { Field, FieldError, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * Log a call, meeting or note with a contractor, as a Drawer.
 *
 * The URL is the single source of truth for whether it is open: `?log=call` (or phone_call,
 * email, message, note, meeting...), exactly like the contact drawer. Back closes it, and a
 * successful save (the Server Action redirects to a URL without `?log=`) closes it with no extra
 * code. It stays open on a failed save and keeps everything that was typed.
 */

export type LogContactDrawerProps = {
  contractor: { id: string; name: string; status: string };
  staffOptions: readonly PickerOption[];
  canCreateTasks: boolean;
  staffId: string;
  timezone: string;
  /** "Now" in that zone, worked out on the server so the first render matches. */
  serverNowLocal: string;
  today: string;
};

const TITLE: Record<InteractionType, string> = {
  phone_call: "Log a call",
  coffee_meeting: "Log a meeting",
  office_meeting: "Log a meeting",
  email: "Log an email",
  message: "Log a message",
  note: "Add a note",
};

const LABELS = {
  contractor_id: "The contractor",
  interaction_type: "Type",
  occurred_at: "When",
  summary: "Summary",
  next_action: "Next action",
  follow_up_date: "Follow-up date",
  create_task: "Follow-up task",
  task_assignee: "Assign the task to",
};

export function LogContactDrawer(props: LogContactDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = parseLogParam(params.get("log") ?? undefined);
  const open = type !== null;

  // A fresh form (and a fresh "now") each time the drawer opens, adjusted during render rather than in an effect.
  const [session, setSession] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const [nowLocal, setNowLocal] = useState(props.serverNowLocal);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSession((s) => s + 1);
      setNowLocal(nowLocalInput(props.timezone));
    }
  }

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("log");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return <LogSession key={session} {...props} open={open} initialType={type ?? "phone_call"} nowLocal={nowLocal} onClose={close} />;
}

function LogSession({
  contractor,
  staffOptions,
  canCreateTasks,
  staffId,
  today,
  open,
  initialType,
  nowLocal,
  onClose,
}: LogContactDrawerProps & { open: boolean; initialType: InteractionType; nowLocal: string; onClose: () => void }) {
  const [state, formAction] = useActionState(recordContractorContact, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;

  const [followUp, setFollowUp] = useState(retainedText(values, "follow_up_date"));
  const [createTask, setCreateTask] = useState(retainedText(values, "create_task") === "on");

  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title={TITLE[initialType]}
        description={`With ${contractor.name}`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix="log" />
          <input type="hidden" name="contractor_id" value={contractor.id} />

          <RadioGroup
            name="interaction_type"
            idPrefix="log"
            legend="What was it?"
            segmented
            required
            defaultValue={retainedText(values, "interaction_type", initialType)}
            error={fieldError(state, "interaction_type")}
            options={INTERACTION_TYPES.map((t) => ({ value: t, label: INTERACTION_LABEL[t] }))}
          />

          <Field name="occurred_at" idPrefix="log" label="When" required error={fieldError(state, "occurred_at")} hint="Back-date it if you are catching up. It can't be in the future.">
            {(a11y) => (
              <input
                {...a11y}
                name="occurred_at"
                type="datetime-local"
                className="hq-input hq-input--date"
                autoComplete="off"
                max={nowLocal}
                defaultValue={retainedText(values, "occurred_at", nowLocal)}
              />
            )}
          </Field>

          <Textarea
            name="summary"
            idPrefix="log"
            label="Summary"
            required
            rows={4}
            hint="What was discussed? A line or two is plenty."
            error={fieldError(state, "summary")}
            defaultValue={retainedText(values, "summary")}
            data-autofocus
          />

          <TextInput
            name="next_action"
            idPrefix="log"
            label="Next action"
            hint="Optional. What happens next, in a few words. It becomes the task's title if you create one."
            error={fieldError(state, "next_action")}
            defaultValue={retainedText(values, "next_action")}
            maxLength={500}
          />

          <DateInput
            name="follow_up_date"
            idPrefix="log"
            label="Follow up on"
            hint="Optional."
            min={today}
            error={fieldError(state, "follow_up_date")}
            defaultValue={retainedText(values, "follow_up_date")}
            onChange={(e) => setFollowUp(e.target.value)}
          />

          {followUp && canCreateTasks ? (
            <div className="grid gap-4">
              <Checkbox
                name="create_task"
                idPrefix="log"
                label="Create a follow-up task"
                hint="It appears in Tasks, due on the follow-up date, linked to this contractor."
                defaultChecked={createTask}
                onChange={(e) => setCreateTask(e.target.checked)}
                error={fieldError(state, "create_task")}
              />
              {createTask ? (
                <NativeSelectPicker
                  name="task_assignee"
                  idPrefix="log"
                  label="Assign the task to"
                  options={staffOptions}
                  defaultValue={retainedText(values, "task_assignee", staffId)}
                  error={fieldError(state, "task_assignee")}
                />
              ) : null}
            </div>
          ) : null}
          {!followUp && fieldError(state, "create_task") ? <FieldError>{fieldError(state, "create_task")}</FieldError> : null}

          {contractor.status === "prospect" ? (
            <Checkbox
              name="mark_contacted"
              idPrefix="log"
              label="Mark them as contacted"
              hint="Moves them from prospect to contacted. It never approves anyone."
              defaultChecked={retainedText(values, "mark_contacted") === "on"}
            />
          ) : null}
        </div>
      </Drawer>
    </form>
  );
}
