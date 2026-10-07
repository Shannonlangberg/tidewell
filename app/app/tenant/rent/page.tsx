"use client";

import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { TENANCY, dayFrom, money } from "@/lib/demo";

const d = (n: number) => dayFrom(n).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });

export default function Rent() {
  const { ready } = useAppState();
  if (!ready) return <Header />;
  const ahead = TENANCY.paidTo;

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">rent</h1>
          <p className="o-status">
            {ahead >= 0 ? <>You&rsquo;re paid up to {d(ahead)}. <span className="o-good">Nothing owing.</span></> : <strong>You&rsquo;re {-ahead} days behind.</strong>}
          </p>
        </div>

        <div className="o-table">
          <div><span style={{ color: "var(--o-body)" }}>Rent</span><span style={{ fontWeight: 500 }}>{money(TENANCY.weeklyRent)} a week</span></div>
          <div><span style={{ color: "var(--o-body)" }}>Next payment</span><span style={{ fontWeight: 500 }}>{money(TENANCY.weeklyRent * 2)} by {d(ahead)}</span></div>
          <div><span style={{ color: "var(--o-body)" }}>Bond</span><span style={{ fontWeight: 500 }}>{money(TENANCY.bond)}</span></div>
        </div>
        <p className="o-small">Your bond is held by Consumer and Business Services, not by us. It comes back to you at the end of the lease, less anything we agree on together.</p>

        <section className="o-boxed" style={{ padding: 16, background: "var(--o-raised)", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="o-label">How to pay</span>
          <p className="o-p">Bank transfer or PayID, with your reference.</p>
          <p style={{ font: "500 15px var(--font-mono), monospace", color: "var(--o-head)" }}>Reference: HERITAGE-27</p>
          <p className="o-small">Account details are in your lease. We never change them by email — if a message says we have, ring us.</p>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Received</p>
          <div className="o-list">
            {TENANCY.history.map((h) => (
              <div key={h.daysAgo} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between" }}>
                <span className="o-p">{d(-h.daysAgo)}</span>
                <span style={{ fontWeight: 500, fontSize: 17 }}>{money(h.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
