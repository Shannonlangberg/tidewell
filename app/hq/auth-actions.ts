"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { createCookieClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { HQ_OTP_EMAIL_COOKIE, HQ_OTP_EMAIL_TTL_S } from "@/lib/hq/cookies";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { listTotpFactors } from "@/lib/hq/mfa";
import { safeNextPath } from "@/lib/hq/next-path";

/*
 * Sign-in Server Actions for Planted HQ: send a code, check it, and the authenticator-app
 * (TOTP) second step. They are reachable by direct POST, so each checks what it needs
 * for itself and trusts nothing the browser says about who is calling.
 *
 *  - sendCode and verifyCode run before anyone is signed in. They give the same answer for
 *    a known and an unknown address, never log an address or a code, and set cookies
 *    through the cookie-writing Supabase client (verifyOtp rotates the session cookies).
 *  - enrolTotp and verifyTotp need a signed-in member of STAFF who may still owe a second
 *    step, so they call requireStaff(undefined, true).
 *
 * Errors shown to people are generic. Details go to the server log without personal data.
 */

function secure() {
  return process.env.NODE_ENV === "production";
}

/** What the person typed, handed back so React 19's form reset does not wipe it after a failure. */
function keepValues(formData: FormData, names: string[]): Record<string, unknown> {
  const values: Record<string, string> = {};
  for (const n of names) {
    const v = formData.get(n);
    if (typeof v === "string") values[n] = v.slice(0, 254);
  }
  return { values };
}

// ── sign in: email → code ────────────────────────────────────

export async function sendCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const f = new FormReader(formData);
  const email = f.email("email", { required: true });
  if (!f.ok || !email) {
    return { ...f.fail("Enter the email address you use for Planted HQ."), data: keepValues(formData, ["email"]) };
  }
  const next = safeNextPath(formData.get("next"));
  const captcha = formData.get("cf-turnstile-response");

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Sign-ups are off. A code is only ever sent to an address that already has a login.
      shouldCreateUser: false,
      ...(typeof captcha === "string" && captcha ? { captchaToken: captcha } : {}),
    },
  });

  if (error) {
    // "email_address_not_authorized" is Supabase's built-in sender refusing an address outside the project's
    // team. Until a custom email sender is connected (docs/hq-setup.md) a director issues codes by hand
    // (npm run hq:code), so the person still goes on to the code screen. Same outcome as any other address.
    const unknownAddress =
      error.status === 422 || error.code === "otp_disabled" || error.code === "email_address_not_authorized" || /signups? not allowed/i.test(error.message);
    if (error.status === 429) {
      return { ...fail("Codes go out once a minute. Wait a minute, then try again."), data: keepValues(formData, ["email"]) };
    }
    if (unknownAddress) {
      // Deliberately the same outcome as a known address: nothing to tell the visitor.
      console.info("[hq] a code was requested for an address that is not set up");
    } else if (/captcha/i.test(error.message)) {
      return { ...fail("The security check did not pass. Wait a moment for it to finish, then try again."), data: keepValues(formData, ["email"]) };
    } else {
      console.error("[hq] sendCode failed:", error.status, error.code);
      return { ...fail("Something went wrong on our side. Try again in a moment."), data: keepValues(formData, ["email"]) };
    }
  }

  // The address waits here for the next screen: HttpOnly, only sent under /hq, ten minutes,
  // and never put in a URL.
  (await cookies()).set(HQ_OTP_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: HQ_BASE,
    maxAge: HQ_OTP_EMAIL_TTL_S,
  });
  redirect(next === HQ_BASE ? `${HQ_BASE}/verify` : `${HQ_BASE}/verify?next=${encodeURIComponent(next)}`);
}

// ── sign in: code → session ──────────────────────────────────

