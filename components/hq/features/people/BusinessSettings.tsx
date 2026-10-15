"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/hq/Button";
import { ConfirmDialog } from "@/components/hq/ConfirmDialog";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { Select } from "@/components/hq/Select";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { StatusChip } from "@/components/hq/StatusChip";
import { useToast } from "@/components/hq/Toast";
import { idle } from "@/lib/hq/forms";
import { AU_TIMEZONES } from "@/lib/hq/timezones";
import { setRequireMfaAction, updateBusinessTimezoneAction } from "./account-actions";

/*
 * Business settings, for people with settings.admin (directors). Two settings:
 *  - whether two-step verification is required for everyone. Turning it OFF is confirmed first;
 *  - the business timezone, which decides what "today" and "overdue" mean for everyone.
 * Both are checked again by the server and by row level security.
 */

export function BusinessSettings({ requireMfa, timezone }: { requireMfa: boolean; timezone: string }) {
  const { toast } = useToast();
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, action] = useActionState(updateBusinessTimezoneAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;

  async function change(required: boolean) {
    const result = await setRequireMfaAction(required);
    toast(result.message ?? (result.ok ? "Saved." : "We could not do that."), { tone: result.ok ? "success" : "error" });
  }

  return (
    <div className="grid gap-10">
      <section aria-labelledby="mfa-setting-h" className="grid max-w-xl gap-3">
        <h3 id="mfa-setting-h" className="font-semibold">
          Two-step verification
        </h3>
        <p>
          <StatusChip tone={requireMfa ? "success" : "warning"}>{requireMfa ? "Required for everyone" : "Not required"}</StatusChip>
        </p>
        <p className="hq-muted text-[14px]">
          {requireMfa
            ? "Everyone signs in with an emailed code and a code from an authenticator app. Until someone completes the second step they can see nothing in HQ."
            : "Right now an emailed code is enough. Turn this on before real client or partner details go in: HQ holds personal information."}
        </p>
        <div>
          {requireMfa ? (
            <Button variant="danger" onClick={() => setConfirmOff(true)}>
              Turn off
            </Button>
          ) : (
            <Button variant="primary" loading={pending} pendingLabel="Turning on" onClick={() => startTransition(() => change(true))}>
              Require it for everyone
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmOff}
          onClose={() => setConfirmOff(false)}
          title="Turn off two-step verification for everyone?"
          confirmLabel="Turn off for everyone"
          tone="danger"
          onConfirm={() => change(false)}
        >
          Anyone who has signed in with an emailed code will be able to see everything their role allows, without the second step. You can turn it back on at any time.
        </ConfirmDialog>
      </section>

      <section aria-labelledby="tz-setting-h" className="max-w-xl">
        <h3 id="tz-setting-h" className="mb-1 font-semibold">
          Business timezone
        </h3>
        <p className="hq-muted mb-4 text-[14px]">Decides which day is &ldquo;today&rdquo; and what counts as overdue, for everyone.</p>
        <form action={action} noValidate className="grid gap-4">
          <FormSummary state={state} labels={{ timezone: "Business timezone" }} idPrefix="biz" />
          <Select
            name="timezone"
            idPrefix="biz"
            label="Business timezone"
            hideLabel
            options={AU_TIMEZONES.some((z) => z.value === timezone) ? AU_TIMEZONES : [{ value: timezone, label: timezone }, ...AU_TIMEZONES]}
            defaultValue={values.timezone ?? timezone}
            error={fieldError(state, "timezone")}
          />
          <div>
            <SubmitButton variant="secondary" pendingLabel="Saving the timezone">
              Save timezone
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
