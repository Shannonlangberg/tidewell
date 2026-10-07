"use client";

import { useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { ICAL_URL, LISTINGS, OWNER_CLEAN_COST, STAYS, cap, dayFrom, money, short, weekday, words, type Stay } from "@/lib/demo";

const BAR: Record<Stay["platform"], string> = {
  Airbnb: "var(--o-copper)",
  Stayz: "var(--o-shallow)",
  "Booking.com": "var(--o-head)",
  Direct: "var(--o-copper-text)",
  Owner: "var(--o-sunken)",
};

function synced(mins: number) {
  return mins < 60 ? `synced ${mins} minutes ago` : `last synced ${Math.round(mins / 60)} hours ago`;
}

export default function Bookings() {
  const { state, ready } = useAppState();
  const [copied, setCopied] = useState(false);
  if (!ready) return <Header />;
  const stays = state.quiet ? [] : STAYS;
  const upcoming = stays.filter((s) => s.startOffset + s.nights > 0);

  return (
    <>
      <Header side={<span className="o-header-side">Upcoming</span>} />
      <main className="o-main" style={{ gap: 22 }}>
        <div>
          <h1 className="o-title">{upcoming.length ? `${words(upcoming.length)} coming up` : "nothing booked yet"}</h1>
          <p className="o-status" style={{ fontSize: 17 }}>
            {upcoming.length
              ? `${cap(words(stays.filter((s) => s.platform !== "Owner" && s.startOffset < 30).reduce((a, s) => a + s.nights, 0)))} nights let in the next month. Codes go to guests the morning they arrive.`
              : "The calendar is open on every platform. We'll tell you the moment something lands."}
          </p>
        </div>

        {upcoming.length > 0 && (
          <div className="o-list">
            {upcoming.map((s) => {
              const start = dayFrom(s.startOffset);
              const end = dayFrom(s.startOffset + s.nights);
              const staying = s.startOffset <= 0;
              return (
                <div key={s.id} style={{ padding: "15px 0", display: "flex", gap: 13 }}>
                  <span style={{ width: 5, alignSelf: "stretch", flex: "none", background: BAR[s.platform] }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontWeight: 600, fontSize: 19 }}>{s.guest}</span>
                      {s.total ? <span style={{ fontWeight: 600, fontSize: 17 }}>{money(s.total)}</span> : <span className="o-small">No fee</span>}
                    </div>
                    <p className="o-small" style={{ marginTop: 4, color: "var(--o-body)" }}>
                      {short(start)} – {short(end)} · {s.nights} nights{s.guests ? ` · ${s.guests} guests` : ""}
                    </p>
                    {s.platform === "Owner" ? (
                      <p className="o-small" style={{ marginTop: 7 }}>Clean booked for {short(end)}, at cost — {money(OWNER_CLEAN_COST)}</p>
                    ) : (
                      <div style={{ marginTop: 7, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="o-chip">{s.platform}</span>
                        <span style={{ fontSize: 15, color: staying ? "var(--o-shallow)" : "var(--o-muted)" }}>
                          {staying ? "Staying now · code sent" : s.platform === "Direct" ? "No platform fee" : `Code sends ${weekday(start)}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <section id="block" className="o-boxed" style={{ padding: 16, background: "var(--o-raised)" }}>
          <p className="o-p">Want the place yourself?</p>
          <p className="o-small" style={{ marginTop: 4 }}>Tell us the dates and we&rsquo;ll close them on every platform. Your own stays have no fee — just the clean, at cost.</p>
          <a href="sms:+61417604882" className="o-btn o-btn-outline o-btn-sm" style={{ marginTop: 12 }}>Block some dates</a>
        </section>

        <section>
          <p className="o-label" style={{ marginBottom: 12 }}>Where they come from</p>
          <div className="o-list o-boxed" style={{ borderTop: 0, borderBottom: 0 }}>
            {LISTINGS.map((l) => {
              const stale = (l.syncedMinsAgo ?? 0) >= 60;
              return (
                <a key={l.platform} href={l.url} target="_blank" rel="noreferrer" style={{ padding: "14px 15px", display: "flex", alignItems: "center", gap: 12, color: "inherit" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 17 }}>{l.platform}</span>
                      {l.rating ? (
                        <span className="o-small" style={{ color: "var(--o-body)" }}>{l.rating} · {l.reviews} reviews</span>
                      ) : (
                        <span className="o-small o-good">No platform fee</span>
                      )}
                    </div>
                    <p className="o-small" style={{ marginTop: 4, color: stale ? "var(--o-copper-text)" : undefined }}>
                      {money(l.price, false)} a night · {l.syncedMinsAgo !== undefined ? synced(l.syncedMinsAgo) : "tidewell.com.au/bayview"}
                    </p>
                  </div>
                  <span className="o-link" style={{ fontSize: 15, flex: "none" }}>Open ↗</span>
                </a>
              );
            })}
          </div>
        </section>

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <p className="o-label">Your calendar</p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <span className="o-p">All four platforms, one calendar</span>
            <span className="o-small o-good">In sync</span>
          </div>
          <p className="o-small">Add it to the calendar on your phone and every booking, block and clean turns up there too. Read-only — changes are made here.</p>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 4 }}>
            <a href={ICAL_URL} className="o-btn o-btn-green o-btn-sm">Add to my calendar</a>
            <button
              className="o-btn o-btn-outline o-btn-sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(ICAL_URL);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard blocked — the link is shown below */
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p style={{ font: "400 13px var(--font-mono), monospace", color: "var(--o-muted)", wordBreak: "break-all" }}>{ICAL_URL}</p>
        </section>
      </main>
    </>
  );
}
