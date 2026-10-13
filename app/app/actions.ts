"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCookieClient } from "@/lib/supabase/server";
import { currentRoles, readSession } from "@/lib/auth";
import { OTP_EMAIL_COOKIE, ROLE_COOKIE, ROLE_HOME, isAppRole } from "@/lib/roles";

/*
 * Auth Server Actions. These are reachable by direct POST, so each one checks
 * what it needs itself. They use the cookie-writing client: verifyOtp, a TOTP
 * verification and signOut all rotate cookies, which only a Server Action or a
 * route handler can write.
 */

const OTP_EMAIL_TTL_S = 10 * 60;

export type FormState = { error: string | null };

function secure() {
  return process.env.NODE_ENV === "production";
}

// ---------- sign in ----------

export async function sendCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That doesn't look like an email address." };
  }
  const captchaToken = formData.get("cf-turnstile-response");

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      ...(typeof captchaToken === "string" && captchaToken ? { captchaToken } : {}),
    },
  });

  if (error) {
    if (error.status === 429) return { error: "Codes go out once a minute. Wait a minute, then try again." };
    if (error.status === 422 || /signups? not allowed/i.test(error.message)) {
      // Unknown address. Same answer as a known one; the events RPC (auth.unknown_email) lands with a later phase.
      console.info("[auth] code requested for an address that is not set up");
    } else if (/captcha/i.test(error.message)) {
      return { error: "The security check didn't pass. Reload the page and try again." };
    } else {
      console.error("[auth] signInWithOtp failed:", error.status, error.message);
      return { error: "Something went wrong on our side. Try again in a moment." };
    }
  }

  (await cookies()).set(OTP_EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: "/app",
    maxAge: OTP_EMAIL_TTL_S,
  });
  redirect("/app/verify");
}

export async function verifyCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const store = await cookies();
  const email = store.get(OTP_EMAIL_COOKIE)?.value;
  if (!email) redirect("/app");

  const token = String(formData.get("token") ?? "").replace(/\D/g, "");
  if (token.length !== 6) return { error: "The code is six digits." };

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    if (error.status === 429) return { error: "Too many tries. Wait a minute, then ask for a new code." };
    return { error: "That code didn't work. Check the digits, or ask for a new one." };
  }

  store.set(OTP_EMAIL_COOKIE, "", { path: "/app", maxAge: 0 });
  redirect("/app/route");
}

// ---------- role choice ----------

export async function chooseRole(formData: FormData): Promise<void> {
  const role = formData.get("role");
  if (!isAppRole(role)) redirect("/app/route");
  const roles = await currentRoles();
  if (!roles.includes(role)) redirect("/app/route");
  (await cookies()).set(ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: secure(),
    path: "/app",
    maxAge: 400 * 24 * 60 * 60,
  });
  redirect(ROLE_HOME[role]);
}

// ---------- sign out ----------

export async function signOut(): Promise<void> {
  const supabase = await createCookieClient();
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("[auth] signOut failed:", e instanceof Error ? e.message : e);
  }
  const store = await cookies();
  store.set(ROLE_COOKIE, "", { path: "/app", maxAge: 0 });
  store.set(OTP_EMAIL_COOKIE, "", { path: "/app", maxAge: 0 });
  redirect("/app");
}

// ---------- manager TOTP ----------

export type EnrolState =
  | { stage: "idle"; error: string | null }
  | { stage: "enrolled"; factorId: string; qr: string; secret: string; error: string | null };

/** First manager sign-in: create a TOTP factor and hand back the QR code to scan. */
export async function enrolTotp(): Promise<EnrolState> {
  await readSession("/app/mfa");
  const supabase = await createCookieClient();

  // Drop any half-finished enrolment so the person always scans a fresh code.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Tidewell", friendlyName: "Tidewell" });
  if (error || !data) {
    console.error("[auth] mfa.enroll failed:", error?.message);
    return { stage: "idle", error: "Couldn't start the setup. Try again in a moment." };
  }
  return { stage: "enrolled", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, error: null };
}

/** Challenge and verify the six digits from the authenticator; a success rotates the cookies to an aal2 session. */
export async function verifyTotp(_prev: FormState, formData: FormData): Promise<FormState> {
  await readSession("/app/mfa");
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (!factorId) return { error: "Start the setup again." };
  if (code.length !== 6) return { error: "The code is six digits." };

  const supabase = await createCookieClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    if (error.status === 429) return { error: "Too many tries. Wait a minute." };
    return { error: "That code didn't match. Codes change every 30 seconds; try the current one." };
  }
  redirect("/app/route");
}
