"use client";

import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { PAYOUTS, money, property } from "@/lib/demo";

export default function ManagerMoney() {
  const { state, ready, update } = useAppState();
  if (!ready) return <Header back={{ href: "/app/more", label: "More" }} />;
  const unmatched = PAYOUTS.filter((p) => !p.matched);
  const total = PAYOUTS.reduce((a, p) => a + p.amount, 0);

  return (
    <>
      <Header back={{ href: "/app/more", label: "More" }} />
      <main className="o-main">
        <div>
          <h1 className="o-title">month close</h1>
          <p className="o-status">
            {state.payoutsRun ? <span className="o-good">Statements sent. The month is closed.</span> : unmatched.length ? <strong>{unmatched.length} statement doesn&rsquo;t match the platform payout yet.</strong> : "Everything matches."}
          </p>
        </div>
        <div className="o-list">
          {PAYOUTS.map((p) => (
            <div key={p.owner} style={{ padding: "14px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>
                <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{p.owner}</span>
                <span className="o-small" style={{ color: p.matched ? undefined : "var(--o-copper-text)" }}>{property(p.property).name} · {p.matched ? "matched" : "Stayz payout $64.20 short — chasing"}</span>
              </span>
              <span style={{ fontWeight: 500, fontSize: 17 }}>{money(p.amount)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17 }}>
          <span style={{ fontWeight: 600 }}>To owners, all homes</span>
          <span style={{ fontWeight: 600 }}>{money(total)}</span>
        </div>
        {!state.payoutsRun && (
          <button className="o-btn o-btn-copper" onClick={() => update((s) => ({ ...s, payoutsRun: true }))}>
            {unmatched.length ? `Send the ${PAYOUTS.length - unmatched.length} statements that match` : "Send every statement"}
          </button>
        )}
        <p className="o-small">Platforms pay owners directly — we never hold the money. This checks each statement against what the platforms paid, sends it, and invoices our fee. Demo only.</p>
      </main>
    </>
  );
}
