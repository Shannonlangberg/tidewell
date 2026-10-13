import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OTP_EMAIL_COOKIE } from "@/lib/roles";
import { VerifyForm } from "@/components/app/VerifyForm";

export const metadata: Metadata = { title: "Your code · Tidewell" };

function mask(email: string) {
  const at = email.indexOf("@");
  if (at <= 1) return email;
  return `${email[0]}${"*".repeat(Math.min(at - 1, 6))}${email.slice(at)}`;
}

export default async function Verify() {
  const email = (await cookies()).get(OTP_EMAIL_COOKIE)?.value;
  if (!email) redirect("/app");

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
          <h1 className="o-title">check your email</h1>
          <p className="o-status">If {mask(email)} is set up with us, a six-digit code is on its way. It lasts ten minutes.</p>
        </div>
        <VerifyForm />
      </main>
    </>
  );
}
