"use client";

import { useState } from "react";

const SERVICES = ["Just bought", "Short-stay", "Long-term", "Property care", "Setup only", "Not sure yet"] as const;
const FORM_NAME = "enquiry";

type Status = "idle" | "sending" | "sent" | "failed";

/**
 * Submits to Netlify Forms. Netlify detects the form from public/__forms.html at deploy time,
 * so the POST goes to that static file. Locally (no Netlify) it fails and says so.
 */
export function EnquiryForm() {
  const [service, setService] = useState<string>("Short-stay");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const data = new FormData(e.currentTarget);
    data.set("form-name", FORM_NAME);
    data.set("service", service);
    try {
      const res = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(data as unknown as Record<string, string>).toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
    } catch {
      setStatus("failed");
    }
  }

  if (status === "sent") {
    return (
      <div className="card card-light" style={{ gap: 14, padding: "clamp(24px,3vw,34px)" }}>
        <h3 className="display card-title">got it.</h3>
        <p className="body">Thanks — a person will be back to you inside the hour, between 8am and 10pm. If it&rsquo;s later than that, first thing in the morning.</p>
        <p className="small">Can&rsquo;t wait? Ring <a href="tel:+61417604882">0417 604 882</a>.</p>
      </div>
    );
  }

  return (
    <form
      name={FORM_NAME}
      onSubmit={onSubmit}
      className="card card-light"
      style={{ gap: 18, padding: "clamp(24px,3vw,34px)" }}
    >
      <input type="hidden" name="form-name" value={FORM_NAME} />
      <p hidden>
        <label>Leave this empty <input name="bot-field" tabIndex={-1} autoComplete="off" /></label>
      </p>
      <div>
        <label className="field-label" htmlFor="name">Your name</label>
        <input className="input" id="name" name="name" autoComplete="name" placeholder="Jane Pelham" required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 18 }}>
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" placeholder="jane@example.com" required />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">Phone <span style={{ fontWeight: 400, color: "var(--driftwood)" }}>(if you&rsquo;d rather we ring)</span></label>
          <input className="input" id="phone" name="phone" type="tel" autoComplete="tel" placeholder="0400 000 000" />
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="address">The address</label>
        <input className="input" id="address" name="address" autoComplete="street-address" placeholder="12 Bayview Road, Moonta Bay" required />
      </div>
      <fieldset className="chips" style={{ display: "block" }}>
        <legend className="field-label">What are you after?</legend>
        <div className="chips">
          {SERVICES.map((s) => (
            <label key={s} className="chip">
              <input type="radio" name="service" value={s} checked={service === s} onChange={() => setService(s)} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="field-label" htmlFor="message">Anything we should know</label>
        <textarea className="input" id="message" name="message" placeholder="Three bedrooms, one bathroom. We use it at Christmas and over Easter." />
      </div>
      <button type="submit" className="btn btn-copper" disabled={status === "sending"} style={status === "sending" ? { opacity: 0.6 } : undefined}>
        {status === "sending" ? "Sending…" : "Send it — we’ll reply inside the hour"}
      </button>
      {status === "failed" && (
        <p role="alert" className="small" style={{ color: "var(--copper-deep)" }}>
          That didn&rsquo;t send. Please ring <a href="tel:+61417604882">0417 604 882</a> or email <a href="mailto:hello@tidewell.com.au">hello@tidewell.com.au</a> — or try again.
        </p>
      )}
    </form>
  );
}
