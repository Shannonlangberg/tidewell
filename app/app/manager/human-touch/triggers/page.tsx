"use client";

import { Header } from "@/components/app/Header";
import { LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { DEFAULT_TRIGGERS, TRIGGER_LABEL, type TriggerKey } from "@/lib/humanTouch";

const GUEST_RULES: { level: "green" | "amber" | "red"; items: string }[] = [
  { level: "green", items: "Wi-Fi, parking, check-in and checkout, appliances, local tips, house rules — the assistant answers." },
  { level: "amber", items: "Minor maintenance, a repeated complaint, a cleaning problem, an owner concern — the assistant can help, and a person is told." },
  { level: "red", items: "Injury, safety, lockout the assistant can't fix, refunds or compensation, damage, party or neighbour complaint, an angry guest, anyone asking for a manager, anything emotionally sensitive — a person takes over and the assistant stops." },
];

export default function Triggers() {
  const { state, ready, update } = useAppState();
  const back = { href: "/app/manager/human-touch", label: "Human touch" };
  if (!ready) return <Header back={back} />;
  const t = { ...DEFAULT_TRIGGERS, ...state.triggers, enabled: { ...DEFAULT_TRIGGERS.enabled, ...state.triggers.enabled } };
  const set = (patch: Partial<typeof t>) => update((s) => ({ ...s, triggers: { ...t, ...patch } }));

  return (
    <>
      <Header back={back} />
      <main className="o-main">
        <div>
          <h1 className="o-title">when to bring in a person</h1>
          <p className="o-status" style={{ fontSize: 17 }}>Each of these creates a &ldquo;human follow-up recommended&rdquo; task. Nothing sensitive is ever sent automatically.</p>
        </div>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="o-label">No human contact for</span>
          <div className="o-seg" role="group" aria-label="Days without contact">
            {([30, 45, 60] as const).map((d) => (
              <button key={d} aria-pressed={t.noContactDays === d} onClick={() => set({ noContactDays: d })}>{d} days</button>
            ))}
          </div>
          <span className="o-label" style={{ marginTop: 8 }}>Revenue falls by more than</span>
          <div className="o-seg" role="group" aria-label="Revenue drop">
            {[10, 15, 25].map((d) => (
              <button key={d} aria-pressed={t.revenueDropPct === d} onClick={() => set({ revenueDropPct: d })}>{d}%</button>
            ))}
          </div>
        </section>

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 8 }}>Owner triggers</p>
          <div className="o-list">
            {(Object.keys(TRIGGER_LABEL) as TriggerKey[]).map((k) => (
              <label key={k} style={{ padding: "13px 0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <span className="o-p">{TRIGGER_LABEL[k]}</span>
                <input type="checkbox" checked={t.enabled[k]} onChange={(e) => set({ enabled: { ...t.enabled, [k]: e.target.checked } })} style={{ width: 22, height: 22, accentColor: "var(--o-shallow)" }} />
              </label>
            ))}
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="o-label">Guest messages</span>
          {GUEST_RULES.map((g) => (
            <div key={g.level} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <LevelChip level={g.level} />
              <span className="o-small" style={{ color: "var(--o-body)" }}>{g.items}</span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
