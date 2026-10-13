"use client";

import { useActionState } from "react";
import { enrolTotp, verifyTotp, type EnrolState, type FormState } from "@/app/app/actions";

const INITIAL_ENROL: EnrolState = { stage: "idle", error: null };
const INITIAL_VERIFY: FormState = { error: null };

/**
 * Manager second factor. First sign-in: enrol a TOTP factor, show the QR code
 * (and the secret for typing in), then verify six digits. Later sign-ins:
 * challenge-and-verify against the factor already on file. A success rotates
 * the cookies to an aal2 session and the route page lets the manager in.
 */
export function MfaPanel({ mode, factorId }: { mode: "enrol"; factorId: null } | { mode: "challenge"; factorId: string }) {
  const [enrol, enrolAction, enrolling] = useActionState(enrolTotp, INITIAL_ENROL);

  if (mode === "enrol" && enrol.stage === "idle") {
    return (
      <form action={enrolAction} className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }}>
        <p className="o-small">
          Managers sign in with a second step: a six-digit code from an authenticator app (Google Authenticator, 1Password, Authy or the one built into your phone).
        </p>
        <button type="submit" className="o-btn o-btn-green" disabled={enrolling} style={enrolling ? { opacity: 0.6 } : undefined}>
          {enrolling ? "Setting up…" : "Set up my authenticator"}
        </button>
        {enrol.error && <p role="alert" className="o-small" style={{ color: "var(--o-copper)" }}>{enrol.error}</p>}
      </form>
    );
  }

  const id = mode === "challenge" ? factorId : enrol.stage === "enrolled" ? enrol.factorId : "";
  return (
    <>
      {mode === "enrol" && enrol.stage === "enrolled" && (
        <section className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="o-label">Scan this with your authenticator</p>
          {/* The QR is an SVG from Supabase Auth for this one enrolment; a data URL keeps it off the wire as markup. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;utf-8,${encodeURIComponent(enrol.qr)}`} alt="QR code for your authenticator app" width={200} height={200} style={{ background: "#fff", padding: 8, alignSelf: "center" }} />
          <label className="o-small" htmlFor="secret">Can&rsquo;t scan? Type this key in instead.</label>
          <input id="secret" type="password" readOnly value={enrol.secret} className="o-textarea" style={{ minHeight: 0, fontFamily: "var(--font-mono)" }} onFocus={(e) => e.currentTarget.select()} />
        </section>
      )}
      <VerifyTotpForm factorId={id} mode={mode} />
    </>
  );
}

function VerifyTotpForm({ factorId, mode }: { factorId: string; mode: "enrol" | "challenge" }) {
  const [state, action, pending] = useActionState(verifyTotp, INITIAL_VERIFY);
  return (
    <form action={action} className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="factorId" value={factorId} />
      <label className="o-label" htmlFor="code">{mode === "enrol" ? "Then enter the six digits it shows" : "The six digits from your authenticator"}</label>
      <input
        id="code"
        name="code"
        className="o-textarea"
        style={{ minHeight: 0, fontFamily: "var(--font-mono)", letterSpacing: "0.3em", fontSize: 24 }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
      />
      <button type="submit" className="o-btn o-btn-green" disabled={pending} style={pending ? { opacity: 0.6 } : undefined}>
        {pending ? "Checking…" : "Continue"}
      </button>
      {state.error && <p role="alert" className="o-small" style={{ color: "var(--o-copper)" }}>{state.error}</p>}
    </form>
  );
}
