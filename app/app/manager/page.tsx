"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { INBOX, JOBS, PEOPLE, STAYS, cap, greeting, needsHuman, property, words } from "@/lib/demo";
import { counterLines, humanTouch } from "@/lib/humanTouchState";

export default function ManagerToday() {
  const { state, ready } = useAppState();
  if (!ready) return <Header />;

  const h = humanTouch(state);
  const reds = h.items.filter((i) => i.level === "red");
  const lines = counterLines(h, state.triggers.noContactDays);
  const waiting = INBOX.filter((m) => needsHuman(m) && !state.sent.includes(m.id) && !state.handback.includes(m.id));
  const oldest = Math.max(0, ...waiting.map((m) => m.minsAgo));
  const cleans = JOBS.filter((j) => j.type === "clean" && j.dayOffset === 0);
  const cleansDone = cleans.filter((j) => state.jobsDone.includes(j.id));
  const arriving = STAYS.filter((s) => s.startOffset === 0 && s.platform !== "Owner");
  const automated = INBOX.filter((m) => !needsHuman(m)).length;

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">{greeting()}, court</h1>
          <p className="o-status">
            {reds.length ? <strong>{cap(words(reds.length))} thing{reds.length === 1 ? "" : "s"} need{reds.length === 1 ? "s" : ""} a person right now.</strong> : <span className="o-good">Nothing urgent.</span>}{" "}
            {waiting.length ? `${cap(words(waiting.length))} message${waiting.length === 1 ? "" : "s"} waiting — the oldest ${oldest} minutes.` : "Every message answered."}
          </p>
        </div>

        {reds.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reds.map((r) => (
              <Link key={r.id} href={r.href} className="o-flood" style={{ gap: 8, color: "var(--o-flood-text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <span className="o-label">Human now</span>
                  <LevelChip level="red" label="Red" />
                </div>
                <span style={{ fontWeight: 600, fontSize: 17 }}>{r.title}</span>
                <span style={{ fontSize: 15, color: "var(--o-flood-body)" }}>{r.reason}</span>
              </Link>
            ))}
          </section>
        )}

        <Link href="/app/manager/human-touch" className="o-boxed" style={{ background: "var(--o-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 8, color: "inherit" }}>
          <div className="o-row-head" style={{ margin: 0 }}>
            <span className="o-label">Human touch</span>
            <span className="o-link" style={{ fontSize: 15 }}>Open ›</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 36, letterSpacing: "-.03em", color: "var(--o-head)" }}>{h.items.length}</span>
            <span className="o-p" style={{ color: "var(--o-muted)" }}>require human attention</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="o-small">
            {lines.map((l) => <li key={l} style={{ color: "var(--o-body)" }}>{l}</li>)}
          </ul>
          <p className="o-small">The assistant handled {automated} routine question{automated === 1 ? "" : "s"} so you didn&rsquo;t have to.</p>
        </Link>

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Cleans today</p>
          <div className="o-list">
            {cleans.map((j) => {
              const p = property(j.property);
              const n = state.photographed[j.id]?.length ?? 0;
              const done = state.jobsDone.includes(j.id);
              return (
                <div key={j.id} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{p.name}</span>
                    <span className="o-small">{PEOPLE.find((x) => x.id === j.crew)?.first.replace(/^./, (c) => c.toUpperCase())} · {j.window}</span>
                  </span>
                  <span className="o-small" style={{ color: done ? "var(--o-shallow)" : "var(--o-copper-text)", alignSelf: "center" }}>{done ? "✓ Done" : `${n}/${p.rooms.length} rooms`}</span>
                </div>
              );
            })}
          </div>
          <p className="o-small" style={{ marginTop: 8 }}>{cap(words(cleansDone.length))} of {words(cleans.length)} done.</p>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Also today</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {arriving.map((s) => <Line key={s.id} text={`${s.guest} arrive at ${property("bayview").name}. Code goes out at 2pm.`} />)}
            <Line text="Pricing pass for the next 8 weeks is due Friday." />
          </div>
        </section>
      </main>
    </>
  );
}

function Line({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 11 }}>
      <span className="o-dot" style={{ background: "var(--o-shallow)" }} />
      <span className="o-p" style={{ lineHeight: 1.45 }}>{text}</span>
    </div>
  );
}
