"use client";

import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { MONTH_LINES, YEAR, money } from "@/lib/demo";

const MONTHS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export default function Money() {
  const { ready } = useAppState();
  if (!ready) return <Header />;
  const now = new Date();
  const fyStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const idx = (now.getMonth() + 6) % 12; // Jul = 0
  const total = MONTH_LINES.reduce((a, l) => a + l.amount, 0);
  const year = YEAR.map((v, i) => (i === idx ? total : v));
  const max = Math.max(...year);
  const monthName = now.toLocaleDateString("en-AU", { month: "long" });

  return (
    <>
      <Header side={<span className="o-header-side">{fyStart}–{String(fyStart + 1).slice(2)}</span>} />
      <main className="o-main">
        <div>
          <h1 className="o-title">this month</h1>
          <p style={{ marginTop: 14, fontWeight: 600, fontSize: 44, letterSpacing: "-.03em", lineHeight: 1.1, color: "var(--o-head)" }}>{money(total)}</p>
          <p className="o-p" style={{ marginTop: 6, color: "var(--o-muted)" }}>paid to your account for {monthName}, to the cent</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          {MONTH_LINES.map((l, i) => (
            <div
              key={l.label}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 17, ...(i === 2 ? { paddingBottom: 13, borderBottom: "1px solid var(--o-line)" } : {}) }}
            >
              <span style={{ color: "var(--o-body)" }}>{l.label}</span>
              <span style={{ fontWeight: 500 }}>{money(l.amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 17, paddingTop: 13, borderTop: "1px solid var(--o-line)" }}>
            <span style={{ fontWeight: 600 }}>To you</span>
            <span style={{ fontWeight: 600 }}>{money(total)}</span>
          </div>
        </div>

        <div>
          <p className="o-label" style={{ marginBottom: 14 }}>The year, paid and forecast</p>
          <div className="o-bars" style={{ height: 104 }} role="img" aria-label="Monthly payouts this financial year">
            {year.map((v, i) => (
              <div
                key={MONTHS[i]}
                className="o-bar"
                title={`${MONTHS[i]} ${money(v, false)}${i > idx ? " forecast" : ""}`}
                style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: i < idx ? "var(--o-year-paid)" : i === idx ? "var(--o-year-now)" : "var(--o-year-future)" }}
              />
            ))}
          </div>
          <div className="o-axis" style={{ marginTop: 9 }}><span>Jul</span><span>Jan</span><span>Jun</span></div>
          <div style={{ marginTop: 14, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 15, color: "var(--o-body)" }}>
            {[["Paid", "var(--o-year-paid)"], ["This month", "var(--o-year-now)"], ["Forecast", "var(--o-year-future)"]].map(([label, c]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 11, height: 11, background: c, borderRadius: "99px 99px 1px 1px" }} />{label}
              </span>
            ))}
          </div>
        </div>

        <div className="o-sep" style={{ display: "flex", gap: 10 }}>
          <button className="o-btn o-btn-outline" style={{ fontSize: 17, padding: 15 }} disabled title="Coming soon">Statements</button>
          <button className="o-btn o-btn-outline" style={{ fontSize: 17, padding: 15 }} disabled title="Coming soon">Tax pack</button>
        </div>
      </main>
    </>
  );
}
