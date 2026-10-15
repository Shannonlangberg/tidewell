"use client";

import { useActionState } from "react";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { Select } from "@/components/hq/Select";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TextInput } from "@/components/hq/TextInput";
import { idle } from "@/lib/hq/forms";
import { AU_TIMEZONES, OTHER_TIMEZONE, isAustralianTimezone } from "@/lib/hq/timezones";
import { updateTimezoneAction } from "./account-actions";

/*
 * Your own timezone: the moments HQ shows you (when a call was logged, when someone was added) are
 * in it. A list of Australian zones, plus "Other" with a free IANA name that is checked on the server.
 */
export function TimezoneForm({ current }: { current: string }) {
  const [state, action] = useActionState(updateTimezoneAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;
  const inList = isAustralianTimezone(current);
  const choice = values.timezone ?? (inList ? current : OTHER_TIMEZONE);
  const other = values.timezoneOther ?? (inList ? "" : current);

  return (
    <form action={action} noValidate className="grid max-w-xl gap-5">
      <FormSummary state={state} labels={{ timezone: "Timezone", timezoneOther: "Other timezone" }} />
      <Select
        name="timezone"
        label="Timezone"
        options={[...AU_TIMEZONES, { value: OTHER_TIMEZONE, label: "Other (type its name below)" }]}
        defaultValue={choice}
        error={fieldError(state, "timezone")}
      />
      <TextInput
        name="timezoneOther"
        label="Other timezone"
        defaultValue={other}
        error={fieldError(state, "timezoneOther")}
        hint="Only used when Other is chosen. Use the standard name, like Pacific/Auckland."
      />
      <div>
        <SubmitButton pendingLabel="Saving your timezone">Save timezone</SubmitButton>
      </div>
    </form>
  );
}
