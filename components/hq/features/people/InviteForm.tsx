"use client";

import { useActionState } from "react";
import { LinkButton } from "@/components/hq/Button";
import { FormActions, fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { NativeSelectPicker, Select, type PickerOption, type SelectOption } from "@/components/hq/Select";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { DateInput, Textarea, TextInput } from "@/components/hq/TextInput";
import { idle } from "@/lib/hq/forms";
import { inviteStaffAction } from "./actions";

const LABELS = {
  fullName: "Full name",
  email: "Email address",
  role: "Role",
  pod: "Pod",
  startDate: "Start date",
  responsibilities: "Responsibilities",
};

export function InviteForm({ roles, pods }: { roles: readonly SelectOption[]; pods: readonly PickerOption[] }) {
  const [state, action] = useActionState(inviteStaffAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;

  return (
    <form action={action} noValidate className="grid max-w-2xl gap-5">
      <FormSummary state={state} labels={LABELS} />
      <TextInput name="fullName" label="Full name" required maxLength={120} defaultValue={values.fullName ?? ""} error={fieldError(state, "fullName")} />
      <TextInput
        name="email"
        type="email"
        label="Email address"
        required
        maxLength={254}
        defaultValue={values.email ?? ""}
        error={fieldError(state, "email")}
        hint="They sign in with this address. There are no passwords."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="role"
          label="Role"
          required
          placeholder="Choose a role"
          options={roles}
          defaultValue={values.role ?? ""}
          error={fieldError(state, "role")}
          hint="A role decides what someone can see and change."
        />
        <NativeSelectPicker name="pod" label="Pod" placeholder="No pod" options={pods} defaultValue={values.pod ?? ""} error={fieldError(state, "pod")} />
      </div>
      <DateInput name="startDate" label="Start date" defaultValue={values.startDate ?? ""} error={fieldError(state, "startDate")} />
      <Textarea
        name="responsibilities"
        label="Responsibilities"
        rows={3}
        maxLength={2000}
        defaultValue={values.responsibilities ?? ""}
        error={fieldError(state, "responsibilities")}
        hint="Optional. What this person looks after."
      />
      <FormActions>
        <LinkButton href="/hq/people">Cancel</LinkButton>
        <SubmitButton pendingLabel="Adding person">Add person</SubmitButton>
      </FormActions>
    </form>
  );
}
