"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/hq/constants";
import { DECISION_CATEGORIES, DECISION_CATEGORY_LABEL, TEXT_MAX } from "@/lib/hq/decisions/rules";
import { ACTION_DESCRIPTION_MAX, TITLE_MAX } from "@/lib/hq/meetings/rules";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { Drawer } from "../../Drawer";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";

/*
 * The interactive controls on a meeting's page, for people who hold meetings.write: add an action (a
 * real task), add a decision to the Decisions register (decisions.write as well), archive and
 * restore. Each posts to a Server Action passed in as a prop (this file imports no server code); the
 * actions check the capability again and the database decides in the end.
 */

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type PlainAction = (formData: FormData) => void | Promise<void>;

export function AddActionButton({ meetingId, staff, action }: { meetingId: string; staff: readonly PickerOption[]; action: FormAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        Add action
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Add an action" description="It becomes a task with an owner and a due date, linked to this meeting.">
        {open ? <AddActionForm meetingId={meetingId} staff={staff} action={action} onCancel={() => setOpen(false)} /> : null}
      </Drawer>
    </>
  );
}

function AddActionForm({ meetingId, staff, action, onCancel }: { meetingId: string; staff: readonly PickerOption[]; action: FormAction; onCancel: () => void }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback = ""): string => (retained ? (retained[name] ?? "") : fallback);
  return (
    <form action={formAction} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ title: "Action", assignee_id: "Who", due_date: "Due", priority: "Priority", description: "Detail" }} idPrefix="act" />
      <input type="hidden" name="id" value={meetingId} />
      <TextInput name="title" idPrefix="act" label="Action" required maxLength={TITLE_MAX} autoFocus error={fieldError(state, "title")} defaultValue={v("title")} hint="For example: Call Tim about the Moonta house." />
      <NativeSelectPicker name="assignee_id" idPrefix="act" label="Who" placeholder="Me" options={staff} error={fieldError(state, "assignee_id")} defaultValue={v("assignee_id")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <DateInput name="due_date" idPrefix="act" label="Due" error={fieldError(state, "due_date")} defaultValue={v("due_date")} />
        <Select
          name="priority"
          idPrefix="act"
          label="Priority"
          options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] }))}
          defaultValue={v("priority", "normal")}
          key={`p-${v("priority", "normal")}`}
        />
      </div>
      <Textarea name="description" idPrefix="act" label="Detail" rows={3} maxLength={ACTION_DESCRIPTION_MAX} error={fieldError(state, "description")} defaultValue={v("description")} hint="Optional." />
      <FormActions>
        <Button onClick={onCancel}>Cancel</Button>
        <SubmitButton pendingLabel="Adding action">Add action</SubmitButton>
      </FormActions>
    </form>
  );
}

export function PromoteDecisionButton({ meetingId, suggestions, action }: { meetingId: string; suggestions: readonly string[]; action: FormAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Add to Decisions register
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Add a decision to the register" description="It is recorded in the Decisions register, dated the meeting day, and linked back to this meeting.">
        {open ? <PromoteForm meetingId={meetingId} suggestions={suggestions} action={action} onCancel={() => setOpen(false)} /> : null}
      </Drawer>
    </>
  );
}

function PromoteForm({ meetingId, suggestions, action, onCancel }: { meetingId: string; suggestions: readonly string[]; action: FormAction; onCancel: () => void }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  const v = (name: string, fallback = ""): string => (retained ? (retained[name] ?? "") : fallback);
  return (
    <form action={formAction} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ title: "Decision", category: "Category", rationale: "Why" }} idPrefix="dec" />
      <input type="hidden" name="id" value={meetingId} />
      <TextInput
        name="title"
        idPrefix="dec"
        label="Decision"
        required
        maxLength={TITLE_MAX}
        autoFocus
        list="mtg-decision-suggestions"
        error={fieldError(state, "title")}
        defaultValue={v("title", suggestions[0] ?? "")}
        hint="The decision in one sentence, as it was agreed."
      />
      <datalist id="mtg-decision-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Select
        name="category"
        idPrefix="dec"
        label="Category"
        required
        placeholder="Choose a category"
        options={DECISION_CATEGORIES.map((c) => ({ value: c, label: DECISION_CATEGORY_LABEL[c] }))}
        error={fieldError(state, "category")}
        defaultValue={v("category")}
        key={`c-${v("category")}`}
      />
      <Textarea name="rationale" idPrefix="dec" label="Why" rows={3} maxLength={TEXT_MAX} error={fieldError(state, "rationale")} defaultValue={v("rationale")} hint="Optional. The reasons given at the meeting." />
      <FormActions>
        <Button onClick={onCancel}>Cancel</Button>
        <SubmitButton pendingLabel="Recording decision">Record decision</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ArchiveMeeting({ id, title, archive }: { id: string; title: string; archive: PlainAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Archive
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Archive this meeting?" confirmLabel="Archive meeting" cancelLabel="Keep meeting" tone="danger" action={archive} fields={{ id }}>
        &ldquo;{title}&rdquo; will leave the meetings list and search, and the meeting will no longer show on the linked records&rsquo; timelines. Its tasks stay as they are, its history is kept, and it can be restored.
      </ConfirmDialog>
    </>
  );
}

export function RestoreMeeting({ id, restore }: { id: string; restore: PlainAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Restore meeting
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Restore this meeting?" confirmLabel="Restore meeting" action={restore} fields={{ id }}>
        It will be back in the meetings list, and logged again on the records it is linked to.
      </ConfirmDialog>
    </>
  );
}
