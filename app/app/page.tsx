import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { SignInForm } from "@/components/app/SignInForm";

export const metadata: Metadata = { title: "Sign in · Tidewell" };

/**
 * One app, one login. The email form posts to the `sendCode` action; the code
 * is checked on /app/verify; /app/route then reads the session and sends each
 * person to their role. Someone already signed in skips straight to the router.
 */
export default async function SignIn() {
  if (await currentSession()) redirect("/app/route");
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;

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
          <h1 className="o-title">sign in</h1>
          <p className="o-status">One app for everyone who looks after a place with us. What you see depends on who you are.</p>
        </div>

        <SignInForm turnstileSiteKey={turnstileSiteKey} />

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 8 }}>Staying with us?</p>
          <p className="o-small">Guests don&rsquo;t need an account. Your booking comes with a link to your stay.</p>
          <Link href="/stay/demo" className="o-link" style={{ display: "inline-block", marginTop: 10, fontSize: 15 }}>See a guest&rsquo;s link</Link>
        </section>
      </main>
    </>
  );
}
