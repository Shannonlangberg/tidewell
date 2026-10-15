"use client";

import { useActionState } from "react";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { useToast } from "@/components/hq/Toast";
import { TextInput } from "@/components/hq/TextInput";
import { idle, type ActionState } from "@/lib/hq/forms";
import { createPodAction } from "./actions";

/** Pods are configurable: nothing about them is built into the code. Directors and administrators add them here. */
export function AddPodForm() {
  const { toast } = useToast();
  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await createPodAction(prev, formData);
    if (result.ok) toast(result.message ?? "Pod added.");
    return result;
  }, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;

  return (
    <form action={action} noValidate className="grid gap-4">
      <FormSummary state={state} labels={{ name: "Pod name", region: "Region" }} idPrefix="pod" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput name="name" idPrefix="pod" label="Pod name" required maxLength={80} defaultValue={values.name ?? ""} error={fieldError(state, "name")} />
        <TextInput name="region" idPrefix="pod" label="Region" maxLength={120} defaultValue={values.region ?? ""} error={fieldError(state, "region")} hint="Optional." />
      </div>
      <div>
        <SubmitButton variant="secondary" icon="plus" pendingLabel="Adding pod">
          Add pod
        </SubmitButton>
      </div>
    </form>
  );
}
