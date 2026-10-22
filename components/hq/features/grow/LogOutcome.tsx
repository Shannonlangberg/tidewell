"use client";

import { useActionState, useState } from "react";
import { CALL_OUTCOME_LABEL, CALL_OUTCOMES } from "@/lib/hq/constants";
import { idle } from "@/lib/hq/forms";
import { FOLLOW_UP_CHOICES, FOLLOW_UP_LABEL, type FollowUpChoice } from "@/lib/hq/growth/call-log";
import { retainedText, type RetainedValues } from "@/lib/hq/growth/retain";
import { Button } from "../../Button";
import { Checkbox, RadioGroup } from "../../Choice";
import { Drawer } from "../../Drawer";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, Textarea, TextInput } from "../../TextInput";
import { useCloseWhenDone } from "../referrals/useCloseWhenDone";
import { logCallOutcome } from "./actions";

/*
 * "Log outcome" on a call in Today's Grow workspace: Call, then log the outcome, then set the next
 * follow-up. The button only opens the form; the Server Action and the database do the work and check
 * the permission. The drawer stays open on a failed save, keeping what was typed, and closes once the
 * save has redirected back.
 */

const LABELS: Record<string, string> = {
  outcome: "How it went",
  summary: "What was said",
  next_step: "Next step",
  follow_up: "Next follow-up",
  follow_up_date: "Follow-up date",
  reason: "Why no follow-up",
  callback_promised: "Promised callback",
};

export type LogOutcomeTarget = { kind: "contact" | "lead"; id: string; name: string; nextStep: string | null };

export function LogOutcomeButton({ target, today, primary = false }: { target: LogOutcomeTarget; today: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        size="sm"
        variant={primary ? "primary" : undefined}
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        Log outcome
      </Button>
      <LogOutcomeSession key={session} open={open} onClose={() => setOpen(false)} target={target} today={today} />
    </>
  );
}

function LogOutcomeSession({ open, onClose, target, today }: { open: boolean; onClose: () => void; target: LogOutcomeTarget; today: string }) {
  const [state, formAction, pending] = useActionState(logCallOutcome, idle);
  const values = (state.data?.values ?? {}) as RetainedValues;
  const [choice, setChoice] = useState<FollowUpChoice | "">("");
  useCloseWhenDone(state, pending, onClose);
  const choices = FOLLOW_UP_CHOICES.filter((c) => c !== "none" || target.kind === "contact");
  const prefix = `log-${target.kind}-${target.id.slice(0, 8)}`;

  return (
    <form action={formAction} noValidate>
      <Drawer
        open={open}
        onClose={onClose}
        title="Log the call"
        description={`With ${target.name}. It goes on their timeline${target.kind === "lead" ? " and the lead's" : ""}.`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <SubmitButton pendingLabel="Saving">Save call</SubmitButton>
          </>
        }
      >
        <div className="grid gap-5">
          <FormSummary state={state} labels={LABELS} idPrefix={prefix} />
          <input type="hidden" name="target" value={target.kind} />
          <input type="hidden" name="id" value={target.id} />

          <RadioGroup
            name="outcome"
            idPrefix={prefix}
            legend="How did it go?"
            segmented
            required
            defaultValue={retainedText(values, "outcome")}
            error={fieldError(state, "outcome")}
            options={CALL_OUTCOMES.map((o) => ({ value: o, label: CALL_OUTCOME_LABEL[o] }))}
          />

          <Textarea
            name="summary"
            idPrefix={prefix}
            label="What was said"
            rows={3}
            hint="Needed when you spoke. For a message or no answer, leave it blank if there is nothing to add."
            maxLength={4000}
            defaultValue={retainedText(values, "summary")}
            error={fieldError(state, "summary")}
            data-autofocus
          />

          <TextInput
            name="next_step"
            idPrefix={prefix}
            label="Next step"
            maxLength={300}
            hint={target.nextStep ? `Now: ${target.nextStep}. Leave blank to keep it.` : "What happens next, in a few words."}
            defaultValue={retainedText(values, "next_step")}
            error={fieldError(state, "next_step")}
          />

          <div onChange={(e) => {
            const t = e.target as HTMLInputElement;
            if (t.name === "follow_up") setChoice(t.value as FollowUpChoice);
          }}>
            <RadioGroup
              name="follow_up"
              idPrefix={prefix}
              legend="Next follow-up"
              required
              hint={target.kind === "lead" ? "An open lead always has a next step." : undefined}
              defaultValue={retainedText(values, "follow_up")}
              error={fieldError(state, "follow_up")}
              options={choices.map((c) => ({ value: c, label: FOLLOW_UP_LABEL[c] }))}
            />
          </div>

          {choice === "date" || retainedText(values, "follow_up") === "date" ? (
            <DateInput name="follow_up_date" idPrefix={prefix} label="Follow up on" required min={today} defaultValue={retainedText(values, "follow_up_date")} error={fieldError(state, "follow_up_date")} />
          ) : null}
          {choice === "none" || retainedText(values, "follow_up") === "none" ? (
            <TextInput name="reason" idPrefix={prefix} label="Why no follow-up is needed" required maxLength={300} defaultValue={retainedText(values, "reason")} error={fieldError(state, "reason")} />
          ) : null}

          <Checkbox
            name="callback_promised"
            idPrefix={prefix}
            label="I promised to call them back by then"
            hint="They come to the top of your calls on that day."
            defaultChecked={retainedText(values, "callback_promised") === "on"}
            error={fieldError(state, "callback_promised")}
          />
        </div>
      </Drawer>
    </form>
  );
}
