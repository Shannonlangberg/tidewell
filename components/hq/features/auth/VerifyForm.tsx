"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyCode } from "@/app/hq/auth-actions";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TextInput } from "@/components/hq/TextInput";
import { idle } from "@/lib/hq/forms";

/*
 * Six digits from the email. The address itself is never in this form or in the URL: it waits
 * in an HttpOnly cookie that only the server reads.
 */

export function VerifyForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyCode, idle);
  const resend = next === "/hq" ? "/hq/sign-in" : `/hq/sign-in?next=${encodeURIComponent(next)}`;

  return (
    <form action={action} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ token: "Code" }} />
      <input type="hidden" name="next" value={next} />

      <TextInput
        name="token"
        label="Six-digit code"
        required
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        autoFocus
        error={fieldError(state, "token")}
        className="[&_input]:text-center [&_input]:text-[24px] [&_input]:tracking-[0.5em] [&_input]:tabular-nums"
      />

      <SubmitButton block pendingLabel="Checking your code">
        Sign in
      </SubmitButton>

      <p className="hq-muted text-[13px] leading-relaxed">
        Not there yet? Check your junk folder, or{" "}
        <Link href={resend} className="underline underline-offset-2">
          ask for a new code
        </Link>
        . A code lasts ten minutes and works once.
      </p>
    </form>
  );
}
