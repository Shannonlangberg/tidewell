"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";
import { sendCode, type FormState } from "@/app/app/actions";

const INITIAL: FormState = { error: null };

/**
 * Email in, six-digit code out. Posts to the `sendCode` Server Action; with
 * JavaScript off the form still submits and the action still redirects.
 * The Turnstile widget adds a hidden `cf-turnstile-response` field that the
 * action passes to Supabase, which verifies it when its captcha setting is on.
 */
export function SignInForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, action, pending] = useActionState(sendCode, INITIAL);

  return (
    <form action={action} className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="o-label" htmlFor="email">Your email</label>
      <input
        id="email"
        name="email"
        type="email"
        className="o-textarea"
        style={{ minHeight: 0 }}
        placeholder="you@example.com"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
      />
      {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} options={{ size: "flexible", theme: "auto" }} />}
      <button type="submit" className="o-btn o-btn-green" disabled={pending} style={pending ? { opacity: 0.6 } : undefined}>
        {pending ? "Sending…" : "Email me a code"}
      </button>
      {state.error && <p role="alert" className="o-small" style={{ color: "var(--o-copper)" }}>{state.error}</p>}
      <p className="o-small">
        We use your email address to send you a sign-in code and to run your account. See our <Link href="/privacy" className="o-link">privacy page</Link>.
      </p>
    </form>
  );
}
