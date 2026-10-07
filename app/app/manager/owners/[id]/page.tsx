"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Header } from "@/components/app/Header";
import { AssignSelect, LevelChip } from "@/components/app/HumanTouchBits";
import { useAppState } from "@/components/app/useAppState";
import { money, property } from "@/lib/demo";
import {
  CADENCE_DAYS, HEALTH_LABEL, INTERACTION_TYPES, NEW_OWNER_PLAN, TEAM,
  lastHuman, member, nextInteraction, ownerProfile, ownerTasks, relationshipHealth,
  type Cadence, type InteractionType, type OwnerProfile,
} from "@/lib/humanTouch";
import { allLogs } from "@/lib/humanTouchState";

export default function OwnerRelationship() {
  const { id } = useParams<{ id: string }>();
  const { state, ready, update } = useAppState();
  const [brief, setBrief] = useState(false);
  const [logging, setLogging] = useState(false);
  const back = { href: "/app/manager/owners", label: "Owners" };
  const base = ownerProfile(id);
  if (!ready) return <Header back={back} />;
  if (!base) return (<><Header back={back} /><main className="o-main"><p className="o-status">We couldn&rsquo;t find that owner.</p></main></>);

  const o: OwnerProfile = { ...base, cadence: (state.cadence[base.id] as Cadence) ?? base.cadence };
  const logs = allLogs(state).filter((l) => l.owner === o.id);
  const handled = [...state.handled, ...(state.approved.includes("shower-screen") ? ["jane:overThreshold"] : [])];
  const tasks = ownerTasks(o, state.triggers, allLogs(state), handled);
  const health = relationshipHealth(o);
  const since = lastHuman(o, allLogs(state));
  const next = nextInteraction(o, allLogs(state));
  const pm = member(state.assign[`pm:${o.id}`] ?? o.pm);
  const p = property(o.property);

  return (
    <>
      <Header back={back} />
      <main className="o-main">
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <LevelChip level={health.level} label={HEALTH_LABEL[health.level]} />
          </div>
          <h1 className="o-title" style={{ marginTop: 12 }}>{o.name.toLowerCase()}</h1>
          <p className="o-status" style={{ fontSize: 17 }}>
            {p.name}, {p.town}. Last spoke to a person {since === 0 ? "today" : `${since} days ago`}. Next: {next.what.toLowerCase()} {next.inDays <= 0 ? "— due now" : `in ${next.inDays} days`}.
          </p>
        </div>

        {tasks.map((t) => (
          <section key={t.id} className="o-flood">
            <div className="o-row-head" style={{ margin: 0 }}>
              <span className="o-label">Human follow-up recommended</span>
              <LevelChip level={t.level} />
            </div>
            <p style={{ fontWeight: 600, fontSize: 17 }}>{t.reason}</p>
            <div>
              <p style={{ fontSize: 15, color: "var(--o-flood-muted)" }}>Talk about</p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--o-flood-body)", fontSize: 15, lineHeight: 1.5 }}>
                {t.points.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            <p style={{ fontSize: 15, color: "var(--o-flood-body)" }}>Best by: <strong style={{ color: "var(--o-flood-text)" }}>{t.method}</strong> — their preference</p>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              <button className="o-btn o-btn-copper o-btn-sm" onClick={() => { setBrief(true); setLogging(true); }}>Prepare me, then log it</button>
            </div>
          </section>
        ))}

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className={brief ? "o-btn o-btn-outline" : "o-btn o-btn-green"} onClick={() => setBrief((b) => !b)}>{brief ? "Hide the briefing" : "Prepare me"}</button>
          {brief && <Briefing o={o} since={since} />}
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="o-label">Assigned property manager</span>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span>
              <span style={{ display: "block", fontWeight: 600, fontSize: 19 }}>{pm.name}</span>
              <span className="o-small">{pm.phone} · {pm.email}</span>
            </span>
            <AssignSelect id={`pm:${o.id}`} fallback={o.pm} />
          </div>
          <div className="o-table">
            <div><span style={{ color: "var(--o-body)" }}>Prefers</span><span style={{ fontWeight: 500 }}>{o.method}</span></div>
            <div><span style={{ color: "var(--o-body)" }}>Call before repairs over</span><span style={{ fontWeight: 500 }}>{money(o.callOver, false)}</span></div>
            <div><span style={{ color: "var(--o-body)" }}>Last human contact</span><span style={{ fontWeight: 500 }}>{since} days ago</span></div>
          </div>
          <div>
            <p className="o-label" style={{ marginBottom: 8 }}>How they like to hear from us</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {o.prefs.map((x) => <span key={x} className="o-chip" style={{ textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-sans)", fontSize: 15 }}>{x}</span>)}
            </div>
            <p className="o-small" style={{ marginTop: 8 }}>The assistant checks these before it sends anything to {o.first}. If a message would break one, it comes to a person instead.</p>
          </div>
          <div>
            <p className="o-label" style={{ marginBottom: 8 }}>Notes</p>
            <p className="o-p">{o.notes}</p>
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="o-label">Personal contact rhythm</span>
          <div className="o-seg" role="group" aria-label="Contact rhythm">
            {(Object.keys(CADENCE_DAYS) as Cadence[]).map((c) => (
              <button key={c} style={{ fontSize: 15 }} aria-pressed={o.cadence === c} onClick={() => update((s) => ({ ...s, cadence: { ...s.cadence, [o.id]: c } }))}>{c.replace(" check-in", "").replace("Every ", "")}</button>
            ))}
          </div>
          {o.startedDaysAgo < 100 && (
            <div className="o-list" style={{ marginTop: 6 }}>
              {NEW_OWNER_PLAN.map((s) => {
                const done = o.startedDaysAgo >= s.day && logs.some((l) => o.startedDaysAgo - l.daysAgo >= s.day - 2);
                const due = s.day - o.startedDaysAgo;
                return (
                  <div key={s.day} style={{ padding: "10px 0", display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span className="o-p">Day {s.day} · {s.what}</span>
                    <span className="o-small" style={{ color: done ? "var(--o-shallow)" : due <= 1 ? "var(--o-copper-text)" : undefined }}>{done ? "✓" : due <= 0 ? "due" : `in ${due}d`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="o-row-head" style={{ margin: 0 }}>
            <span className="o-label">Human contact</span>
            {!logging && <button className="o-link" style={{ fontSize: 15 }} onClick={() => setLogging(true)}>Log a conversation</button>}
          </div>
          {logging && <LogForm owner={o} taskIds={tasks.map((t) => t.id)} onDone={() => setLogging(false)} />}
          <div className="o-list">
            {logs.map((l) => (
              <div key={l.id} style={{ padding: "12px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{l.type}</span>
                  <span className="o-small">{l.daysAgo === 0 ? "today" : `${l.daysAgo} days ago`} · {member(l.by).name}</span>
                </div>
                <p className="o-small" style={{ color: "var(--o-body)" }}>{l.notes}</p>
                {l.followUp !== undefined && <p className="o-small" style={{ color: "var(--o-copper-text)" }}>Follow up in {Math.max(0, l.followUp - l.daysAgo)} days</p>}
              </div>
            ))}
          </div>
          <p className="o-small">Notes are kept exactly as written. Summaries never change what was said.</p>
        </section>
      </main>
    </>
  );
}

function LogForm({ owner, taskIds, onDone }: { owner: OwnerProfile; taskIds: string[]; onDone: () => void }) {
  const { update } = useAppState();
  const [type, setType] = useState<InteractionType>("Phone call");
  const [by, setBy] = useState(owner.pm);
  const [notes, setNotes] = useState("");
  const [follow, setFollow] = useState(false);
  const [followDays, setFollowDays] = useState(14);

  return (
    <form
      className="o-boxed"
      style={{ background: "var(--o-raised)", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!notes.trim()) return;
        update((s) => ({
          ...s,
          logs: [{ id: String(Date.now()), owner: owner.id, daysAgo: 0, by, type, notes: notes.trim(), followUp: follow ? followDays : undefined, proactive: true }, ...s.logs],
          handled: [...s.handled, ...taskIds.flatMap((id) => id.split("+"))],
        }));
        onDone();
      }}
    >
      <label className="o-label" htmlFor="lt">How</label>
      <select id="lt" className="o-textarea" style={{ minHeight: 0 }} value={type} onChange={(e) => setType(e.target.value as InteractionType)}>
        {INTERACTION_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      <label className="o-label" htmlFor="lb">Who</label>
      <select id="lb" className="o-textarea" style={{ minHeight: 0 }} value={by} onChange={(e) => setBy(e.target.value)}>
        {TEAM.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <label className="o-label" htmlFor="ln">Short notes</label>
      <textarea id="ln" className="o-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Talked through the cleaning change. Happy now. Wants a call before Christmas." required />
      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 17 }}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} style={{ width: 20, height: 20, accentColor: "var(--o-shallow)" }} />
        Follow-up needed
      </label>
      {follow && (
        <div className="o-seg" role="group" aria-label="Follow up in">
          {[7, 14, 30].map((d) => <button type="button" key={d} aria-pressed={followDays === d} onClick={() => setFollowDays(d)}>{d} days</button>)}
        </div>
      )}
      {taskIds.length > 0 && <p className="o-small">Logging this clears the recommended follow-up above.</p>}
      <div style={{ display: "flex", gap: 9 }}>
        <button className="o-btn o-btn-copper o-btn-sm" type="submit">Save</button>
        <button className="o-btn o-btn-outline o-btn-sm" type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function Briefing({ o, since }: { o: OwnerProfile; since: number }) {
  const open = o.maintenance.filter((m) => m.open);
  const lows = o.feedback.filter((f) => f.stars <= 4);
  const topics = [
    o.revenueChangePct ? `Revenue is ${o.revenueChangePct > 0 ? "up" : "down"} ${Math.abs(o.revenueChangePct)}% on the same month last year${o.cancellations[0] ? ` — mostly the cancellation (${o.cancellations[0].text.split(" — ")[0].toLowerCase()})` : ""}.` : "Revenue is steady.",
    ...open.map((m) => `${m.text}.`),
    ...(lows.length >= 2 ? [`${lows.length} recent guests mentioned the same thing: "${lows[lows.length - 1].text}"`] : lows.map((f) => `A ${f.stars}-star review: "${f.text}"`)),
    ...o.opportunities,
  ].slice(0, 5);

  return (
    <div className="o-boxed" style={{ background: "var(--o-raised)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="o-label">Before you call {o.first}</span>
      <div className="o-table" style={{ background: "var(--o-bg)" }}>
        <div><span style={{ color: "var(--o-body)" }}>This month</span><span style={{ fontWeight: 500 }}>{money(o.revenueMonth)}{o.revenueChangePct ? ` (${o.revenueChangePct > 0 ? "+" : ""}${o.revenueChangePct}%)` : ""}</span></div>
        {property(o.property).kind === "short-stay" ? (
          <>
            <div><span style={{ color: "var(--o-body)" }}>Next 14 nights</span><span style={{ fontWeight: 500 }}>{o.occupancy14} booked</span></div>
            <div><span style={{ color: "var(--o-body)" }}>Upcoming bookings</span><span style={{ fontWeight: 500 }}>{o.upcomingBookings}</span></div>
          </>
        ) : (
          <div><span style={{ color: "var(--o-body)" }}>Tenancy</span><span style={{ fontWeight: 500 }}>Rent up to date</span></div>
        )}
        <div><span style={{ color: "var(--o-body)" }}>Since last contact</span><span style={{ fontWeight: 500 }}>{since} days</span></div>
      </div>
      {o.concerns.length > 0 && (
        <div>
          <p className="o-small" style={{ fontWeight: 500, color: "var(--o-text)" }}>What they&rsquo;ve raised before</p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} className="o-small">{o.concerns.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      <div>
        <p className="o-small" style={{ fontWeight: 500, color: "var(--o-text)" }}>Suggested topics</p>
        <ol style={{ margin: "6px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {topics.map((t) => <li key={t} className="o-p" style={{ fontSize: 17, lineHeight: 1.45 }}>{t}</li>)}
        </ol>
      </div>
      <p className="o-small">Put together from their numbers, jobs, reviews and past notes. Check it before you rely on it.</p>
    </div>
  );
}
