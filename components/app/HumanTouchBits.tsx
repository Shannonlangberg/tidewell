"use client";

import { LEVEL_LABEL, TEAM, member, type Level } from "@/lib/humanTouch";
import { useAppState } from "./useAppState";

const LEVEL_STYLE: Record<Level, React.CSSProperties> = {
  red: { background: "var(--o-copper)", color: "#0A211C", borderColor: "var(--o-copper)" },
  amber: { color: "var(--o-copper-text)", borderColor: "var(--o-copper-text)" },
  green: { color: "var(--o-shallow)", borderColor: "var(--o-shallow)" },
};

export function LevelChip({ level, label }: { level: Level; label?: string }) {
  return <span className="o-chip" style={{ ...LEVEL_STYLE[level], flex: "none" }}>{label ?? LEVEL_LABEL[level]}</span>;
}

export function AssignSelect({ id, fallback }: { id: string; fallback?: string }) {
  const { state, update } = useAppState();
  const value = state.assign[id] ?? fallback ?? TEAM[0].id;
  return (
    <label className="o-small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      With
      <select
        value={value}
        onChange={(e) => update((s) => ({ ...s, assign: { ...s.assign, [id]: e.target.value } }))}
        style={{ font: "500 15px var(--font-sans), sans-serif", color: "var(--o-head)", background: "transparent", border: 0, borderBottom: "1.5px solid var(--o-outline)", padding: "2px 2px", cursor: "pointer" }}
        aria-label="Assign to"
      >
        {TEAM.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
  );
}

/** Owner-facing: the named person behind the app. Owners are never stuck with the assistant. */
export function ManagerCard({ pmId, compact }: { pmId: string; compact?: boolean }) {
  const pm = member(pmId);
  return (
    <section className="o-boxed" style={{ background: "var(--o-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="o-label">Your property manager</span>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <span aria-hidden style={{ width: 56, height: 78, borderRadius: "28px 28px 4px 4px", background: "var(--o-shallow)", color: "#F1EBD9", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 22, flex: "none" }}>{pm.initials}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 19 }}>{pm.name}</div>
          <a href={`tel:${pm.phone.replace(/\s/g, "")}`} className="o-small" style={{ display: "block", color: "var(--o-body)" }}>{pm.phone}</a>
          <a href={`mailto:${pm.email}`} className="o-small" style={{ display: "block", color: "var(--o-body)" }}>{pm.email}</a>
        </div>
      </div>
      <a href={`tel:${pm.phone.replace(/\s/g, "")}`} className="o-btn o-btn-green" style={{ fontSize: 17, padding: 15 }}>Contact my property manager</a>
      {!compact && <p className="o-small">A real person, 8am – 10pm every day. You&rsquo;ll always get {pm.name}, or someone who knows your place.</p>}
    </section>
  );
}
