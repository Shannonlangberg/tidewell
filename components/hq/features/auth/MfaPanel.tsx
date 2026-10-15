"use client";

import Link from "next/link";
import { useActionState } from "react";
import { enrolTotp, verifyTotp, type EnrolState } from "@/app/hq/auth-actions";
import { Button } from "@/components/hq/Button";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TextInput } from "@/components/hq/TextInput";
import { idle } from "@/lib/hq/forms";

/*
 * The second step: an authenticator app (Google Authenticator, 1Password, Authy, or the one
 * built into a phone).
 *
 *  - enrol:     first time. Create a factor, show its QR code and secret, then check six digits.
 *  - challenge: every later sign-in. Check six digits against the factor already on file.
 *  - manage:    an already-confirmed session. Say it is set up, and offer to replace it (enrol,
 *               and the old one is removed only once the new one has proved it works).
 *
 * A success rotates the cookies to an aal2 session and the server redirects.
 */

export type MfaMode = "enrol" | "challenge" | "manage";

const INITIAL_ENROL: EnrolState = { stage: "idle", error: null };

/** Supabase returns the QR code as a ready-made data URL (older versions returned bare SVG markup): accept both. */
function qrSource(qr: string): string {
  return qr.startsWith("data:") ? qr : `data:image/svg+xml;utf-8,${encodeURIComponent(qr)}`;
}

export function MfaPanel({
  mode,
  factorId,
  next,
  mfaRequired,
}: {
  mode: MfaMode;
  /** The confirmed factor to challenge. Null in enrol and manage modes. */
  factorId: string | null;
  next: string;
  mfaRequired: boolean;
}) {
  const [enrol, enrolAction, enrolling] = useActionState(enrolTotp, INITIAL_ENROL);

  if (mode === "challenge" && factorId) {
    return <VerifyTotpForm factorId={factorId} next={next} autoFocus />;
  }

  if (enrol.stage === "enrolled") {
    return (
      <div className="grid gap-8">
        <section aria-labelledby="mfa-scan" className="grid gap-4">
          <h2 id="mfa-scan" className="hq-label">
            1. Scan this with your authenticator
          </h2>
          {/* The QR is an SVG from Supabase Auth for this one enrolment, held in a data URL so it is never fetched. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSource(enrol.qr)}
            alt="QR code for your authenticator app"
            width={192}
            height={192}
            className="border border-line bg-white p-2"
          />
          <div>
            <label htmlFor="mfa-secret" className="hq-field__label">
              Cannot scan? Type this key in instead
            </label>
            <input id="mfa-secret" readOnly value={enrol.secret} className="hq-input mt-1.5 hq-nums" onFocus={(e) => e.currentTarget.select()} />
          </div>
        </section>
        <section aria-labelledby="mfa-enter" className="grid gap-4">
          <h2 id="mfa-enter" className="hq-label">
            2. Then enter the six digits it shows
          </h2>
          <VerifyTotpForm factorId={enrol.factorId} next={next} />
        </section>
      </div>
    );
  }

  return (
    <form action={enrolAction} className="grid gap-5">
      {enrol.error ? (
        <p role="alert" className="hq-field__error">
          {enrol.error}
        </p>
      ) : null}
      {mode === "manage" ? (
        <p className="text-[15px]">
          Your authenticator app is set up. To move to a new phone or app, set up a new one here. The old one stops working once the new one is confirmed.
        </p>
      ) : (
        <p className="text-[15px]">
          {mfaRequired
            ? "Planted HQ holds personal information, so it asks for a code from your phone each time you sign in. It takes a minute to set up."
            : "Two-step verification is not required at the moment, but you can set it up now so you are ready if it is switched on."}
        </p>
      )}
      <Button type="submit" variant="primary" block loading={enrolling} pendingLabel="Setting up">
        {mode === "manage" ? "Set up a new authenticator" : "Set up my authenticator"}
      </Button>
      {!mfaRequired || mode === "manage" ? (
        <Link href={next === "/hq" ? "/hq/profile" : next} className="hq-muted text-center text-[14px] underline underline-offset-2">
          Back
        </Link>
      ) : null}
    </form>
  );
}

function VerifyTotpForm({ factorId, next, autoFocus }: { factorId: string; next: string; autoFocus?: boolean }) {
  const [state, action] = useActionState(verifyTotp, idle);
  return (
    <form action={action} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ code: "Code" }} />
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
      <TextInput
        name="code"
        label="Six-digit code"
        required
        autoComplete="one-time-code"
        inputMode="numeric"
        maxLength={6}
        autoFocus={autoFocus}
        error={fieldError(state, "code")}
        className="[&_input]:text-center [&_input]:text-[24px] [&_input]:tracking-[0.5em] [&_input]:tabular-nums"
      />
      <SubmitButton block pendingLabel="Checking your code">
        Continue
      </SubmitButton>
    </form>
  );
}
