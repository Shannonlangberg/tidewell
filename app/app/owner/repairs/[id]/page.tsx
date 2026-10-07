"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { OWNER, REPAIRS, dayFrom, money, repairTotal, short } from "@/lib/demo";

export default function RepairDetail() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, update } = useAppState();
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const r = REPAIRS.find((x) => x.id === id);

  // "Ask" on the Home card links here with #ask — open the question box straight away.
  useEffect(() => {
    if (location.hash === "#ask") setAsking(true);
  }, []);

  if (!ready) return <Header back={{ href: "/app/owner/repairs", label: "Repairs & upkeep" }} />;

  if (!r) {
    return (
      <>
        <Header back={{ href: "/app/owner/repairs", label: "Repairs & upkeep" }} />
        <main className="o-main"><p className="o-status">We couldn&rsquo;t find that repair.</p></main>
      </>
    );
  }

  const total = repairTotal(r);
  const approved = state.approved.includes(r.id);
  const waiting = r.status === "decision" && !approved;
  const asked = state.asked[r.id];

  return (
    <>
      <Header back={{ href: "/app/owner/repairs", label: "Repairs & upkeep" }} />
      <main className="o-main" style={{ gap: 20 }}>
        <div>
          <p className="o-label" style={{ color: waiting ? "var(--o-copper-text)" : "var(--o-shallow)" }}>
            {waiting ? `Waiting on you · ${r.reportedDaysAgo} days` : approved ? "Approved · booked in" : "Done"}
          </p>
          <h1 className="o-title" style={{ marginTop: 10, fontSize: 30 }}>{r.title}</h1>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          <div className="o-ph" style={{ flex: 1, aspectRatio: "3/4" }}>the problem</div>
          <div className="o-ph" style={{ flex: 1, aspectRatio: "3/4" }}>wide shot</div>
        </div>

        {r.detail && <p className="o-p">{r.detail}</p>}

        <div className="o-table">
          {r.lines.map((l) => (
            <div key={l.label}><span style={{ color: "var(--o-body)" }}>{l.label}</span><span style={{ fontWeight: 500 }}>{money(l.amount)}</span></div>
          ))}
          {r.lines.length > 1 && (
            <div><span style={{ fontWeight: 600 }}>Total</span><span style={{ fontWeight: 600, fontSize: 26, letterSpacing: "-.02em", color: "var(--o-head)" }}>{money(total)}</span></div>
          )}
        </div>

        {waiting && (
          <p className="o-small">
            Over your {money(OWNER.threshold, false)} threshold, so it&rsquo;s your call. {r.note}
          </p>
        )}

        {waiting && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className="o-btn o-btn-copper" onClick={() => update((s) => ({ ...s, approved: [...s.approved, r.id] }))}>
              Approve {money(total, false)}
            </button>
            {!asking && !asked && (
              <button id="ask" className="o-btn o-btn-outline" onClick={() => setAsking(true)}>Ask a question</button>
            )}
          </div>
        )}

        {approved && (
          <p className="o-p o-good">Approved. We&rsquo;ll book the trade in and send you the after photo.</p>
        )}

        {asking && waiting && !asked && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return;
              update((s) => ({ ...s, asked: { ...s.asked, [r.id]: draft.trim() } }));
              setAsking(false);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <label className="o-label" htmlFor="q">Your question</label>
            <textarea id="q" className="o-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Could they fit it before Friday?" autoFocus />
            <button className="o-btn o-btn-green" type="submit">Send — we&rsquo;ll reply inside the hour</button>
          </form>
        )}

        {asked && (
          <div className="o-boxed" style={{ padding: 16, background: "var(--o-raised)" }}>
            <p className="o-label" style={{ marginBottom: 8 }}>You asked</p>
            <p className="o-p">&ldquo;{asked}&rdquo;</p>
            <p className="o-small" style={{ marginTop: 8 }}>Sent. A person will reply inside the hour. (Demo — nothing was actually sent.)</p>
          </div>
        )}

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="o-label">History</p>
          {approved && <HistoryRow day={short(dayFrom(0))} text="Approved by you" />}
          {r.history.map((h) => <HistoryRow key={h.text} day={short(dayFrom(-h.daysAgo))} text={h.text} />)}
        </section>
      </main>
    </>
  );
}

function HistoryRow({ day, text }: { day: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ font: "400 13px var(--font-mono), monospace", color: "var(--o-muted)", width: 62, flex: "none", paddingTop: 2 }}>{day}</span>
      <span style={{ fontSize: 15, lineHeight: 1.45, color: "var(--o-text)" }}>{text}</span>
    </div>
  );
}
