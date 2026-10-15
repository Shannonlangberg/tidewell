import type { Metadata } from "next";
import { AuthFrame } from "@/components/hq/features/auth/AuthFrame";
import { MfaPanel, type MfaMode } from "@/components/hq/features/auth/MfaPanel";
import { signOutAction } from "../actions";
import { requireStaff } from "@/lib/hq/auth";
import { listTotpFactors } from "@/lib/hq/mfa";
import { safeNextPath } from "@/lib/hq/next-path";

export const metadata: Metadata = { title: "Second step" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * The second step. A signed-in member of staff whose session has not completed it (aal1) while
 * the organisation requires it lands here from requireStaff(), and sees nothing else of HQ
 * until they pass. The same page lets someone who is already through replace their authenticator.
 *
 * requireStaff(undefined, true) lets a person who still owes the step in, with NO capabilities:
 * they can reach this screen and nothing else.
 */
export default async function MfaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, session } = await requireStaff(undefined, true, "/hq/mfa");
  const sp = await searchParams;
  const next = safeNextPath(one(sp.next));

  const factors = await listTotpFactors(session.accessToken);
  const verified = factors.find((f) => f.status === "verified") ?? null;
  const mode: MfaMode = verified ? (staff.aal === "aal2" ? "manage" : "challenge") : "enrol";

  const title = mode === "challenge" ? "One more step" : mode === "enrol" ? "Set up your second step" : "Your second step";
  const lead =
    mode === "challenge"
      ? "Open your authenticator app and enter the current code."
      : mode === "enrol"
        ? "A code from an authenticator app on your phone, as well as the emailed code, keeps staff and partner details safe."
        : undefined;

  return (
    <AuthFrame
      title={title}
      lead={lead}
      footer={
        mode === "challenge" ? (
          <>
            <p>Lost your phone? Ask a director to reset your second step. For now that is done in the Supabase dashboard.</p>
            <form action={signOutAction} className="mt-3">
              <button type="submit" className="underline underline-offset-2">
                Sign out
              </button>
            </form>
          </>
        ) : undefined
      }
    >
      <MfaPanel mode={mode} factorId={verified?.id ?? null} next={next} mfaRequired={staff.mfaRequired} />
    </AuthFrame>
  );
}
