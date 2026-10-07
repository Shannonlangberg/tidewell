"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Header } from "@/components/app/Header";
import { useAppState } from "@/components/app/useAppState";
import { JOBS, money, property, type CleanJob, type TradeJob } from "@/lib/demo";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { ready } = useAppState();
  const job = JOBS.find((j) => j.id === id);
  const back = { href: "/app/crew", label: "Jobs" };
  if (!ready) return <Header back={back} />;
  if (!job) return (<><Header back={back} /><main className="o-main"><p className="o-status">We couldn&rsquo;t find that job.</p></main></>);
  return job.type === "clean" ? <Clean job={job} /> : <Trade job={job} />;
}

function Clean({ job }: { job: CleanJob }) {
  const router = useRouter();
  const { state, update } = useAppState();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const p = property(job.property);
  const done = state.photographed[job.id] ?? [];
  const finished = state.jobsDone.includes(job.id);
  const left = p.rooms.filter((r) => !done.includes(r));
  const note = state.handover[job.id] ?? "";

  const snap = (room: string, file?: File) => {
    if (!file) return;
    setThumbs((t) => ({ ...t, [room]: URL.createObjectURL(file) }));
    update((s) => ({ ...s, photographed: { ...s.photographed, [job.id]: [...new Set([...(s.photographed[job.id] ?? []), room])] } }));
  };

  return (
    <>
      <Header back={{ href: "/app/crew", label: "Jobs" }} />
      <main className="o-main" style={{ gap: 22 }}>
        <div>
          <p className="o-label" style={{ color: finished ? "var(--o-shallow)" : "var(--o-copper-text)" }}>{finished ? "Done" : `Turnover · ${job.window}`}</p>
          <h1 className="o-title" style={{ marginTop: 10, fontSize: 30 }}>{p.name}</h1>
          <p className="o-small" style={{ marginTop: 6, color: "var(--o-body)" }}>{job.guestsOut} · {job.guestsIn}</p>
        </div>
        {job.notes && <p className="o-p" style={{ borderLeft: "3px solid var(--o-copper)", paddingLeft: 12 }}>{job.notes}</p>}

        <section>
          <div className="o-row-head">
            <span className="o-label">A photo of every room</span>
            <span className="o-small" style={{ color: left.length ? "var(--o-copper-text)" : "var(--o-shallow)" }}>{p.rooms.length - left.length} of {p.rooms.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {p.rooms.map((room) => {
              const has = done.includes(room);
              return (
                <label key={room} style={{ cursor: finished ? "default" : "pointer" }}>
                  <div
                    className={has && !thumbs[room] ? "" : "o-ph"}
                    style={{
                      aspectRatio: "1",
                      borderRadius: 4,
                      position: "relative",
                      background: thumbs[room] ? `center/cover url(${thumbs[room]})` : has ? "var(--o-shallow)" : undefined,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: has ? "#F1EBD9" : "var(--o-muted)",
                      fontSize: 26,
                    }}
                  >
                    {has ? (thumbs[room] ? "" : "✓") : "+"}
                  </div>
                  <span style={{ display: "block", marginTop: 5, fontSize: 15, color: has ? "var(--o-shallow)" : "var(--o-text)" }}>{room}</span>
                  {!finished && <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => snap(room, e.target.files?.[0])} />}
                </label>
              );
            })}
          </div>
        </section>

        <div>
          <label className="o-label" htmlFor="note" style={{ display: "block", marginBottom: 8 }}>Note for the owner</label>
          <textarea
            id="note"
            className="o-textarea"
            value={note}
            disabled={finished}
            onChange={(e) => update((s) => ({ ...s, handover: { ...s.handover, [job.id]: e.target.value } }))}
            placeholder="All good. Left the fan on in the back room, it was humid."
          />
        </div>

        {!finished && (
          <>
            <button
              className="o-btn o-btn-copper"
              disabled={left.length > 0}
              style={left.length ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
              onClick={() => {
                update((s) => ({ ...s, jobsDone: [...s.jobsDone, job.id] }));
                router.push("/app/crew");
              }}
            >
              {left.length ? `${left.length} room${left.length === 1 ? "" : "s"} still to photograph` : `Done — ${money(job.pay, false)}`}
            </button>
            <a href="sms:+61417604882" className="o-btn o-btn-outline">Something&rsquo;s broken</a>
          </>
        )}
        {finished && <p className="o-p o-good">Done. The owner has the photos and your note.</p>}
      </main>
    </>
  );
}

function Trade({ job }: { job: TradeJob }) {
  const router = useRouter();
  const { state, update } = useAppState();
  const [amount, setAmount] = useState(job.quote ? String(job.quote) : "");
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const p = property(job.property);
  const finished = state.jobsDone.includes(job.id);
  const quoting = job.stage === "quote";

  return (
    <>
      <Header back={{ href: "/app/crew", label: "Jobs" }} />
      <main className="o-main" style={{ gap: 20 }}>
        <div>
          <p className="o-label" style={{ color: "var(--o-copper-text)" }}>{quoting ? "Needs a quote" : "Booked"} · {job.window}</p>
          <h1 className="o-title" style={{ marginTop: 10, fontSize: 30 }}>{job.title}</h1>
          <p className="o-small" style={{ marginTop: 6, color: "var(--o-body)" }}>{p.name}, {p.town}</p>
        </div>
        <p className="o-p">{job.brief}</p>

        <div style={{ display: "flex", gap: 6 }}>
          {([["Before", before, setBefore], ["After", after, setAfter]] as const).map(([label, img, set]) => (
            <label key={label} style={{ flex: 1, cursor: "pointer" }}>
              <div className="o-ph" style={{ aspectRatio: "3/4", background: img ? `center/cover url(${img})` : undefined }}>{img ? "" : `+ ${label.toLowerCase()} photo`}</div>
              {!finished && <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) set(URL.createObjectURL(f)); }} />}
            </label>
          ))}
        </div>

        {!finished ? (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              update((s) => ({ ...s, jobsDone: [...s.jobsDone, job.id] }));
              router.push("/app/crew");
            }}
          >
            <label className="o-label" htmlFor="amt">{quoting ? "Your quote, inc GST" : "Invoice, inc GST"}</label>
            <input id="amt" inputMode="decimal" className="o-textarea" style={{ minHeight: 0, fontSize: 22, fontWeight: 600 }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="$0" required />
            <p className="o-small">{quoting ? "Over $150 goes to the owner before you start. We'll tell you the minute they say yes." : "Paid within seven days of the after photo."}</p>
            <button className="o-btn o-btn-copper" type="submit">{quoting ? `Send quote${amount ? ` — ${money(Number(amount), false)}` : ""}` : `Send invoice${amount ? ` — ${money(Number(amount), false)}` : ""}`}</button>
          </form>
        ) : (
          <p className="o-p o-good">{quoting ? "Quote sent. We'll let you know." : "Invoice sent. Thanks."}</p>
        )}
      </main>
    </>
  );
}
