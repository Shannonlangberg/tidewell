"use client";

import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { JOBS, PAY_HISTORY, PEOPLE, dayFrom, money, property } from "@/lib/demo";

export default function Pay() {
  const { state, ready } = useAppState();
  if (!ready) return <Header />;
  const me = PEOPLE.find((p) => p.id === state.person && p.role === "crew") ?? PEOPLE.find((p) => p.id === "kel")!;
  const done = JOBS.filter((j) => j.crew === me.id && j.type === "clean" && state.jobsDone.includes(j.id));
  const earned = done.reduce((a, j) => a + (j.type === "clean" ? j.pay : 0), 0);
  const payday = dayFrom((12 - new Date().getDay()) % 7 || 7);

  return (
    <>
      <Header title={me.name} />
      <main className="o-main">
        <div>
          <h1 className="o-title">this fortnight</h1>
          <p style={{ marginTop: 14, fontWeight: 600, fontSize: 44, letterSpacing: "-.03em", lineHeight: 1.1, color: "var(--o-head)" }}>{money(earned)}</p>
          <p className="o-p" style={{ marginTop: 6, color: "var(--o-muted)" }}>paid {payday.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}, straight to your account</p>
        </div>

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Done so far</p>
          {done.length ? (
            <div className="o-list">
              {done.map((j) => (
                <div key={j.id} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between" }}>
                  <span className="o-p">{property(j.property).name}</span>
                  <span style={{ fontWeight: 500, fontSize: 17 }}>{j.type === "clean" ? money(j.pay) : ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="o-small">Nothing finished yet this fortnight. Jobs land here the moment you tap Done.</p>
          )}
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Paid</p>
          <div className="o-list">
            {PAY_HISTORY.map((p) => (
              <div key={p.label} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className="o-p">{p.label}</span>
                <span style={{ fontWeight: 500, fontSize: 17 }}>{money(p.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
