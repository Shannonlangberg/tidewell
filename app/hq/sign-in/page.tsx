import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/hq/features/auth/AuthFrame";
import { INACTIVE_BODY, INACTIVE_TITLE, NO_ACCESS_BODY, NO_ACCESS_TITLE } from "@/components/hq/features/auth/copy";
import { NoAccessNotice } from "@/components/hq/features/auth/NoAccessNotice";
import { SignInForm } from "@/components/hq/features/auth/SignInForm";
import { currentSession } from "@/lib/auth";
import { currentStaffOrNull } from "@/lib/hq/auth";
import { safeNextPath } from "@/lib/hq/next-path";

export const metadata: Metadata = { title: "Sign in" };

// Reads the session cookie, so it can never be prerendered.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * The front door. Three things can be true of the visitor:
 *  - signed in AND staff: straight into HQ (the app layout sends them on to a second step if one is owed);
 *  - signed in but NOT staff: told plainly that this login has no access, and signed out on this
 *    device. Never an empty app;
 *  - not signed in: the email form. `?error=no-access|inactive` explains why they were sent back.
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const next = safeNextPath(one(sp.next));
  const error = one(sp.error);

  const session = await currentSession();
  const staff = await currentStaffOrNull(session);
  if (staff) redirect(next);

  const holdsNonStaffSession = session !== null;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;

  let notice: { title: string; body: string } | null = null;
  if (error === "inactive") notice = { title: INACTIVE_TITLE, body: INACTIVE_BODY };
  else if (error === "no-access" || holdsNonStaffSession) notice = { title: NO_ACCESS_TITLE, body: NO_ACCESS_BODY };

  return (
    <AuthFrame
      title="Sign in"
      lead="Enter your work email and we will send you a six-digit code. There are no passwords."
      footer="Planted HQ is the private staff portal for Planted Property Management."
    >
      {notice ? (
        <NoAccessNotice title={notice.title} endSession={holdsNonStaffSession}>
          {notice.body}
        </NoAccessNotice>
      ) : null}
      <SignInForm turnstileSiteKey={turnstileSiteKey} next={next} />
    </AuthFrame>
  );
}
