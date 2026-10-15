"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { updateContactField } from "@/app/hq/(app)/growth/contacts/actions";
import { idle } from "@/lib/hq/forms";
import { fieldError } from "../../Field";
import { NativeSelectPicker, Select, type PickerOption } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { DateInput } from "../../TextInput";
import { useToast } from "../../Toast";

/*
 * A small form that changes ONE field of a contact and saves without leaving the page: the
 * relationship status, priority, owner and next follow-up date on the profile. The Save button
 * appears only once the value has changed. The Server Action checks the capability and
 * validates the value again; this component is a convenience, not a control.
 */

type Common = {
  contactId: string;
  field: "relationship_status" | "priority" | "relationship_owner_id" | "next_follow_up_date";
  /** Read by screen readers; the visible label is the row's. */
  label: string;
  /** The saved value ("" for none). */
  value: string;
};

type Props =
  | (Common & { kind: "select"; options: readonly { value: string; label: string }[] })
  | (Common & { kind: "picker"; options: readonly PickerOption[]; placeholder: string })
  | (Common & { kind: "date"; min: string });

export function InlineField(props: Props) {
  const { contactId, field, label, value } = props;
  const [state, formAction] = useActionState(updateContactField, idle);
  const [current, setCurrent] = useState(value);
  const { toast } = useToast();
  const handled = useRef(state);

  // The saved value changed (after a save, or someone else's edit): show it.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setCurrent(value);
  }

  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state.ok) toast("Saved");
  }, [state, toast]);

  const dirty = current !== value;
  const error = fieldError(state, "value") ?? (!state.ok && state.message ? state.message : undefined);
  const idPrefix = `inline-${field}`;

  return (
    <form action={formAction} noValidate className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="id" value={contactId} />
      <input type="hidden" name="field" value={field} />
      <div className="min-w-0 flex-1 basis-40">
        {props.kind === "select" ? (
          <Select
            name="value"
            idPrefix={idPrefix}
            label={label}
            hideLabel
            options={props.options}
            defaultValue={value}
            error={error}
            onChange={(e) => setCurrent(e.target.value)}
          />
        ) : props.kind === "picker" ? (
          <NativeSelectPicker
            name="value"
            idPrefix={idPrefix}
            label={label}
            hideLabel
            placeholder={props.placeholder}
            options={props.options}
            defaultValue={value}
            error={error}
            onChange={(e) => setCurrent(e.target.value)}
          />
        ) : (
          <DateInput name="value" idPrefix={idPrefix} label={label} hideLabel min={props.min} defaultValue={value} error={error} onChange={(e) => setCurrent(e.target.value)} />
        )}
      </div>
      {dirty ? (
        <SubmitButton size="sm" variant="secondary" pendingLabel={`Saving ${label.toLowerCase()}`} className="mt-1.5">
          Save
        </SubmitButton>
      ) : null}
    </form>
  );
}
