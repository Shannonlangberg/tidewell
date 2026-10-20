"use client";

import { useActionState } from "react";
import { idle, type ActionState } from "@/lib/hq/forms";
import { GOAL_MAX } from "@/lib/hq/portfolio/rules";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { SubmitButton } from "../../SubmitButton";
import { DateInput, TextInput } from "../../TextInput";

/*
 * The business goal, for directors (settings.admin): how many managed properties, and by when. The
 * date is the owner's to set: it starts empty and an empty date clears it (HQ never invents one, and
 * without it there is no pace). The action is passed in; it checks settings.admin again and the
 * database validates both values.
 */
export function GoalForm({ action, target, date, today }: { action: (prev: ActionState, formData: FormData) => Promise<ActionState>; target: number; date: string | null; today: string }) {
  const [state, formAction] = useActionState(action, idle);
  const retained = (state.data?.values ?? null) as Record<string, string> | null;
  return (
    <form action={formAction} noValidate className="grid max-w-xl gap-5">
      <FormSummary state={state} labels={{ target: "Managed properties", goal_date: "By" }} idPrefix="goal" />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput
          name="target"
          idPrefix="goal"
          label="Managed properties"
          required
          inputMode="numeric"
          maxLength={5}
          error={fieldError(state, "target")}
          defaultValue={retained?.target ?? String(target)}
          hint={`A whole number, 1 to ${GOAL_MAX}.`}
        />
        <DateInput
          name="goal_date"
          idPrefix="goal"
          label="By"
          min={today}
          error={fieldError(state, "goal_date")}
          defaultValue={retained?.goal_date ?? date ?? ""}
          hint="Leave empty until you have decided. The pace appears once it is set."
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pendingLabel="Saving the goal">Save goal</SubmitButton>
        {state.ok && state.message ? (
          <p className="text-[14px]" role="status">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
