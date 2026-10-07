"use client";

import { useRef, useState } from "react";
import { SITE, telHref } from "@/lib/site";

const FORM_NAME = "enquiry";
const SUBURBS = [...SITE.towns, "Somewhere else on the Copper Coast"];
const BEDROOMS = ["1", "2", "3", "4", "5 or more"];

type Status = "idle" | "sending" | "sent" | "failed";

/**
 * Submits to Netlify Forms. Netlify detects the form from public/__forms.html at deploy time,
 * so the POST goes to that static file. Without JavaScript the form posts normally and Netlify
 * redirects to /thanks. Locally (no Netlify) the fetch fails and the form says so.
 */
export function EnquiryForm() {
  const [status, setStatus] = useState<Status>("idle");
  const sentRef = useRef<HTMLDivElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const data = new FormData(e.currentTarget);
    data.set("form-name", FORM_NAME);
    try {
      const res = await fetch("/__forms.html", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(data as unknown as Record<string, string>).toString(),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      requestAnimationFrame(() => sentRef.current?.focus());
    } catch {
      setStatus("failed");
    }
  }

  if (status === "sent") {
    return (
      <div
        ref={sentRef}
        tabIndex={-1}
        role="status"
        className="card card-light"
        style={{ gap: 14, padding: "clamp(24px,3vw,34px)" }}
      >
        <h3 className="display card-title">thank you.</h3>
        <p className="body">We&rsquo;ve got your enquiry. A person will be back to you inside the hour, between 8am and 10pm. If it&rsquo;s later than that, first thing in the morning.</p>
        {SITE.phone && <p className="small">Can&rsquo;t wait? Ring <a href={telHref(SITE.phone)}>{SITE.phone}</a>.</p>}
      </div>
    );
  }

  return (
    <form
      name={FORM_NAME}
      method="POST"
      action="/thanks"
      data-netlify="true"
      netlify-honeypot="bot-field"
      onSubmit={onSubmit}
      className="card card-light"
      style={{ gap: 18, padding: "clamp(24px,3vw,34px)" }}
    >
      <input type="hidden" name="form-name" value={FORM_NAME} />
      <p hidden>
        <label>Leave this empty <input type="text" name="bot-field" tabIndex={-1} autoComplete="off" /></label>
      </p>
      <div>
        <label className="field-label" htmlFor="name">Your name</label>
        <input className="input" id="name" name="name" autoComplete="name" required />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 18 }}>
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="field-label" htmlFor="phone">
            Phone <span style={{ fontWeight: 400, color: "var(--driftwood)" }}>(optional)</span>
          </label>
          <input className="input" id="phone" name="phone" type="tel" autoComplete="tel" />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 18 }}>
        <div>
          <label className="field-label" htmlFor="suburb">Suburb</label>
          <select className="input" id="suburb" name="suburb" defaultValue="" required>
            <option value="" disabled>Choose one</option>
            {SUBURBS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="bedrooms">Bedrooms</label>
          <select className="input" id="bedrooms" name="bedrooms" defaultValue="" required>
            <option value="" disabled>Choose one</option>
            {BEDROOMS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="field-label" htmlFor="message">Message</label>
        <textarea className="input" id="message" name="message" />
      </div>
      <button type="submit" className="btn btn-copper" disabled={status === "sending"} style={status === "sending" ? { opacity: 0.6 } : undefined}>
        {status === "sending" ? "Sending…" : "Send enquiry"}
      </button>
      {status === "failed" && (
        <p role="alert" className="small" style={{ color: "var(--copper-deep)" }}>
          That didn&rsquo;t send. Please try again in a moment
          {SITE.phone && <>, or ring <a href={telHref(SITE.phone)}>{SITE.phone}</a></>}
          {SITE.email && <> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a></>}.
        </p>
      )}
    </form>
  );
}
