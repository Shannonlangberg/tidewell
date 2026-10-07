"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/app/Header";
import { EMPTY, useAppState, type AppState } from "@/components/app/useAppState";
import { OWNER, PEOPLE, ROLE_LABEL, property } from "@/lib/demo";
import { ManagerCard } from "@/components/app/HumanTouchBits";
import { ownerProfile } from "@/lib/humanTouch";
import { SITE, telHref } from "@/lib/site";

export default function More() {
  const router = useRouter();
  const { state, ready, update } = useAppState();
  if (!ready) return <Header />;

  const me = PEOPLE.find((p) => p.id === state.person) ?? PEOPLE[0];
  const setTheme = (theme: AppState["theme"]) => update((s) => ({ ...s, theme }));
  const blurb =
    me.role === "owner"
      ? `Owner of ${property(me.property).name}. Anything over $${OWNER.threshold} waits for your yes.`
      : me.role === "tenant"
        ? `Renting ${property(me.property).name}, ${property(me.property).town}.`
        : me.role === "crew"
          ? me.kind === "tradie" ? "Trade jobs: quote, photos, invoice." : "Cleans: a photo of every room, then done."
          : "Every home, every message, every job.";

  return (
    <>
      <Header />
      <main className="o-main">
        <div>
          <h1 className="o-title">{me.name.toLowerCase()}</h1>
          <p className="o-status" style={{ fontSize: 17 }}>{blurb}</p>
        </div>

        {me.role === "manager" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <p className="o-label" style={{ marginBottom: 12 }}>Running the business</p>
            <div className="o-list">
              {[
                ["/app/manager/human-touch", "Human touch", "Who needs a person, and how we're doing"],
                ["/app/manager/owners", "Owners & pipeline", "Relationships, preferences, who's thinking about it"],
                ["/app/manager/money", "Money", "Month close: statements, reconciled"],
              ].map(([href, t, s]) => (
                <Link key={href} href={href} style={{ padding: "15px 0", display: "flex", justifyContent: "space-between", gap: 12, color: "inherit" }}>
                  <span><span style={{ display: "block", fontWeight: 600, fontSize: 19 }}>{t}</span><span className="o-small">{s}</span></span>
                  <span className="o-small" style={{ alignSelf: "center" }}>›</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {me.role === "owner" && <ManagerCard pmId={ownerProfile("jane")?.pm ?? "court"} compact />}

        {me.role !== "manager" && me.role !== "owner" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="o-label">Talk to us</p>
            <p className="o-small">A person answers inside the hour, 8am – 10pm, every day.{me.role === "tenant" ? " Urgent repairs, any hour." : ""}</p>
            {(SITE.phone || SITE.email) ? (
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                {SITE.phone && <a href={telHref(SITE.phone)} className="o-btn o-btn-green o-btn-sm">Call</a>}
                {SITE.phone && <a href={telHref(SITE.phone).replace("tel:", "sms:")} className="o-btn o-btn-outline o-btn-sm">Text</a>}
                {SITE.email && <a href={`mailto:${SITE.email}`} className="o-btn o-btn-outline o-btn-sm">Email</a>}
              </div>
            ) : (
              <p className="o-small">(Demo: contact details are added at launch.)</p>
            )}
          </section>
        )}

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="o-label">Appearance</p>
          <div className="o-seg" role="group" aria-label="Appearance">
            {(["auto", "light", "dark"] as const).map((t) => (
              <button key={t} aria-pressed={state.theme === t} onClick={() => setTheme(t)}>{t === "auto" ? "Match phone" : t === "light" ? "Light" : "Dark"}</button>
            ))}
          </div>
        </section>

        {me.role === "owner" && (
          <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="o-label">Demo season</p>
            <div className="o-seg" role="group" aria-label="Demo season">
              <button aria-pressed={!state.quiet} onClick={() => update((s) => ({ ...s, quiet: false }))}>Busy fortnight</button>
              <button aria-pressed={state.quiet} onClick={() => update((s) => ({ ...s, quiet: true }))}>Quiet season</button>
            </div>
          </section>
        )}

        <section className="o-sep" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="o-label">Demo · switch person</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PEOPLE.filter((p) => p.id !== me.id).map((p) => (
              <button
                key={p.id}
                className="o-btn o-btn-outline o-btn-sm"
                style={{ fontSize: 15, padding: "10px 16px" }}
                onClick={() => {
                  update((s) => ({ ...s, person: p.id }));
                  router.push(`/app/${p.role}`);
                }}
              >
                {p.first.charAt(0).toUpperCase() + p.first.slice(1)} · {ROLE_LABEL[p.role]}
              </button>
            ))}
          </div>
          <button className="o-link" style={{ alignSelf: "flex-start", fontSize: 15 }} onClick={() => update((s) => ({ ...EMPTY, person: s.person, theme: s.theme }))}>
            Reset the demo
          </button>
        </section>

        <section className="o-sep" style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <button
            className="o-link"
            style={{ fontSize: 15 }}
            onClick={() => {
              update((s) => ({ ...s, person: null }));
              router.push("/app");
            }}
          >
            Sign out
          </button>
          <Link href="/" className="o-link" style={{ fontSize: 15 }}>tidewell.com.au</Link>
        </section>
      </main>
    </>
  );
}
