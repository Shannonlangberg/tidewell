"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { TENANCY, TENANT_REPAIRS, cap, dayFrom, greeting, money, words } from "@/lib/demo";

const longDate = (d: Date) => d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

export default function TenantHome() {
  const { state, ready } = useAppState();
  if (!ready) return <Header />;

  const open = [...state.reports.map((r) => r.title), ...TENANT_REPAIRS.filter((r) => r.status !== "Fixed").map((r) => r.title)];
  const nextDue = dayFrom(TENANCY.paidTo);

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">{greeting()}, tess</h1>
          <p className="o-status">
            Rent&rsquo;s paid up to {longDate(nextDue)}.{" "}
            {open.length ? `${cap(words(open.length))} repair${open.length === 1 ? "" : "s"} on the go.` : "Nothing waiting on repairs."}
          </p>
        </div>

        <section className="o-flood">
          <span className="o-label">Coming up</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 19 }}>Routine inspection</div>
            <p style={{ marginTop: 5, fontSize: 15, lineHeight: 1.45, color: "var(--o-flood-body)" }}>
              {longDate(dayFrom(TENANCY.inspectionIn))}, between 10am and 11am. About twenty minutes. You don&rsquo;t need to be home, and you don&rsquo;t need to clean for us.
            </p>
          </div>
          <a href="sms:+61417604882" className="o-flood-btn-ghost" style={{ alignSelf: "flex-start" }}>That time doesn&rsquo;t suit</a>
        </section>

        <section>
          <div className="o-row-head">
            <span className="o-label">Repairs</span>
            <Link href="/app/tenant/repairs" className="o-link" style={{ fontSize: 15 }}>Report something</Link>
          </div>
          <div className="o-list">
            {state.reports.map((r) => (
              <div key={r.id} style={{ padding: "13px 0" }}>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{r.title}</div>
                <p className="o-small">Reported — we&rsquo;ll reply inside the hour</p>
              </div>
            ))}
            {TENANT_REPAIRS.map((r) => (
              <div key={r.id} style={{ padding: "13px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{r.title}</span>
                  <span className={r.status === "Fixed" ? "o-small o-good" : "o-small"} style={{ color: r.status === "Fixed" ? undefined : "var(--o-copper-text)" }}>{r.status}</span>
                </div>
                <p className="o-small">{r.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="o-label">The house</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>Bins</div>
            <p className="o-small" style={{ color: "var(--o-body)" }}>{TENANCY.bins}</p>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>Your lease</div>
            <p className="o-small" style={{ color: "var(--o-body)" }}>
              {money(TENANCY.weeklyRent, false)} a week. Runs to {dayFrom(TENANCY.leaseEndMonths * 30).toLocaleDateString("en-AU", { month: "long", year: "numeric" })}. We&rsquo;ll talk to you about renewing at least two months before.
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 17 }}>Something urgent?</div>
            <p className="o-small" style={{ color: "var(--o-body)" }}>Burst pipe, gas smell, no power, no hot water, locked out — ring any hour. Someone answers.</p>
            <a href="tel:+61417604882" className="o-btn o-btn-copper o-btn-sm" style={{ marginTop: 10 }}>Call now</a>
          </div>
        </section>
      </main>
    </>
  );
}
