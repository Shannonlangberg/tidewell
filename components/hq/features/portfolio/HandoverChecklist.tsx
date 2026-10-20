"use client";

import { useActionState, useState } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import {
  HANDOVER_STEP_HINT,
  HANDOVER_STEP_LABEL,
  HANDOVER_STEP_STATUSES,
  HANDOVER_STEP_STATUS_LABEL,
  HANDOVER_STEP_STATUS_TONE,
  NOTE_MAX,
  type HandoverStep,
  type HandoverStepStatus,
} from "@/lib/hq/portfolio/rules";
import { Button } from "@/components/hq/Button";
import { FormSummary } from "@/components/hq/FormSummary";
import { Select } from "@/components/hq/Select";
import { StatusChip } from "@/components/hq/StatusChip";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { Textarea } from "@/components/hq/TextInput";

/*
 * The nine-step Ailo handover checklist, the same pattern as the contractor vetting checklist. A
 * person with portfolio.write can "Mark done" in one press, or "Update" a step with a status and a
 * note (a note is required for "Not applicable"). Read-only people get the same list without the
 * buttons. Completing every step never changes the property's status: that stays a deliberate edit.
 *
 * The action is passed in as a prop (this file imports no server code). Dates and names arrive
 * already formatted from the server, so nothing here depends on the browser's clock or time zone.
 */

export type ChecklistStep = {
  step: HandoverStep;
  number: number;
  status: HandoverStepStatus;
  note: string | null;
  /** "Done by Sam Senior, Tue 20 Oct, 2:30 pm", or null. */
  completedLine: string | null;
};

type StepAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function HandoverChecklist({ propertyId, steps, canWrite, action }: { propertyId: string; steps: readonly ChecklistStep[]; canWrite: boolean; action: StepAction }) {
  return (
    <ol className="m-0 list-none p-0" aria-label="Handover steps">
      {steps.map((s) => (
        <StepRow key={s.step} propertyId={propertyId} s={s} canWrite={canWrite} action={action} />
      ))}
    </ol>
  );
}

function StepRow({ propertyId, s, canWrite, action }: { propertyId: string; s: ChecklistStep; canWrite: boolean; action: StepAction }) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, idle);
  const [editing, setEditing] = useState(false);
  const [lastOk, setLastOk] = useState<ActionState | null>(null);

  // A saved result closes the editor. Adjusted during render (not in an effect) so the closed row is what paints.
  if (state.ok && state !== lastOk) {
    setLastOk(state);
    if (editing) setEditing(false);
  }

  const label = HANDOVER_STEP_LABEL[s.step];
  const idPrefix = `ho-${s.step}`;
  const fieldsFromState = (state.data?.values ?? {}) as Record<string, string>;

  return (
    <li className="border-t border-line py-4 first:border-t-0 first:pt-0" aria-labelledby={`${idPrefix}-t`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="hq-nums text-[13px] text-grey-text" aria-hidden="true">
              {s.number}
            </span>
            <span id={`${idPrefix}-t`} className="font-medium">
              {label}
            </span>
            <StatusChip tone={HANDOVER_STEP_STATUS_TONE[s.status]} plain={s.status === "not_started" || s.status === "not_applicable"}>
              {HANDOVER_STEP_STATUS_LABEL[s.status]}
            </StatusChip>
          </p>
          <p className="hq-muted mt-1 pl-[1.6rem] text-[13px]">{HANDOVER_STEP_HINT[s.step]}</p>
          {s.note ? <p className="mt-2 whitespace-pre-line break-words pl-[1.6rem] text-[14px]">{s.note}</p> : null}
          {s.completedLine ? <p className="hq-muted mt-1 pl-[1.6rem] text-[13px]">{s.completedLine}</p> : null}
        </div>

        {canWrite && !editing ? (
          <div className="flex flex-none flex-wrap gap-2">
            {s.status !== "done" ? (
              <form action={formAction}>
                <input type="hidden" name="property_id" value={propertyId} />
                <input type="hidden" name="step" value={s.step} />
                <input type="hidden" name="status" value="done" />
                {s.note ? <input type="hidden" name="note" value={s.note} /> : null}
                <SubmitButton size="sm" variant="secondary" icon="check" pendingLabel={`Marking ${label} as done`}>
                  Mark done
                </SubmitButton>
              </form>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Update ${label}`}>
              Update
            </Button>
          </div>
        ) : null}
      </div>

      {canWrite && !editing && !state.ok && (state.message || state.fieldErrors) ? (
        <div className="mt-3 pl-[1.6rem]">
          <FormSummary state={state} labels={{ note: "Note" }} idPrefix={idPrefix} />
        </div>
      ) : null}

      {canWrite && editing ? (
        <form action={formAction} className="mt-4 grid gap-4 pl-[1.6rem]" noValidate>
          <FormSummary state={state} labels={{ note: "Note", status: "Status" }} idPrefix={idPrefix} />
          <input type="hidden" name="property_id" value={propertyId} />
          <input type="hidden" name="step" value={s.step} />
          <Select
            name="status"
            idPrefix={idPrefix}
            label="Status"
            options={HANDOVER_STEP_STATUSES.map((v) => ({ value: v, label: HANDOVER_STEP_STATUS_LABEL[v] }))}
            defaultValue={fieldsFromState.status ?? s.status}
            data-autofocus
          />
          <Textarea
            name="note"
            idPrefix={idPrefix}
            label="Note"
            rows={3}
            maxLength={NOTE_MAX}
            hint="Required when the step is not applicable, so the reason is on record. Otherwise optional."
            defaultValue={fieldsFromState.note ?? s.note ?? ""}
          />
          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingLabel={`Saving ${label}`}>Save</SubmitButton>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      <span className="sr-only" role="status">
        {state.ok ? state.message : ""}
      </span>
    </li>
  );
}
