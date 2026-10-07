"use client";

import { useState } from "react";

const SERVICES = ["Just bought", "Short-stay", "Long-term", "Property care", "Setup only", "Not sure yet"] as const;
const EMAIL = "hello@tidewell.com.au";

/**
 * No backend yet — submitting opens the visitor's email app with the enquiry filled in.
 * Swap for a real endpoint when there is one.
 */
export function EnquiryForm() {
  const [service, setService] = useState<string>("Short-stay");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const address = String(data.get("address") ?? "").trim();
    const notes = String(data.get("notes") ?? "").trim();
    const subject = `${service} — ${address || "my place"}`;
    const body = [`Name: ${name}`, `Address: ${address}`, `After: ${service}`, "", notes].join("\n");
    window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="card card-light"
      style={{ gap: 18, padding: "clamp(24px,3vw,34px)" }}
    >
      <div>
        <label className="field-label" htmlFor="name">Your name</label>
        <input className="input" id="name" name="name" autoComplete="name" placeholder="Jane Pelham" required />
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
        <label className="field-label" htmlFor="notes">Anything we should know</label>
        <textarea className="input" id="notes" name="notes" placeholder="Three bedrooms, one bathroom. We use it at Christmas and over Easter." />
      </div>
      <button type="submit" className="btn btn-copper">Send it — we&rsquo;ll reply inside the hour</button>
    </form>
  );
}
