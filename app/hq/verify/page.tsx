import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/hq/features/auth/AuthFrame";
import { CODE_SENT_MESSAGE, maskEmail } from "@/components/hq/features/auth/copy";
import { VerifyForm } from "@/components/hq/features/auth/VerifyForm";
import { HQ_BASE } from "@/lib/hq/constants";
import { HQ_OTP_EMAIL_COOKIE } from "@/lib/hq/cookies";
import { safeNextPath } from "@/lib/hq/next-path";

export const metadata: Metadata = { title: "Your code" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * The address waits in an HttpOnly cookie set under /hq by the sign-in screen: it is never in
 * the URL. Without it (expired, or a direct visit) there is nothing to verify, so back to the start.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const email = (await cookies()).get(HQ_OTP_EMAIL_COOKIE)?.value;
  if (!email) redirect(`${HQ_BASE}/sign-in`);
  const next = safeNextPath(one(sp.next));

  return (
    <AuthFrame
      title="Check your email"
      lead={
        <>
          <p>{CODE_SENT_MESSAGE}</p>
          <p className="mt-2">
            You entered <span className="font-medium text-charcoal">{maskEmail(email)}</span>. The code lasts ten minutes.
          </p>
        </>
      }
    >
      <VerifyForm next={next} />
    </AuthFrame>
  );
}
