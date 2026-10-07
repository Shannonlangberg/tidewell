"use client";

import { useState } from "react";
import { Header } from "@/components/app/Header";
import { AssignSelect, LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { INBOX, property, type Thread } from "@/lib/demo";
import { byLevel } from "@/lib/humanTouchState";

export default function Inbox() {
  const { state, ready } = useAppState();
  if (!ready) return <Header />;

  const person = INBOX.filter((t) => (!t.assistantReply || state.takenOver.includes(t.id)) && !state.handback.includes(t.id)).sort(byLevel);
  const open = person.filter((t) => !state.sent.includes(t.id));
  const assistant = INBOX.filter((t) => (t.assistantReply && !state.takenOver.includes(t.id)) || state.handback.includes(t.id));

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">inbox</h1>
          <p className="o-status">
            {open.length ? <strong>{open.length} need{open.length === 1 ? "s" : ""} a person.</strong> : <span className="o-good">Nothing waiting on a person.</span>}{" "}
            The assistant answered {assistant.length} routine question{assistant.length === 1 ? "" : "s"} on its own.
          </p>
        </div>

        {person.map((t) => <HumanThread key={t.id} t={t} />)}

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Handled by the Property Assistant</p>
          <div className="o-list">
            {assistant.map((t) => <AssistantThread key={t.id} t={t} />)}
          </div>
          <p className="o-small" style={{ marginTop: 10 }}>The assistant signs every message as &ldquo;Property Assistant (automated)&rdquo;. It never says it&rsquo;s Court or Alex.</p>
        </section>
      </main>
    </>
  );
}

function HumanThread({ t }: { t: Thread }) {
  const { state, update } = useAppState();
  const [text, setText] = useState(t.draft ?? "");
  const sent = state.sent.includes(t.id);
  const p = property(t.property);

  return (
    <section id={t.id} className="o-boxed" style={{ background: "var(--o-raised)", scrollMarginTop: 80, borderLeft: t.level === "red" ? "4px solid var(--o-copper)" : undefined }}>
      {(t.escalated || state.takenOver.includes(t.id)) && (
        <div style={{ background: "var(--o-flood)", color: "var(--o-flood-text)", padding: "10px 14px", font: "500 12px var(--font-mono), monospace", letterSpacing: ".12em", textTransform: "uppercase" }}>
          Assistant paused — a person is handling this
        </div>
      )}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 17 }}>{t.from}</span>
          <LevelChip level={t.level} />
        </div>
        <span className="o-small">{t.who} · {p.name} · {t.minsAgo} min ago</span>
        <p className="o-p">&ldquo;{t.message}&rdquo;</p>

        {t.handover && (
          <div className="o-boxed" style={{ background: "var(--o-bg)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="o-label">Human handover</span>
            <p style={{ fontWeight: 600, fontSize: 17 }}>{t.handover.issue}</p>
            <div>
              <p className="o-small" style={{ fontWeight: 500, color: "var(--o-text)" }}>What&rsquo;s happened</p>
              <ul className="o-small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{t.handover.timeline.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <p className="o-small"><span style={{ fontWeight: 500, color: "var(--o-text)" }}>How they sound:</span> {t.handover.sentiment}</p>
            <p className="o-small" style={{ color: "var(--o-copper-text)" }}><span style={{ fontWeight: 500 }}>Do this:</span> {t.handover.action}</p>
            <div>
              <p className="o-small" style={{ fontWeight: 500, color: "var(--o-text)" }}>Worth knowing</p>
              <ul className="o-small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{t.handover.info.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            {t.escalated && <p className="o-small">Escalated because: {t.escalated.join(", ").toLowerCase()}.</p>}
          </div>
        )}

        <AssignSelect id={t.id} fallback={t.property === "simms" && t.who === "owner" ? "alex" : "court"} />

        {!sent ? (
          <>
            <label className="o-label" htmlFor={`r-${t.id}`}>Your reply</label>
            <textarea id={`r-${t.id}`} className="o-textarea" style={{ background: "var(--o-bg)" }} value={text} onChange={(e) => setText(e.target.value)} />
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              {t.level === "red" && <a href="tel:" className="o-btn o-btn-copper o-btn-sm">Call {t.from.split(" ")[0]}</a>}
              <button className={t.level === "red" ? "o-btn o-btn-outline o-btn-sm" : "o-btn o-btn-copper o-btn-sm"} onClick={() => update((s) => ({ ...s, sent: [...s.sent, t.id] }))}>Send as you</button>
            </div>
          </>
        ) : (
          <p className="o-p o-good">Replied by a person ✓</p>
        )}
        {(sent || !t.escalated) && (
          <button className="o-link" style={{ alignSelf: "flex-start", fontSize: 15 }} onClick={() => update((s) => ({ ...s, handback: [...s.handback, t.id], takenOver: s.takenOver.filter((x) => x !== t.id) }))}>
            Resolved — hand back to the assistant
          </button>
        )}
      </div>
    </section>
  );
}

function AssistantThread({ t }: { t: Thread }) {
  const { state, update } = useAppState();
  const back = state.handback.includes(t.id);
  return (
    <div style={{ padding: "13px 0", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <span style={{ fontWeight: 600, fontSize: 17 }}>{t.from}</span>
        <LevelChip level={back ? t.level : "green"} label={back ? "Resolved" : "Routine"} />
      </div>
      <p className="o-small" style={{ color: "var(--o-body)" }}>&ldquo;{t.message}&rdquo;</p>
      {t.assistantReply && (
        <p className="o-small" style={{ borderLeft: "2px solid var(--o-line)", paddingLeft: 10 }}>
          <span style={{ fontWeight: 500, color: "var(--o-text)" }}>Property Assistant (automated):</span> {t.assistantReply}
        </p>
      )}
      {!back && (
        <button className="o-link" style={{ alignSelf: "flex-start", fontSize: 15 }} onClick={() => update((s) => ({ ...s, takenOver: [...s.takenOver, t.id] }))}>
          Take over — pause the assistant
        </button>
      )}
    </div>
  );
}
