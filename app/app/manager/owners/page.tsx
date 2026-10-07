"use client";

import Link from "next/link";
import { Header } from "@/components/app/Header";
import { LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { PIPELINE, property } from "@/lib/demo";
import { OWNER_PROFILES, lastHuman, member, relationshipHealth } from "@/lib/humanTouch";
import { allLogs } from "@/lib/humanTouchState";

export default function Owners() {
  const { state, ready } = useAppState();
  const back = { href: "/app/more", label: "More" };
  if (!ready) return <Header back={back} />;
  const logs = allLogs(state);

  return (
    <>
      <Header back={back} />
      <main className="o-main">
        <div>
          <h1 className="o-title">owners</h1>
          <p className="o-status">{OWNER_PROFILES.length} owners with us. {PIPELINE.length} people thinking about it.</p>
        </div>
        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>With us</p>
          <div className="o-list">
            {OWNER_PROFILES.map((o) => {
              const h = relationshipHealth(o);
              const since = lastHuman(o, logs);
              return (
                <Link key={o.id} href={`/app/manager/owners/${o.id}`} style={{ padding: "14px 0", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", color: "inherit" }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{o.name}</span>
                    <span className="o-small">{property(o.property).name} · {member(state.assign[`pm:${o.id}`] ?? o.pm).name}</span>
                    <span className="o-small" style={{ display: "block", color: since >= state.triggers.noContactDays ? "var(--o-copper-text)" : undefined }}>Last spoke {since === 0 ? "today" : `${since} days ago`}</span>
                  </span>
                  <LevelChip level={h.level} label={h.level === "green" ? "Normal" : h.level === "amber" ? "Attention" : "Call"} />
                </Link>
              );
            })}
          </div>
        </section>
        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Thinking about it</p>
          <div className="o-list">
            {PIPELINE.map((p) => (
              <div key={p.name} style={{ padding: "14px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{p.name}</span>
                  <span className="o-chip">{p.stage}</span>
                </div>
                <p className="o-small" style={{ marginTop: 3, color: "var(--o-body)" }}>{p.place}</p>
                <p className="o-small">{p.note}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
