"use client";

import { useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { BOARD, JOBS, OWNER, PEOPLE, STAGES, dayFrom, money, property, type Stage } from "@/lib/demo";

export default function ManagerJobs() {
  const { state, ready, update } = useAppState();
  const [view, setView] = useState<"cleans" | "repairs">("cleans");
  if (!ready) return <Header />;

  const stageOf = (id: string, fallback: Stage): Stage => (state.approved.includes(id) && fallback === "owner" ? "booked" : state.stages[id] ?? fallback);
  const move = (id: string, to: Stage) => update((s) => ({ ...s, stages: { ...s.stages, [id]: to } }));

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">jobs</h1>
          <div className="o-seg" role="group" aria-label="Job type" style={{ marginTop: 14 }}>
            <button aria-pressed={view === "cleans"} onClick={() => setView("cleans")}>Cleaning roster</button>
            <button aria-pressed={view === "repairs"} onClick={() => setView("repairs")}>Repairs</button>
          </div>
        </div>

        {view === "cleans" ? (
          <div className="o-list">
            {JOBS.filter((j) => j.type === "clean").map((j) => {
              const p = property(j.property);
              const done = state.jobsDone.includes(j.id);
              return (
                <div key={j.id} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{p.name}</span>
                    <span className="o-small">
                      {j.dayOffset === 0 ? "Today" : dayFrom(j.dayOffset).toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })} · {j.window} · {PEOPLE.find((x) => x.id === j.crew)?.name}
                    </span>
                  </span>
                  <span className="o-small" style={{ alignSelf: "center", color: done ? "var(--o-shallow)" : undefined }}>{done ? "✓" : j.type === "clean" ? money(j.pay, false) : ""}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {STAGES.map((st, i) => {
              const cards = BOARD.filter((b) => stageOf(b.id, b.stage) === st.id);
              return (
                <section key={st.id}>
                  <div className="o-row-head" style={{ marginBottom: 8 }}>
                    <span className="o-label" style={{ color: st.id === "owner" && cards.length ? "var(--o-copper-text)" : undefined }}>{st.label}</span>
                    <span className="o-small">{cards.length}</span>
                  </div>
                  {cards.length === 0 && <p className="o-small" style={{ padding: "4px 0 0" }}>—</p>}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {cards.map((c) => (
                      <div key={c.id} className="o-boxed" style={{ background: "var(--o-raised)", padding: "12px 14px", display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontWeight: 600, fontSize: 17 }}>{c.title}</span>
                          <span className="o-small">{property(c.property).name}{c.amount ? ` · ${money(c.amount, false)}` : ""}</span>
                        </span>
                        {i < STAGES.length - 1 && st.id !== "owner" && (() => {
                          // Under the owner's threshold we just do it — skip "waiting on owner".
                          const next = STAGES[i + 1].id === "owner" && (c.amount ?? 0) < OWNER.threshold ? STAGES[i + 2] : STAGES[i + 1];
                          return (
                            <button className="o-link" style={{ fontSize: 15, flex: "none" }} onClick={() => move(c.id, next.id)}>
                              {next.label} ›
                            </button>
                          );
                        })()}
                        {st.id === "owner" && <span className="o-small" style={{ flex: "none" }}>Owner decides</span>}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
