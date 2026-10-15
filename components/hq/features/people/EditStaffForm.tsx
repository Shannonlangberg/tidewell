"use client";

import { useActionState } from "react";
import { FormActions, fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { NativeSelectPicker, Select, type PickerOption, type SelectOption } from "@/components/hq/Select";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { useToast } from "@/components/hq/Toast";
import { DateInput, Textarea, TextInput } from "@/components/hq/TextInput";
import { idle, type ActionState } from "@/lib/hq/forms";
import { updateStaffAction } from "./actions";

const LABELS = {
  fullName: "Full name",
  firstName: "First name",
  role: "Role",
  employmentStatus: "Status",
  pod: "Pod",
  startDate: "Start date",
  responsibilities: "Responsibilities",
};

export type EditableStaff = {
  id: string;
  fullName: string;
  firstName: string;
  role: string;
  employmentStatus: string;
  podId: string | null;
  startDate: string | null;
  responsibilities: string | null;
};

export function EditStaffForm({
  person,
  roles,
  statuses,
  pods,
  isSelf,
}: {
  person: EditableStaff;
  roles: readonly SelectOption[];
  statuses: readonly SelectOption[];
  pods: readonly PickerOption[];
  /** Nobody changes their own role or status; the database refuses it, so the fields are off. */
  isSelf: boolean;
}) {
  const { toast } = useToast();
  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateStaffAction(prev, formData);
    if (result.ok) toast(result.message ?? "Changes saved.");
    return result;
  }, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;
  const v = (name: keyof typeof LABELS, fallback: string | null) => values[name] ?? fallback ?? "";

  return (
    <form action={action} noValidate className="grid gap-5">
      <FormSummary state={state} labels={LABELS} />
      <input type="hidden" name="staffId" value={person.id} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInput name="fullName" label="Full name" required maxLength={120} defaultValue={v("fullName", person.fullName)} error={fieldError(state, "fullName")} />
        <TextInput
          name="firstName"
          label="First name"
          required
          maxLength={60}
          defaultValue={v("firstName", person.firstName)}
          error={fieldError(state, "firstName")}
          hint="Used in greetings."
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Select
          name="role"
          label="Role"
          options={roles}
          defaultValue={v("role", person.role)}
          error={fieldError(state, "role")}
          disabled={isSelf}
          hint={isSelf ? "You cannot change your own role. Ask another administrator." : undefined}
        />
        <Select
          name="employmentStatus"
          label="Status"
          options={statuses}
          defaultValue={v("employmentStatus", person.employmentStatus)}
          error={fieldError(state, "employmentStatus")}
          disabled={isSelf}
          hint={isSelf ? undefined : "On leave and Ended both stop access. Set Active to give it back."}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <NativeSelectPicker name="pod" label="Pod" placeholder="No pod" options={pods} defaultValue={v("pod", person.podId)} error={fieldError(state, "pod")} />
        <DateInput name="startDate" label="Start date" defaultValue={v("startDate", person.startDate)} error={fieldError(state, "startDate")} />
      </div>
      <Textarea
        name="responsibilities"
        label="Responsibilities"
        rows={3}
        maxLength={2000}
        defaultValue={v("responsibilities", person.responsibilities)}
        error={fieldError(state, "responsibilities")}
        hint="What this person looks after. Type over the text to change it."
      />
      <FormActions>
        <SubmitButton pendingLabel="Saving changes">Save changes</SubmitButton>
      </FormActions>
    </form>
  );
}
