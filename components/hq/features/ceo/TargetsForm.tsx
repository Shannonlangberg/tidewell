"use client";

import { useActionState } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { TARGET_HINT, TARGET_KEYS, TARGET_LABEL, type Targets } from "@/lib/hq/ceo/rules";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { SubmitButton } from "../../SubmitButton";
import { TextInput } from "../../TextInput";

/*
 * The weekly activity targets, for directors (settings.admin). Every target is optional and starts empty:
 * HQ never suggests a number. An empty field means "no target" for that measure.
 */
export function TargetsForm({ action, targets }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; targets: Targets | null }) {
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} noValidate className="grid gap-4">
      <FormSummary state={state} labels={TARGET_LABEL} idPrefix="ceo-targets" />
      <div className="grid gap-4 sm:grid-cols-2">
        {TARGET_KEYS.map((k) => (
          <TextInput
            key={k}
            name={k}
            idPrefix="ceo-targets"
            label={`${TARGET_LABEL[k]} a week`}
            inputMode="numeric"
            maxLength={4}
            defaultValue={targets?.[k] === undefined ? "" : String(targets[k])}
            error={fieldError(state, k)}
            hint={TARGET_HINT[k]}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Saving the targets">Save targets</SubmitButton>
        {state.ok && state.message ? (
          <p className="text-[14px]" role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
