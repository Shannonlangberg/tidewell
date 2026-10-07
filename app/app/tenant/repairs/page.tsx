"use client";

import { useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { TENANT_REPAIRS } from "@/lib/demo";
import { SITE } from "@/lib/site";

export default function TenantRepairs() {
  const { state, ready, update } = useAppState();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (!ready) return <Header />;

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">report a repair</h1>
          <p className="o-status">Tell us what&rsquo;s wrong and send a photo if you can. A person replies inside the hour.</p>
        </div>

        {sent ? (
          <div className="o-boxed" style={{ padding: 16, background: "var(--o-raised)" }}>
            <p className="o-p o-good">Sent. We&rsquo;ll be back to you inside the hour.</p>
            <p className="o-small" style={{ marginTop: 6 }}>(Demo — nothing was actually sent.)</p>
            <button className="o-link" style={{ marginTop: 12, fontSize: 15 }} onClick={() => setSent(false)}>Report something else</button>
          </div>
        ) : (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              update((s) => ({ ...s, reports: [{ id: String(Date.now()), title: title.trim(), detail: detail.trim(), urgent, at: Date.now() }, ...s.reports] }));
              setTitle(""); setDetail(""); setUrgent(false); setPhoto(null); setSent(true);
            }}
          >
            <div>
              <label className="o-label" htmlFor="t" style={{ display: "block", marginBottom: 8 }}>What&rsquo;s wrong</label>
              <input id="t" className="o-textarea" style={{ minHeight: 0 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bathroom fan stopped working" required />
            </div>
            <div>
              <label className="o-label" htmlFor="d" style={{ display: "block", marginBottom: 8 }}>Anything else</label>
              <textarea id="d" className="o-textarea" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="When it started, what you've tried" />
            </div>
            <label className="o-btn o-btn-outline" style={{ cursor: "pointer" }}>
              {photo ? "Photo added ✓" : "Add a photo"}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(URL.createObjectURL(f)); }} />
            </label>
            {photo && <div style={{ aspectRatio: "4/3", background: `center/cover url(${photo})` }} />}
            <div className="o-seg" role="group" aria-label="How urgent">
              <button type="button" aria-pressed={!urgent} onClick={() => setUrgent(false)}>Can wait a few days</button>
              <button type="button" aria-pressed={urgent} onClick={() => setUrgent(true)}>Urgent</button>
            </div>
            {urgent && <p className="o-small" style={{ color: "var(--o-copper-text)" }}>If water, gas or power is involved, please ring as well{SITE.phone ? `: ${SITE.phone}, any hour.` : "."}</p>}
            <button className="o-btn o-btn-copper" type="submit">Send it</button>
          </form>
        )}

        <section className="o-sep">
          <p className="o-label" style={{ marginBottom: 12 }}>Yours so far</p>
          <div className="o-list">
            {state.reports.map((r) => (
              <div key={r.id} style={{ padding: "13px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{r.title}</span>
                  <span className="o-small" style={{ color: "var(--o-copper-text)" }}>{r.urgent ? "Urgent · sent" : "Sent"}</span>
                </div>
                {r.detail && <p className="o-small">{r.detail}</p>}
              </div>
            ))}
            {TENANT_REPAIRS.map((r) => (
              <div key={r.id} style={{ padding: "13px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: 17 }}>{r.title}</span>
                  <span className={r.status === "Fixed" ? "o-small o-good" : "o-small"}>{r.status}</span>
                </div>
                <p className="o-small">{r.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
