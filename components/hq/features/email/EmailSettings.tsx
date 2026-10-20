"use client";

import { useActionState, useState, useTransition } from "react";
import { idle } from "@/lib/hq/forms";
import { CHAT_SEND_WINDOW_MINUTES, DAILY_LIMIT_MAX, DAILY_LIMIT_MIN } from "@/lib/hq/email/rules";
import { setEmailChatSendAction, updateEmailDailyLimitAction } from "@/app/hq/(app)/email/actions";
import { Button } from "../../Button";
import { ConfirmDialog } from "../../ConfirmDialog";
import { fieldError } from "../../Field";
import { FormSummary } from "../../FormSummary";
import { StatusChip } from "../../StatusChip";
import { SubmitButton } from "../../SubmitButton";
import { TextInput } from "../../TextInput";
import { useToast } from "../../Toast";

/*
 * The two email settings, for directors (settings.admin): chat sending (off by default; switching it
 * on is confirmed first, with a plain warning; off is one click) and the daily send limit. Both are
 * checked again by the server action and by the database (row level security and the settings guard).
 */

export function EmailSettings({ chatSend, dailyLimit }: { chatSend: boolean; dailyLimit: number }) {
  const { toast } = useToast();
  const [confirmOn, setConfirmOn] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, action] = useActionState(updateEmailDailyLimitAction, idle);
  const values = (state.data?.values ?? {}) as Record<string, string>;

  async function change(on: boolean) {
    const result = await setEmailChatSendAction(on);
    toast(result.message ?? (result.ok ? "Saved." : "We could not do that."), { tone: result.ok ? "success" : "error" });
  }

  return (
    <div className="grid gap-10">
      <section aria-labelledby="email-chat-h" className="grid max-w-xl gap-3">
        <h3 id="email-chat-h" className="font-semibold">
          Sending from chat
        </h3>
        <p>
          <StatusChip tone={chatSend ? "warning" : "neutral"}>{chatSend ? "On" : "Off (recommended)"}</StatusChip>
        </p>
        <p className="hq-muted text-[14px]">
          {chatSend
            ? `On: a chat app can send a draft it made in the last ${CHAT_SEND_WINDOW_MINUTES} minutes without anyone tapping Approve and send in HQ, after the person confirms the address in the chat. Only to addresses already on HQ records, one person per email, within the daily limit, and only for roles that can send email.`
            : "Off: every email waits in HQ until someone who can send email taps Approve and send. A chat app can draft emails and send ones already approved, nothing more."}
        </p>
        <div>
          {chatSend ? (
            <Button variant="secondary" loading={pending} pendingLabel="Switching off" onClick={() => startTransition(() => change(false))}>
              Switch chat sending off
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmOn(true)}>
              Switch chat sending on
            </Button>
          )}
        </div>
        <ConfirmDialog open={confirmOn} onClose={() => setConfirmOn(false)} title="Let chat apps send without the HQ tap?" confirmLabel="Switch chat sending on" tone="danger" onConfirm={() => change(true)}>
          <p>
            ChatGPT or Claude will be able to send an email it has just drafted (within {CHAT_SEND_WINDOW_MINUTES} minutes) as soon as the person confirms the address in the
            chat, without anyone checking it in HQ first. A chat app can word things badly or misunderstand; the email goes out in PLANTED.&rsquo;s name.
          </p>
          <p className="mt-2">It still only reaches addresses already on HQ records, one person per email, within the daily limit. You can switch it off at any time.</p>
        </ConfirmDialog>
      </section>

      <section aria-labelledby="email-limit-h" className="max-w-xl">
        <h3 id="email-limit-h" className="mb-1 font-semibold">
          Daily limit
        </h3>
        <p className="hq-muted mb-4 text-[14px]">Emails each person may send in a day (the business&rsquo;s calendar day). Failed attempts count too.</p>
        <form action={action} noValidate className="grid gap-4">
          <FormSummary state={state} labels={{ dailyLimit: "Emails per person per day" }} idPrefix="email" />
          <TextInput
            name="dailyLimit"
            idPrefix="email"
            label="Emails per person per day"
            hint={`A whole number from ${DAILY_LIMIT_MIN} to ${DAILY_LIMIT_MAX}.`}
            type="number"
            inputMode="numeric"
            min={DAILY_LIMIT_MIN}
            max={DAILY_LIMIT_MAX}
            step={1}
            required
            defaultValue={values.dailyLimit ?? String(dailyLimit)}
            error={fieldError(state, "dailyLimit")}
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