export async function verifyCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const store = await cookies();
  const email = store.get(HQ_OTP_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${HQ_BASE}/sign-in`);

  const token = String(formData.get("token") ?? "").replace(/\D/g, "");
  if (token.length !== 6) {
    return fail("Check the code and try again.", { token: "Enter the six digits from the email." });
  }

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    if (error.status === 429) return fail("Too many tries. Wait a minute, then ask for a new code.");
    return fail("That code did not work. Check the digits, or ask for a new one.");
  }

  store.set(HQ_OTP_EMAIL_COOKIE, "", { path: HQ_BASE, maxAge: 0 });
  // Into the app. The signed-in layout and requireStaff() decide what happens next: a second
  // step, "no access", or the dashboard.
  redirect(safeNextPath(formData.get("next")));
}

/**
 * Ends the CALLER's own session on this device, without redirecting. The sign-in screen uses it
 * for a person who signed in but is not a member of staff, so they are never left holding a
 * session for an app they cannot use. It needs no authorisation: all it can do is sign out
 * whoever is calling.
 */
export async function endSessionAction(): Promise<void> {
  const supabase = await createCookieClient();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("[hq] endSession failed:", e instanceof Error ? e.message : "error");
  }
  (await cookies()).set(HQ_OTP_EMAIL_COOKIE, "", { path: HQ_BASE, maxAge: 0 });
}

// ── second step: authenticator app (TOTP) ────────────────────

export type EnrolState =
  | { stage: "idle"; error: string | null }
  | { stage: "enrolled"; factorId: string; qr: string; secret: string; error: null };

/**
 * Starts (or restarts) setting up an authenticator app: creates a TOTP factor and hands back the
 * QR code and the secret to type in. A half-finished earlier attempt is dropped first.
 *
 * A person who already has a verified authenticator and has NOT yet completed it this session
 * (aal1) is refused: otherwise an emailed code alone could add a second factor and skip the
 * first. They confirm with the existing one, then replace it.
 */
export async function enrolTotp(): Promise<EnrolState> {
  const { staff, session } = await requireStaff(undefined, true);

  const existing = await listTotpFactors(session.accessToken);
  if (existing.some((f) => f.status === "verified") && staff.aal !== "aal2") {
    return { stage: "idle", error: "Confirm with your current authenticator first, then you can replace it." };
  }

  const supabase = await createCookieClient();
  for (const f of existing) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const label = session.claims.email ?? "Planted HQ";
  const haveVerified = existing.some((f) => f.status === "verified");
  const friendlyName = haveVerified ? `${label} (${Math.random().toString(36).slice(2, 6)})` : label;

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Planted HQ", friendlyName });
  if (error || !data) {
    console.error("[hq] mfa.enroll failed:", error?.status, error?.code);
    return { stage: "idle", error: "We could not start the setup. Try again in a moment." };
  }
  return { stage: "enrolled", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, error: null };
}

/**
 * Checks the six digits from the authenticator app. For a new factor it completes setup (and,
 * when the person is REPLACING an authenticator, removes the old one only now that the new one
 * has proved it works). For an existing factor it is the sign-in step. Either way a success
 * rotates the cookies to an aal2 session.
 */
export async function verifyTotp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { staff, session } = await requireStaff(undefined, true);
  const next = safeNextPath(formData.get("next"));

  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!isUuid(factorId)) return fail("Start the setup again.");
  if (code.length !== 6) return fail("Check the code and try again.", { code: "Enter the six digits from your authenticator app." });

  // The factor must be one of THIS person's own, whatever the form said.
  const factors = await listTotpFactors(session.accessToken);
  const target = factors.find((f) => f.id === factorId);
  if (!target) return fail("Start the setup again.");
  const replacing = target.status === "unverified" && factors.some((f) => f.status === "verified");
  if (replacing && staff.aal !== "aal2") {
    return fail("Confirm with your current authenticator first, then you can replace it.");
  }

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (error.status === 429) return fail("Too many tries. Wait a minute, then try again.");
    return fail("That code did not match. Codes change every 30 seconds, so try the current one.");
  }

  if (replacing) {
    for (const f of factors) {
      if (f.status === "verified" && f.id !== factorId) {
        const { error: removeError } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (removeError) console.error("[hq] could not remove the old authenticator:", removeError.status, removeError.code);
      }
    }
    redirect(withToast(`${HQ_BASE}/profile`, "Your authenticator has been replaced."));
  }
  redirect(target.status === "unverified" ? withToast(next, "Your authenticator is set up.") : next);
}
