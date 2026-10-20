"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/hq/forms";
import { idle } from "@/lib/hq/forms";
import { NOTE_MAX } from "@/lib/hq/decisions/rules";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { Drawer } from "../../Drawer";
import { FormActions, fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { NativeSelectPicker, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { Textarea } from "../../TextInput";

/*
 * The controls on a decision's page, for people who hold decisions.write. Each posts to a Server
 * Action passed in as a prop (this file imports no server code); the actions check the capability
 * again and the database decides in the end. Superseding and reversing both need a note, which is
 * kept in the decision's history.
 */

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function NoteForm({
  prefix,
  id,
  action,
  children,
  submitLabel,
  pendingLabel,
  noteLabel,
  noteHint,
  onCancel,
}: {
  /** Field id prefix, so two forms on one page never share an id. */
  prefix: string;
  id: string;
  action: FormAction;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel: string;
  noteLabel: string;
  noteHint: string;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <form action={formAction} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ note: "Note", superseded_by: "Replaced by" }} idPrefix={prefix} />
      <input type="hidden" name="id" value={id} />
      {children}
      <Textarea
        name="note"
        idPrefix={prefix}
        label={noteLabel}
        required
        rows={3}
        maxLength={NOTE_MAX}
        error={fieldError(state, "note")}
        defaultValue={retained?.note ?? ""}
        hint={noteHint}
      />
      <FormActions>
        <Button onClick={onCancel}>Cancel</Button>
        <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
      </FormActions>
    </form>
  );
}

export function DecisionControls({
  id,
  refLabel,
  title,
  canChangeStatus,
  candidates,
  supersede,
  reverse,
  archive,
}: {
  id: string;
  refLabel: string;
  title: string;
  /** False once the decision is superseded or reversed (closed). */
  canChangeStatus: boolean;
  /** Live decisions in force that could replace this one. */
  candidates: readonly PickerOption[];
  supersede: FormAction;
  reverse: FormAction;
  archive: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState<null | "supersede" | "reverse" | "archive">(null);
  const close = () => setOpen(null);

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {canChangeStatus ? (
          <>
            <Button size="sm" onClick={() => setOpen("supersede")}>
              Supersede this decision
            </Button>
            <Button size="sm" onClick={() => setOpen("reverse")}>
              Reverse this decision
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="danger" onClick={() => setOpen("archive")}>
          Archive
        </Button>
      </div>

      <Drawer open={open === "supersede"} onClose={close} title="Supersede this decision" description={`${refLabel} will be marked superseded by the decision you choose. Its history is kept.`}>
        {open === "supersede" ? (
          candidates.length === 0 ? (
            <p className="text-[15px] text-grey-text">
              There is no other decision in force to replace it with. Record the new decision first, then come back here.
            </p>
          ) : (
            <NoteForm
              prefix="supersede"
              id={id}
              action={supersede}
              submitLabel="Mark superseded"
              pendingLabel="Saving"
              noteLabel="Why it was replaced"
              noteHint="Required. Kept in the history of both decisions."
              onCancel={close}
            >
              <NativeSelectPicker name="superseded_by" idPrefix="supersede" label="Replaced by" required placeholder="Choose the new decision" options={candidates} />
            </NoteForm>
          )
        ) : null}
      </Drawer>

      <Drawer open={open === "reverse"} onClose={close} title="Reverse this decision" description={`${refLabel} will be marked reversed: it no longer applies and nothing replaces it.`}>
        {open === "reverse" ? (
          <NoteForm
            prefix="reverse"
            id={id}
            action={reverse}
            submitLabel="Mark reversed"
            pendingLabel="Saving"
            noteLabel="Why it was reversed"
            noteHint="Required. Shown on the decision and kept in its history."
            onCancel={close}
          />
        ) : null}
      </Drawer>

      <ConfirmDialog open={open === "archive"} onClose={close} title="Archive this decision?" confirmLabel="Archive decision" cancelLabel="Keep decision" tone="danger" action={archive} fields={{ id }}>
        &ldquo;{title}&rdquo; will leave the register and search. Its history is kept, and a director or administrator can restore it. Use this for a decision recorded by mistake; if it was replaced or undone, supersede or reverse it instead.
      </ConfirmDialog>
    </>
  );
}

export function RestoreDecision({ id, restore }: { id: string; restore: (formData: FormData) => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Restore decision
      </Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Restore this decision?" confirmLabel="Restore decision" action={restore} fields={{ id }}>
        It will be back in the register and in search.
      </ConfirmDialog>
    </>
  );
}
