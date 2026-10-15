"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { recordInteraction } from "@/app/hq/(app)/growth/contacts/actions";
import { INTERACTION_LABEL, INTERACTION_TYPES, RELATIONSHIP_LABEL, RELATIONSHIP_STATUSES, type InteractionType } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { nowLocalInput } from "@/lib/hq/growth/dates";
import { parseLogParam } from "@/lib/hq/growth/params";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { Button } from "../../Button";
import { Checkbox, RadioGroup } from "../../Choice";
import { Drawer } from "../../Drawer";
import { Field, FieldError, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The 30-second "log a call" flow, as a Drawer.
 *
 * The URL is the single source of truth for whether it is open: `?log=call` (or phone_call,
 * coffee_meeting, office_meeting, email, message, note; also "meeting"). That is what the Quick
 * add menu links to, so the same drawer opens from anywhere, Back closes it, and a successful
 * save (the Server Action redirects to a URL without `?log=`) closes it with no extra code.
 *
 * It stays open on a failed save and keeps everything that was typed (the action hands the
 * values back and they become each field's defaultValue). It is a bottom sheet below 768px (the
 * Drawer's own behaviour).
 */

export type LogSubject = { id: string; name: string; organisation: string | null };

export type LogInteractionDrawerProps = {
  /** Who it is with, when the page already knows (a contact's profile). Null shows a picker. */
  contact: LogSubject | null;
  /** The organisation, for a log made from an organisation page (the contact may be left blank). */
  organisation: { id: string; name: string } | null;
  /** The picker's choices when `contact` is null. */
  contactOptions: readonly PickerOption[];
  staffOptions: readonly PickerOption[];
  canCreateTasks: boolean;
  staffId: string;
  /** The person's time zone (staff.timezone). */
  timezone: string;
  /** "Now" in that zone, worked out on the server so the first render matches. */
  serverNowLocal: string;
  /** Today in that zone, YYYY-MM-DD: the earliest follow-up date. */
  today: string;
  returnTo: "contact" | "organisation" | "list" | "partners";
  /** With returnTo "partners": the list address (filters and page) to come back to after saving. */
  returnPath?: string;
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
  contact_id: "Who it was with",
  interaction_type: "Type",
  occurred_at: "When",
  summary: "Summary",
  next_action: "Next action",
  follow_up_date: "Follow-up date",
  create_task: "Follow-up task",
  task_assignee: "Assign the task to",
  new_status: "Relationship status",
};

export function LogInteractionDrawer(props: LogInteractionDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = parseLogParam(params.get("log") ?? undefined);
  const open = type !== null;

  // A fresh form (and a fresh "now") each time the drawer opens. State is adjusted during render,
  // not in an effect, so the new form is the first thing painted.
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
  contact,
  organisation,
  contactOptions,
  staffOptions,
  canCreateTasks,
  staffId,
  today,
  returnTo,
  returnPath,
  open,
  initialType,
  nowLocal,
  onClose,
}: LogInteractionDrawerProps & { open: boolean; initialType: InteractionType; nowLocal: string; onClose: () => void }) {
  const [state, formAction] = useActionState(recordInteraction, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;

  const [followUp, setFollowUp] = useState(retainedText(values, "follow_up_date"));
  const [createTask, setCreateTask] = useState(retainedText(values, "create_task") === "on");

  const picker = contact === null;
  const description = contact ? `With ${contact.name}${contact.organisation ? `, ${contact.organisation}` : ""}` : organisation ? `For ${organisation.name}` : undefined;

  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title={TITLE[initialType]}
        description={description}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving">Save</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix="log" />

          <input type="hidden" name="return_to" value={returnTo} />
          {returnPath ? <input type="hidden" name="return_path" value={returnPath} /> : null}
          {contact ? <input type="hidden" name="contact_id" value={contact.id} /> : null}
          {organisation ? <input type="hidden" name="organisation_id" value={organisation.id} /> : null}

          {picker ? (
            <NativeSelectPicker
              name="contact_id"
              idPrefix="log"
              label="Who was it with?"
              required={!organisation}
              placeholder={organisation ? "The organisation in general" : "Choose a contact"}
              options={contactOptions}
              defaultValue={retainedText(values, "contact_id")}
              error={fieldError(state, "contact_id")}
              hint={
                <>
                  Not in the list? <Link href="/hq/growth/contacts/new">Add a new contact</Link>.
                </>
              }
              data-autofocus
            />
          ) : null}

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
            data-autofocus={picker ? undefined : true}
          />

          <TextInput
            name="next_action"
            idPrefix="log"
            label="Next action"
            hint="Optional. What happens next, in a few words."
            error={fieldError(state, "next_action")}
            defaultValue={retainedText(values, "next_action")}
            maxLength={500}
          />

          <DateInput
            name="follow_up_date"
            idPrefix="log"
            label="Follow up on"
            hint="Optional. Sets this person's next follow-up date."
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
                hint="It appears under Operations, due on the follow-up date."
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

          <Select
            name="new_status"
            idPrefix="log"
            label="Update relationship status"
            hint="Optional. Leave as it is to keep their current status."
            placeholder="Don't change"
            options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABEL[s] }))}
            error={fieldError(state, "new_status")}
            defaultValue={retainedText(values, "new_status")}
          />
        </div>
      </Drawer>
    </form>
  );
}
