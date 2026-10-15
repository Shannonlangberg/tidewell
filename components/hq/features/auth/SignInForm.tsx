"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { sendCode } from "@/app/hq/auth-actions";
import { fieldError } from "@/components/hq/Field";
import { FormSummary } from "@/components/hq/FormSummary";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TextInput } from "@/components/hq/TextInput";
import { idle, type ActionState } from "@/lib/hq/forms";

/*
 * Email in, six-digit code out. Posts to the sendCode Server Action; with JavaScript off
 * the form still submits (the Turnstile check, which needs JavaScript, is the one thing
 * that then cannot pass where it is switched on).
 *
 * Turnstile: the widget hands its token to this component, which posts it as the
 * `cf-turnstile-response` field. A token works once, so after every answer from the server
 * the widget is reset and asked for a fresh one, and the button waits for it.
 */

export function SignInForm({ turnstileSiteKey, next }: { turnstileSiteKey: string | null; next: string }) {
  const widget = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState("");

  const [state, action] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await sendCode(prev, formData);
    // Reaching here means it did not redirect, so the token has been spent.
    widget.current?.reset();
    setToken("");
    return result;
  }, idle);

  const values = (state.data?.values ?? {}) as Record<string, string>;
  const waitingForCheck = Boolean(turnstileSiteKey) && !token;

  // A page's Content-Security-Policy belongs to the DOCUMENT that was loaded, and only /hq/sign-in's allows the
  // Turnstile script. Arriving here by a client-side navigation (signing out inside HQ, or a session that ended
  // mid-visit) keeps the previous page's policy, so the widget would be blocked and the button would wait for
  // ever. A full load fixes it, so do one.
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && new URL(nav.name).pathname !== window.location.pathname) window.location.reload();
  }, [turnstileSiteKey]);

  // If the check has not finished after a while, say what to do rather than leave the button waiting silently.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!turnstileSiteKey || token) return;
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [turnstileSiteKey, token]);

  return (
    <form action={action} noValidate className="grid gap-5">
      <FormSummary state={state} labels={{ email: "Email address" }} />
      <input type="hidden" name="next" value={next} />
      {turnstileSiteKey ? <input type="hidden" name="cf-turnstile-response" value={token} /> : null}

      <TextInput
        name="email"
        type="email"
        label="Email address"
        required
        autoComplete="email"
        autoFocus
        maxLength={254}
        defaultValue={values.email ?? ""}
        error={fieldError(state, "email")}
      />

      {turnstileSiteKey ? (
        <Turnstile
          ref={widget}
          siteKey={turnstileSiteKey}
          options={{ size: "flexible", theme: "light", responseField: false }}
          onSuccess={setToken}
          onExpire={() => setToken("")}
          onError={() => setToken("")}
        />
      ) : null}

      <div className="grid gap-2">
        <SubmitButton block disabled={waitingForCheck} pendingLabel="Sending your code">
          Email me a code
        </SubmitButton>
        {waitingForCheck ? (
          <p className="hq-muted text-[13px]" role="status">
            Waiting for the security check to finish.
            {slow ? (
              <>
                {" "}
                Taking a while?{" "}
                <a href={`/hq/sign-in${next === "/hq" ? "" : `?next=${encodeURIComponent(next)}`}`} className="underline underline-offset-2">
                  Reload this page
                </a>
                .
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <p className="hq-muted text-[13px] leading-relaxed">
        We use your address only to send you a sign-in code and to run your account. Planted HQ is for Planted staff.
      </p>
    </form>
  );
}
