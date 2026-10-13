import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentRoles, readSession } from "@/lib/auth";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { MfaPanel } from "@/components/app/MfaPanel";
import { SignOutButton } from "@/components/app/SignOutButton";

export const metadata: Metadata = { title: "Second step · Tidewell" };

type Factor = { id: string; factor_type: string; status: "verified" | "unverified" };

/**
 * The manager's factors, read straight from the Auth API with the verified
 * access token. A plain read: no session store, so nothing can refresh here.
 */
async function verifiedTotpFactor(accessToken: string): Promise<Factor | null> {
  try {
    const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey(), Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { factors?: Factor[] };
    return user.factors?.find((f) => f.factor_type === "totp" && f.status === "verified") ?? null;
  } catch {
    return null;
  }
}

/**
 * Managers carry a second factor from phase 0. Nothing manager-only renders
 * until the session is aal2; this page is the only thing a manager sees before.
 */
export default async function Mfa() {
  const session = await readSession("/app/mfa");
  const roles = await currentRoles();
  if (!roles.includes("manager")) redirect("/app/route");
  if (session.claims.aal === "aal2") redirect("/app/route");

  const factor = await verifiedTotpFactor(session.accessToken);

  return (
    <>
      <header className="o-header" style={{ justifyContent: "flex-start" }}>
        <div className="o-header-title">
          <span aria-hidden className="o-tag-mark" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, letterSpacing: "-.055em", lineHeight: 0.9 }}>tidewell</span>
        </div>
      </header>
      <main className="o-main">
        <div>
          <h1 className="o-title">{factor ? "one more step" : "set up your second step"}</h1>
          <p className="o-status">
            {factor
              ? "Managers confirm each sign-in with their authenticator app."
              : "Managers see every home, so a code from your phone's authenticator is needed each time you sign in. Takes a minute to set up."}
          </p>
        </div>
        {factor ? <MfaPanel mode="challenge" factorId={factor.id} /> : <MfaPanel mode="enrol" factorId={null} />}
        <section className="o-sep">
          <SignOutButton />
        </section>
      </main>
    </>
  );
}
