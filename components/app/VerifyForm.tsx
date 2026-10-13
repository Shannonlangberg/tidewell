"use client";

import Link from "next/link";
import { useActionState } from "react";
import { verifyCode, type FormState } from "@/app/app/actions";

const INITIAL: FormState = { error: null };

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyCode, INITIAL);

  return (
    <form action={action} className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }}>
      <label className="o-label" htmlFor="token">The six digits</label>
      <input
        id="token"
        name="token"
        className="o-textarea"
        style={{ minHeight: 0, fontFamily: "var(--font-mono)", letterSpacing: "0.3em", fontSize: 24 }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
      />
      <button type="submit" className="o-btn o-btn-green" disabled={pending} style={pending ? { opacity: 0.6 } : undefined}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      {state.error && <p role="alert" className="o-small" style={{ color: "var(--o-copper)" }}>{state.error}</p>}
      <p className="o-small">
        Didn&rsquo;t get it? Check your junk folder, or <Link href="/app" className="o-link">ask for a new code</Link>.
      </p>
    </form>
  );
}
