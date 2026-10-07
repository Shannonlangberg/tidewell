import type { Metadata } from "next";
import { Mark } from "@/components/Mark";
import { SITE, telHref } from "@/lib/site";

export const metadata: Metadata = {
  title: "Thank you: Tidewell",
  robots: { index: false, follow: false },
};

/** Where Netlify sends the enquiry form when JavaScript isn't running. */
export default function Thanks() {
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="Tidewell, back to the home page">
            <Mark width={23} fill="var(--copper)" hole="var(--verdigris)" />
            <span className="wordmark" style={{ fontSize: 27 }}>tidewell</span>
          </a>
        </div>
      </header>

      <main className="wrap" style={{ minHeight: "50vh" }}>
        <h1 className="display h2">thank you.</h1>
        <p className="body" style={{ marginTop: 20, maxWidth: 520 }}>
          We&rsquo;ve got your enquiry. A person will be back to you inside the hour, between 8am
          and 10pm. If it&rsquo;s later than that, first thing in the morning.
        </p>
        {SITE.phone && (
          <p className="small" style={{ marginTop: 12 }}>
            Can&rsquo;t wait? Ring <a href={telHref(SITE.phone)}>{SITE.phone}</a>.
          </p>
        )}
        <p style={{ marginTop: 28 }}><a href="/" className="link-rule">Back to the home page</a></p>
      </main>

      <footer style={{ background: "var(--deep)", color: "var(--sea-mist)" }}>
        <div style={{ maxWidth: "var(--max)", margin: "0 auto", padding: "clamp(28px,3vw,44px) var(--gutter)", fontSize: 15 }}>
          <p style={{ color: "var(--muted-on-dark)" }}>{SITE.tagline}</p>
          <p style={{ marginTop: 4, color: "var(--body-on-dark)" }}>{SITE.region}</p>
        </div>
      </footer>
    </>
  );
}
