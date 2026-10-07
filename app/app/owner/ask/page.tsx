"use client";

import { useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { MONTH_LINES, REPAIRS, STAYS, dayFrom, money, nextNights, repairTotal, short } from "@/lib/demo";
import { member, ownerProfile } from "@/lib/humanTouch";

// Optional convenience. Answers come straight from the owner's own data — never guesses,
// never speaks for the property manager, and always offers the person.
export default function Ask() {
  const { state, ready } = useAppState();
  const [asked, setAsked] = useState<string[]>([]);
  if (!ready) return <Header back={{ href: "/app/owner", label: "Home" }} />;

  const pm = member(ownerProfile("jane")?.pm);
  const stays = state.quiet ? [] : STAYS;
  const booked = nextNights(stays).filter((n) => n.state === "booked").length;
  const next = stays.find((s) => s.startOffset > 0 && s.platform !== "Owner");
  const waiting = REPAIRS.filter((r) => r.status === "decision" && !state.approved.includes(r.id));
  const month = MONTH_LINES.reduce((a, l) => a + l.amount, 0);

  const QA: Record<string, string> = {
    "How booked am I?": `${booked} of the next 14 nights are booked.${next ? ` The next guests arrive ${short(dayFrom(next.startOffset))}.` : ""}`,
    "What did I earn this month?": `${money(month)} so far, after platform commission, our fee and repairs. The full breakdown is on the Money tab.`,
    "Is anything waiting on me?": waiting.length ? `Yes — ${waiting.map((r) => `${r.title.toLowerCase()} (${money(repairTotal(r), false)})`).join(", ")}. It's on the Repairs tab.` : "No, nothing's waiting on you.",
    "When was the last clean?": "This morning at 10.40am. Kel photographed every room — the photos are on your Home tab.",
  };

  return (
    <>
      <Header back={{ href: "/app/owner", label: "Home" }} />
      <main className="o-main">
        <div>
          <h1 className="o-title">ask about my place</h1>
          <p className="o-status" style={{ fontSize: 17 }}>Quick answers from your own numbers, any time. For anything else, {pm.name} is a call away.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {asked.map((q) => (
            <div key={q} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="o-p" style={{ alignSelf: "flex-end", background: "var(--o-head)", color: "var(--o-bg)", padding: "10px 14px", maxWidth: "85%" }}>{q}</p>
              <div style={{ maxWidth: "90%" }}>
                <p className="o-label" style={{ marginBottom: 4 }}>Property Assistant · automated</p>
                <p className="o-p" style={{ background: "var(--o-raised)", border: "1px solid var(--o-line)", padding: "10px 14px" }}>{QA[q]}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.keys(QA).filter((q) => !asked.includes(q)).map((q) => (
            <button key={q} className="o-btn o-btn-outline o-btn-sm" style={{ fontSize: 15, padding: "10px 16px" }} onClick={() => setAsked((a) => [...a, q])}>{q}</button>
          ))}
        </div>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="o-p">Rather talk to a person?</p>
          <a href={`tel:${pm.phone.replace(/\s/g, "")}`} className="o-btn o-btn-green">Call {pm.name}</a>
          <a href={`sms:${pm.phone.replace(/\s/g, "")}`} className="o-btn o-btn-outline">Text {pm.name}</a>
        </section>
      </main>
    </>
  );
}
