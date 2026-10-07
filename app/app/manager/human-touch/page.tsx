"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { AssignSelect, LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { INBOX, needsHuman, property } from "@/lib/demo";
import { HEALTH_LABEL, MESSAGE_STATS_30D, OWNER_PROFILES, member, nextInteraction, relationshipHealth, type Level } from "@/lib/humanTouch";
import { counterLines, humanTouch } from "@/lib/humanTouchState";

const KIND_LABEL = { owner: "Owner", guest: "Guest", maintenance: "Maintenance" } as const;

export default function HumanTouch() {
  const { state, ready } = useAppState();
  if (!ready) return <Header back={{ href: "/app/manager", label: "Today" }} />;

  const h = humanTouch(state);
  const lines = counterLines(h, state.triggers.noContactDays);
  const upcoming = OWNER_PROFILES.map((o) => ({ o, n: nextInteraction(o, h.logs) })).sort((a, b) => a.n.inDays - b.n.inDays).slice(0, 4);
  const completed = h.logs.slice(0, 4);

  // Metrics — computed where we have the data, sample where we don't (flagged).
  const contacted30 = OWNER_PROFILES.filter((o) => h.logs.some((l) => l.owner === o.id && l.daysAgo <= 30)).length;
  const proactive = h.logs.filter((l) => l.proactive && l.daysAgo <= 30).length;
  const health = OWNER_PROFILES.map((o) => relationshipHealth(o).level);
  const count = (l: Level) => health.filter((x) => x === l).length;
  const pct = (a: number, b: number) => Math.round((a / b) * 100);
  const routineToday = INBOX.filter((t) => !needsHuman(t)).length;

  return (
    <>
      <Header back={{ href: "/app/manager", label: "Today" }} />
      <main className="o-main">
        <div>
          <h1 className="o-title">human touch</h1>
          <p className="o-status">The assistant handles the admin. These need a person.</p>
        </div>

        <section className="o-flood">
          <span className="o-label">Requires human attention</span>
          <p style={{ fontWeight: 600, fontSize: 52, lineHeight: 1, letterSpacing: "-.03em" }}>{h.items.length}</p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {lines.map((l) => <li key={l} style={{ fontSize: 17, color: "var(--o-flood-body)" }}>{l}</li>)}
          </ul>
        </section>

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Red first</p>
          <div className="o-list">
            {h.items.map((it) => (
              <div key={it.id} style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <LevelChip level={it.level} />
                  <span className="o-small">{KIND_LABEL[it.kind]}</span>
                </div>
                <Link href={it.href} style={{ color: "inherit" }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{it.title}</span>
                  <span className="o-small" style={{ color: "var(--o-body)" }}>{it.reason}</span>
                </Link>
                <AssignSelect id={it.id} fallback={it.kind === "owner" ? OWNER_PROFILES.find((o) => it.id.startsWith(o.id))?.pm : undefined} />
              </div>
            ))}
            {!h.items.length && <p className="o-p o-good" style={{ padding: "14px 0" }}>Nothing needs a person right now.</p>}
          </div>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Relationship health</p>
          <div className="o-list">
            {OWNER_PROFILES.map((o) => {
              const r = relationshipHealth(o);
              return (
                <Link key={o.id} href={`/app/manager/owners/${o.id}`} style={{ padding: "12px 0", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", color: "inherit" }}>
                  <span>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{o.name}</span>
                    <span className="o-small">{r.signals.length ? r.signals.join(", ") : "No concerns in recent messages"}</span>
                  </span>
                  <LevelChip level={r.level} label={HEALTH_LABEL[r.level].split(" ")[0]} />
                </Link>
              );
            })}
          </div>
          <p className="o-small" style={{ marginTop: 10 }}>Based only on what owners say about the business — repeat questions, concerns about money or repairs, asking for a person. Never a judgement about the person.</p>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Coming up</p>
          <div className="o-list">
            {upcoming.map(({ o, n }) => (
              <Link key={o.id} href={`/app/manager/owners/${o.id}`} style={{ padding: "12px 0", display: "flex", justifyContent: "space-between", gap: 10, color: "inherit" }}>
                <span>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{o.name}</span>
                  <span className="o-small">{n.what} · {member(state.assign[o.id] ?? o.pm).name}</span>
                </span>
                <span className="o-small" style={{ color: n.inDays <= 0 ? "var(--o-copper-text)" : undefined, whiteSpace: "nowrap" }}>{n.inDays <= 0 ? "Due now" : `in ${n.inDays} days`}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Recently done by a person</p>
          <div className="o-list">
            {completed.map((l) => (
              <div key={l.id} style={{ padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{l.type} · {OWNER_PROFILES.find((o) => o.id === l.owner)?.first}</span>
                  <span className="o-small">{l.daysAgo === 0 ? "today" : `${l.daysAgo}d ago`}</span>
                </div>
                <p className="o-small" style={{ color: "var(--o-body)" }}>{l.notes} — {member(l.by).name}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="o-sep">
          <div className="o-row-head">
            <span className="o-label">Last 30 days</span>
            <span className="o-small">Goal: less admin, more people</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--o-line)", border: "1px solid var(--o-line)" }}>
            {[
              [`${pct(MESSAGE_STATS_30D.automated, MESSAGE_STATS_30D.total)}%`, "routine messages answered by the assistant", true],
              [`${pct(MESSAGE_STATS_30D.escalated, MESSAGE_STATS_30D.total)}%`, "escalated to a person", true],
              [`${MESSAGE_STATS_30D.avgHumanMins} min`, "average human reply", true],
              [`${MESSAGE_STATS_30D.escalationsResolved} of ${MESSAGE_STATS_30D.escalated}`, "escalations resolved", true],
              [`${contacted30} of ${OWNER_PROFILES.length}`, "owners spoken to by a person", false],
              [`${h.noContact.length}`, "owners overdue for contact", false],
              [`${proactive}`, "proactive calls and visits", false],
              [`${h.risk.length}`, "relationship alerts", false],
            ].map(([big, small, sample]) => (
              <div key={String(small)} style={{ background: "var(--o-bg)", padding: "14px 12px" }}>
                <div style={{ fontWeight: 600, fontSize: 24, letterSpacing: "-.02em", color: "var(--o-head)" }}>{big}{sample ? <sup className="o-small" style={{ fontSize: 12 }}> *</sup> : null}</div>
                <div className="o-small" style={{ lineHeight: 1.35 }}>{small}</div>
              </div>
            ))}
          </div>
          <p className="o-small" style={{ marginTop: 10 }}>
            Owner health: {count("green")} normal, {count("amber")} attention, {count("red")} human contact required. Today the assistant answered {routineToday} routine questions on its own.
          </p>
          <p className="o-small" style={{ marginTop: 4 }}>* Sample figures until the inbox is connected.</p>
        </section>

        <Link href="/app/manager/human-touch/triggers" className="o-btn o-btn-outline">When to bring in a person</Link>
      </main>
    </>
  );
}
