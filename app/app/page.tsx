"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppState } from "@/components/app/useAppState";
import { PEOPLE, ROLE_LABEL } from "@/lib/demo";

export default function SignIn() {
  const router = useRouter();
  const { update } = useAppState();

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

        <form className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => e.preventDefault()}>
          <label className="o-label" htmlFor="email">Your email</label>
          <input id="email" type="email" className="o-textarea" style={{ minHeight: 0 }} placeholder="you@example.com" disabled />
          <button className="o-btn o-btn-green" disabled style={{ opacity: 0.5 }}>Email me a sign-in link</button>
          <p className="o-small">Not switched on yet. For now, pick someone below.</p>
        </form>

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Demo · sign in as</p>
          <div className="o-list">
            {PEOPLE.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  update((s) => ({ ...s, person: p.id }));
                  router.push(`/app/${p.role}`);
                }}
                style={{ padding: "15px 0", display: "flex", gap: 13, alignItems: "center", border: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}
              >
                <span className="o-avatar" style={{ flex: "none" }}>{p.initials}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 19 }}>{p.name}</span>
                  <span className="o-small" style={{ display: "block" }}>{p.blurb}</span>
                </span>
                <span className="o-chip">{ROLE_LABEL[p.role]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 8 }}>Staying with us?</p>
          <p className="o-small">Guests don&rsquo;t need an account. Your booking comes with a link to your stay.</p>
          <Link href="/stay/demo" className="o-link" style={{ display: "inline-block", marginTop: 10, fontSize: 15 }}>See a guest&rsquo;s link</Link>
        </section>
      </main>
    </>
  );
}
