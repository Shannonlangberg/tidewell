"use client";

import { useActionState, useState } from "react";
import {
  RATING_FIELDS,
  RATING_LABEL,
  RATING_SCALE_HINT,
  RATING_VALUES,
  TENANT_FEEDBACK,
  TENANT_FEEDBACK_LABEL,
} from "@/lib/hq/contractors/reviews-form";
import { idle, type ActionState } from "@/lib/hq/forms";
import { Button } from "@/components/hq/Button";
import { Drawer } from "@/components/hq/Drawer";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { Select } from "@/components/hq/Select";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { DateInput, Textarea, TextInput } from "@/components/hq/TextInput";
import { recordReviewAction } from "./actions";

/*
 * "Record job feedback": four optional 1 to 5 ratings (rate what you know), tenant feedback,
 * whether rework was needed, the job date, a free-text job reference the person types (HQ never
 * reads Ailo), and notes. At least one rating or a note is required. A bottom sheet below 768px.
 */

const LABELS: Record<string, string> = {
  ...RATING_LABEL,
  job_date: "Job date",
  job_reference: "Job reference",
  tenant_feedback: "Tenant feedback",
  rework_required: "Rework",
  notes: "Notes",
};

export function ReviewForm({ contractorId, businessName, today }: { contractorId: string; businessName: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon="plus"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        Record job feedback
      </Button>
      <ReviewSession key={session} contractorId={contractorId} businessName={businessName} today={today} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ReviewSession({ contractorId, businessName, today, open, onClose }: { contractorId: string; businessName: string; today: string; open: boolean; onClose: () => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(recordReviewAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;
  const [lastOk, setLastOk] = useState<ActionState | null>(null);
  if (state.ok && state !== lastOk) {
    setLastOk(state);
    if (open) onClose();
  }

  return (
    <form action={formAction} noValidate className="contents">
      <Drawer
        open={open}
        onClose={onClose}
        title="Record job feedback"
        description={businessName}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving feedback">Save feedback</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix="review" />
          <input type="hidden" name="contractor_id" value={contractorId} />

          <fieldset className="grid gap-4 border-0 p-0">
            <legend className="hq-field__label mb-1">Ratings</legend>
            <p className="hq-field__hint -mt-2">{RATING_SCALE_HINT}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {RATING_FIELDS.map((k) => (
                <Select
                  key={k}
                  name={k}
                  idPrefix="review"
                  label={RATING_LABEL[k]}
                  placeholder="Not rated"
                  options={RATING_VALUES.map((v) => ({ value: v, label: v }))}
                  defaultValue={values[k] ?? ""}
                  error={fieldError(state, k)}
                />
              ))}
            </div>
          </fieldset>

          <Select
            name="tenant_feedback"
            idPrefix="review"
            label="Tenant feedback"
            placeholder="Not recorded"
            options={TENANT_FEEDBACK.map((t) => ({ value: t, label: TENANT_FEEDBACK_LABEL[t] }))}
            defaultValue={values.tenant_feedback ?? ""}
            error={fieldError(state, "tenant_feedback")}
          />

          <Select
            name="rework_required"
            idPrefix="review"
            label="Was rework needed?"
            placeholder="Not recorded"
            options={[
              { value: "no", label: "No rework needed" },
              { value: "yes", label: "Yes, rework was needed" },
            ]}
            defaultValue={values.rework_required ?? ""}
            error={fieldError(state, "rework_required")}
          />

          <DateInput
            name="job_date"
            idPrefix="review"
            label="Job date"
            hint="Optional. When the work was done. It cannot be in the future."
            max={today}
            defaultValue={values.job_date ?? ""}
            error={fieldError(state, "job_date")}
          />

          <TextInput
            name="job_reference"
            idPrefix="review"
            label="Job reference"
            hint="Optional. Type the work order number or a short description. HQ does not look it up."
            maxLength={200}
            defaultValue={values.job_reference ?? ""}
            error={fieldError(state, "job_reference")}
          />

          <Textarea
            name="notes"
            idPrefix="review"
            label="Notes"
            rows={4}
            maxLength={2000}
            hint="Required if you give no rating."
            defaultValue={values.notes ?? ""}
            error={fieldError(state, "notes")}
          />
        </div>
      </Drawer>
    </form>
  );
}
