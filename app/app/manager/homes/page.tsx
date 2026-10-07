"use client";

import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { PRICING_WEEKS, PROPERTIES, STAYS, dayFrom, money, nextNights } from "@/lib/demo";

// Occupancy for the other homes is sample data; Bayview uses the real demo bookings.
const SAMPLE_BOOKED: Record<string, number> = { simms: 11, esplanade: 6 };

export default function Homes() {
  const { state, ready, update } = useAppState();
  if (!ready) return <Header />;

  const bayviewBooked = nextNights(STAYS).filter((n) => n.state === "booked").length;
  const pending = PRICING_WEEKS.filter((w) => w.suggest !== w.current && !state.priced.includes(w.week));

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">homes</h1>
          <p className="o-status">Four on the books — three short-stay, one long-term.</p>
        </div>

        <div className="o-list">
          {PROPERTIES.map((p) => {
            const booked = p.id === "bayview" ? bayviewBooked : SAMPLE_BOOKED[p.id];
            return (
              <div key={p.id} style={{ padding: "15px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600, fontSize: 19 }}>{p.name}</span>
                  <span className="o-chip">{p.kind}</span>
                </div>
                <p className="o-small" style={{ marginTop: 3, color: "var(--o-body)" }}>{p.town} · {p.ownerName}</p>
                <p className="o-small" style={{ marginTop: 3 }}>{p.kind === "long-term" ? "Tenanted · rent up to date" : `${booked} of the next 14 nights booked`}</p>
              </div>
            );
          })}
        </div>

        <section className="o-sep">
          <div className="o-row-head">
            <span className="o-label">Pricing pass · 12 Bayview Road</span>
            <span className="o-small" style={{ color: pending.length ? "var(--o-copper-text)" : "var(--o-shallow)" }}>{pending.length ? `${pending.length} to review` : "Done ✓"}</span>
          </div>
          <p className="o-small" style={{ marginBottom: 12 }}>The next eight weeks, a nightly rate each. Nothing changes on the platforms until you accept it.</p>
          <div className="o-list">
            {PRICING_WEEKS.map((w) => {
              const change = w.suggest !== w.current;
              const accepted = state.priced.includes(w.week);
              const start = dayFrom(w.week * 7);
              return (
                <div key={w.week} style={{ padding: "12px 0", display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ font: "400 13px var(--font-mono), monospace", color: "var(--o-muted)", width: 58, flex: "none" }}>{start.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500, fontSize: 17 }}>
                      {change && !accepted ? <><s style={{ color: "var(--o-muted)", fontWeight: 400 }}>{money(w.current, false)}</s> → {money(w.suggest, false)}</> : money(accepted ? w.suggest : w.current, false)}
                    </span>
                    <span className="o-small">{w.why}</span>
                  </span>
                  {change && !accepted && (
                    <button className="o-btn o-btn-outline o-btn-sm" style={{ fontSize: 15, padding: "9px 14px" }} onClick={() => update((s) => ({ ...s, priced: [...s.priced, w.week] }))}>Accept</button>
                  )}
                  {accepted && <span className="o-small o-good">✓</span>}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
}
