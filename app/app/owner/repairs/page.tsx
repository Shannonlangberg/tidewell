"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { OWNER, REPAIRS, money, repairTotal } from "@/lib/demo";

export default function Repairs() {
  const { state } = useAppState();
  const waiting = REPAIRS.filter((r) => r.status === "decision" && !state.approved.includes(r.id));
  const rest = REPAIRS.filter((r) => !waiting.includes(r));

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">repairs &amp; upkeep</h1>
          <p className="o-status">
            {waiting.length ? <strong>{waiting.length === 1 ? "One repair is" : `${waiting.length} repairs are`} waiting on you.</strong> : "Nothing waiting on you."}{" "}
            Anything under {money(OWNER.threshold, false)} we just fix.
          </p>
        </div>

        {waiting.length > 0 && (
          <section>
            <p className="o-label" style={{ marginBottom: 12 }}>Waiting on you</p>
            <div className="o-list">
              {waiting.map((r) => <Row key={r.id} id={r.id} title={r.title} sub={r.summary} amount={repairTotal(r)} accent />)}
            </div>
          </section>
        )}

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Done</p>
          <div className="o-list">
            {rest.map((r) => (
              <Row key={r.id} id={r.id} title={r.title} sub={state.approved.includes(r.id) ? "Approved — booked in with the trade" : r.summary} amount={repairTotal(r)} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function Row({ id, title, sub, amount, accent }: { id: string; title: string; sub: string; amount: number; accent?: boolean }) {
  return (
    <Link href={`/app/owner/repairs/${id}`} style={{ padding: "15px 0", display: "flex", gap: 13, color: "inherit" }}>
      <span style={{ width: 5, alignSelf: "stretch", flex: "none", background: accent ? "var(--o-copper)" : "var(--o-shallow)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 19 }}>{title}</span>
          <span style={{ fontWeight: 600, fontSize: 17 }}>{money(amount)}</span>
        </div>
        <p className="o-small" style={{ marginTop: 4, color: "var(--o-body)" }}>{sub}</p>
      </div>
    </Link>
  );
}
