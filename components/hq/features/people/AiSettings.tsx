"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/hq/Button";
import { ConfirmDialog } from "@/components/hq/ConfirmDialog";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TextInput } from "@/components/hq/TextInput";
import { useToast } from "@/components/hq/Toast";
import { MAX_HOURLY_LIMIT, MIN_HOURLY_LIMIT } from "@/lib/hq/ai-log";
import { idle } from "@/lib/hq/forms";
import { setAiEnabledAction, updateAiHourlyLimitAction } from "./account-actions";

/*
 * The two connected-app settings, for people with settings.admin (directors):
 *  - the connection on or off for everyone. Turning it ON is confirmed first (it lets chat apps act
 *    as each person who connects one); turning it OFF is one click, because it is the emergency lever;
 *  - the hourly limit per person, 1 to 1000.
 * Both are checked again by the server and by the database (row level security and the settings guard).
 */

export function AiSettings({ enabled, hourlyLimit }: { enabled: boolean; hourlyLimit: number }) {
  const { toast } = useToast();
  const [confirmOn, setConfirmOn] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, action] = useActionState(updateAiHourlyLimitAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;

  async function change(on: boolean) {
    const result = await setAiEnabledAction(on);
    toast(result.message ?? (result.ok ? "Saved." : "We could not do that."), { tone: result.ok ? "success" : "error" });
  }

  return (
    <div className="grid gap-10">
      <section aria-labelledby="ai-switch-h" className="grid max-w-xl gap-3">
        <h3 id="ai-switch-h" className="font-semibold">
          The connection
        </h3>
        <p className="hq-muted text-[14px]">
          {enabled
            ? "Switching it off refuses every connected app from its next call, for everyone. Nothing else changes: people stay connected and can be switched back on."
            : "Switching it on lets each person with the right role connect ChatGPT or Claude to HQ. The app can then do only what that person can do, and every call is logged below."}
        </p>
        <div>
          {enabled ? (
            <Button variant="danger" loading={pending} pendingLabel="Switching off" onClick={() => startTransition(() => change(false))}>
              Switch the connection off
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setConfirmOn(true)}>
              Switch the connection on
            </Button>
          )}
        </div>
        <ConfirmDialog
          open={confirmOn}
          onClose={() => setConfirmOn(false)}
          title="Switch the connection on for everyone?"
          confirmLabel="Switch it on"
          onConfirm={() => change(true)}
        >
          ChatGPT and Claude will be able to read and make small changes in HQ as each person who connects them, with exactly that person&rsquo;s permissions. You can switch it off
          again at any time.
        </ConfirmDialog>
      </section>

      <section aria-labelledby="ai-limit-h" className="max-w-xl">
        <h3 id="ai-limit-h" className="mb-1 font-semibold">
          Hourly limit
        </h3>
        <p className="hq-muted mb-4 text-[14px]">
          Calls each person&rsquo;s apps may make in any hour. A chat app often makes several calls to answer one question.
        </p>
        <form action={action} noValidate className="grid gap-4">
          <FormSummary state={state} labels={{ hourlyLimit: "Calls per person per hour" }} idPrefix="ai" />
          <TextInput
            name="hourlyLimit"
            idPrefix="ai"
            label="Calls per person per hour"
            hint={`A whole number from ${MIN_HOURLY_LIMIT} to ${MAX_HOURLY_LIMIT}.`}
            type="number"
            inputMode="numeric"
            min={MIN_HOURLY_LIMIT}
            max={MAX_HOURLY_LIMIT}
            step={1}
            required
            defaultValue={values.hourlyLimit ?? String(hourlyLimit)}
            error={fieldError(state, "hourlyLimit")}
            className="max-w-xs"
          />
          <div>
            <SubmitButton variant="secondary" pendingLabel="Saving the limit">
              Save limit
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
