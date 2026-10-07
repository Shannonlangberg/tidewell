"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GUEST_STAY, property } from "@/lib/demo";

type Phase = "before" | "arrival" | "staying" | "leaving";
const PHASES: { id: Phase; label: string }[] = [
  { id: "before", label: "Before" },
  { id: "arrival", label: "Arrival day" },
  { id: "staying", label: "Staying" },
  { id: "leaving", label: "Leaving" },
];

export default function Stay() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>("arrival");
  const [revealed, setRevealed] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (token !== GUEST_STAY.token) {
    return (
      <main className="o-main" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 40px)" }}>
        <h1 className="o-title">this link has expired</h1>
        <p className="o-status">Stay links stop working after checkout. If you&rsquo;re still with us, ring 0417 604 882 — any hour.</p>
      </main>
    );
  }

  const g = GUEST_STAY;
  const p = property(g.property);
  const codeReady = phase === "arrival" || phase === "staying";
  const hour = ready ? new Date().getHours() : 0;

  const status: Record<Phase, string> = {
    before: `Your stay at ${p.name} is in three days. Here's everything you need, and the door code turns up here on the day.`,
    arrival: `Welcome, ${g.guest}. The house is clean and ready from ${g.checkIn}.`,
    staying: "Everything about the house is below. If something isn't right, tell us — we'd rather know tonight than read it in a review.",
    leaving: `Checkout is ${g.checkOut} tomorrow. Four small things and you're done.`,
  };

  return (
    <>
      <header className="o-header">
        <div className="o-header-title">
          <span aria-hidden className="o-tag-mark" />
          {p.name}
        </div>
        <span className="o-header-side">{p.town}</span>
      </header>
      <p className="o-demo">Demo · a guest&rsquo;s stay link</p>
      <main className="o-main">
        <div>
          <h1 className="o-title">{phase === "leaving" ? `thanks, ${g.guest.toLowerCase()}` : phase === "before" ? "see you soon" : `hello, ${g.guest.toLowerCase()}`}</h1>
          <p className="o-status">{status[phase]}</p>
        </div>

        {phase !== "leaving" && (
          <section className="o-flood" style={{ alignItems: "flex-start" }}>
            <span className="o-label">Front door</span>
            {codeReady && revealed ? (
              <p style={{ fontWeight: 600, fontSize: 44, letterSpacing: ".12em", lineHeight: 1.1 }}>{p.code}</p>
            ) : codeReady ? (
              <button className="o-btn o-btn-copper" style={{ fontSize: 17, padding: 15 }} onClick={() => setRevealed(true)}>
                Show the door code
              </button>
            ) : (
              <p style={{ fontSize: 17, lineHeight: 1.5, color: "var(--o-flood-body)" }}>Your code turns up here from 2pm on the day you arrive.</p>
            )}
            <p style={{ fontSize: 15, color: "var(--o-flood-muted)" }}>Check in from {g.checkIn} · check out by {g.checkOut}</p>
          </section>
        )}

        {phase === "leaving" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span className="o-label">Before you go</span>
            {g.leaving.map((l) => (
              <label key={l} style={{ display: "flex", gap: 12, alignItems: "flex-start", fontSize: 17, lineHeight: 1.45 }}>
                <input type="checkbox" style={{ width: 22, height: 22, accentColor: "var(--o-shallow)", flex: "none", marginTop: 2 }} />
                {l}
              </label>
            ))}
            <p className="o-small">That&rsquo;s it. No need to strip the beds or clean — we do that.</p>
          </section>
        )}

        {phase !== "before" && phase !== "leaving" && (
          <section className="o-boxed" style={{ padding: 16, background: "var(--o-raised)" }}>
            <span className="o-label">Wi-Fi</span>
            <p style={{ marginTop: 8, fontSize: 17 }}>{g.wifi.name}</p>
            <p style={{ font: "500 17px var(--font-mono), monospace", color: "var(--o-head)" }}>{g.wifi.password}</p>
          </section>
        )}

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>{phase === "before" ? "Getting here" : "The house"}</p>
          <div className="o-list">
            {(phase === "before" ? g.guide.slice(0, 2) : g.guide).map((x) => (
              <div key={x.title} style={{ padding: "13px 0" }}>
                <div style={{ fontWeight: 600, fontSize: 17 }}>{x.title}</div>
                <p className="o-small" style={{ color: "var(--o-body)" }}>{x.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="o-label">Ask us anything</span>
          <p className="o-small">
            Quick questions like Wi-Fi or parking get an instant answer from our Property Assistant (automated). Anything else goes straight to a person, inside the hour, 8am – 10pm.{hour >= 22 || hour < 8 ? " It's late — for anything urgent, ring and it'll be answered." : " Overnight, ring for anything urgent."}
          </p>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
            <a href="sms:+61417604882" className="o-btn o-btn-green o-btn-sm">Text us</a>
            <a href="tel:+61417604882" className="o-btn o-btn-outline o-btn-sm">Call</a>
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="o-label">Demo · see the link at each stage</span>
          <div className="o-seg" role="group" aria-label="Stage of stay" style={{ flexWrap: "wrap" }}>
            {PHASES.map((ph) => (
              <button key={ph.id} aria-pressed={phase === ph.id} style={{ fontSize: 15 }} onClick={() => { setPhase(ph.id); setRevealed(false); }}>{ph.label}</button>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
