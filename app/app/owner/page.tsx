"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { Nights } from "@/components/app/Nights";
import { ManagerCard } from "@/components/app/HumanTouchBits";
import { ownerProfile } from "@/lib/humanTouch";
import { useAppState } from "@/components/app/useAppState";
import { OWNER, QUIET_PLAN, REPAIRS, STAYS, cap, greeting, money, nextNights, repairTotal, words } from "@/lib/demo";

export default function OwnerHome() {
  const { state, ready, update } = useAppState();
  if (!ready) return <Header />;

  const stays = state.quiet ? [] : STAYS;
  const booked = nextNights(stays).filter((n) => n.state === "booked").length;
  const decisions = state.quiet ? [] : REPAIRS.filter((r) => r.status === "decision" && !state.approved.includes(r.id));
  const decision = decisions[0];

  // Every screen opens with a status sentence, not a generic greeting.
  const status = state.quiet
    ? "Nothing booked for the next fortnight. It's the quiet season — that's normal, and we're working on it."
    : `${cap(words(booked))} of the next fourteen nights ${booked === 1 ? "is" : "are"} booked.`;

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">{greeting()}, {OWNER.first}</h1>
          <p className="o-status">
            {status}{" "}
            {!state.quiet && (decision ? <strong>One thing needs you.</strong> : <span className="o-good">Nothing needs you.</span>)}
          </p>
        </div>

        {decision && (
          <section className="o-flood" aria-label="Needs a decision">
            <div className="o-row-head" style={{ margin: 0 }}>
              <span className="o-label">Needs a decision</span>
              <span style={{ fontSize: 15, color: "var(--o-flood-muted)" }}>{decision.reportedDaysAgo} days ago</span>
            </div>
            <Link href={`/app/owner/repairs/${decision.id}`} style={{ display: "flex", gap: 12, alignItems: "flex-start", color: "inherit" }}>
              <div className="o-ph" style={{ width: 74, height: 74, flex: "none", borderRadius: 4 }}>photo</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 19 }}>{decision.title}</div>
                <p style={{ marginTop: 5, fontSize: 15, lineHeight: 1.45, color: "var(--o-flood-body)" }}>{decision.summary}</p>
              </div>
            </Link>
            <div style={{ display: "flex", gap: 9 }}>
              <button
                className="o-btn o-btn-copper"
                style={{ fontSize: 17, padding: 15, flex: 1 }}
                onClick={() => update((s) => ({ ...s, approved: [...s.approved, decision.id] }))}
              >
                Approve {money(repairTotal(decision), false)}
              </button>
              <Link href={`/app/owner/repairs/${decision.id}#ask`} className="o-flood-btn-ghost">Ask</Link>
            </div>
          </section>
        )}

        <Nights stays={stays} />

        {state.quiet ? (
          <>
            <section className="o-boxed" style={{ background: "var(--o-raised)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="o-label">What we&rsquo;re doing about it</span>
              {QUIET_PLAN.map((p) => (
                <div key={p.text} style={{ display: "flex", gap: 11 }}>
                  <span className="o-dot" style={{ background: p.done ? "var(--o-shallow)" : "var(--o-sunken)" }} />
                  <span className="o-p" style={{ lineHeight: 1.45 }}>{p.text}</span>
                </div>
              ))}
            </section>
            <section className="o-sep">
              <p className="o-label" style={{ marginBottom: 10 }}>Same month last year</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 30, letterSpacing: "-.025em", color: "var(--o-head)" }}>6 nights</span>
                <span className="o-p" style={{ color: "var(--o-muted)" }}>let, by the end of the month</span>
              </div>
              <p className="o-small" style={{ marginTop: 14, color: "var(--o-body)" }}>
                Good time to use it yourself, if you want it. <Link href="/app/owner/bookings#block" className="o-link">Block some dates</Link>
              </p>
            </section>
          </>
        ) : (
          <section className="o-sep">
            <div className="o-row-head">
              <span className="o-label">Today at the house</span>
              <span className="o-good" style={{ fontWeight: 500, fontSize: 15 }}>✓ Clean, 10.40am</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
              {["bed 1", "bed 2", "bed 3", "bath", "kitchen", "living"].map((room) => (
                <div key={room} className="o-ph" style={{ aspectRatio: "1", borderRadius: 3, fontSize: 0 }} title={room} />
              ))}
            </div>
            <p className="o-small" style={{ marginTop: 10, color: "var(--o-body)" }}>&ldquo;All good. Left the fan on in the back room, it was humid.&rdquo; — Kel</p>
          </section>
        )}

        <ManagerCard pmId={ownerProfile("jane")?.pm ?? "court"} />
        <Link href="/app/owner/ask" className="o-link" style={{ alignSelf: "flex-start", fontSize: 15 }}>Ask about my place — quick answers, any time</Link>
      </main>
    </>
  );
}
