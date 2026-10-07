import type { Metadata } from "next";
import { Mark } from "@/components/Mark";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy: Tidewell",
  description: "What Tidewell does with the details you send through the enquiry form.",
};

/**
 * Draft. This describes what the site actually does today: the enquiry form posts to
 * Netlify Forms and nothing else is collected. Have it checked before launch, and add
 * the business details once they exist.
 */
export default function Privacy() {
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

      <main className="wrap">
        <h1 className="display h2">privacy</h1>
        <div className="prose">
          <p>
            This page explains what we do with the details you send us through this website.
          </p>

          <h2>What we collect</h2>
          <p>
            Only what you type into the enquiry form: your name, your email address, your phone
            number if you give it, the suburb and size of your house, and your message. Nothing
            else on this site collects information about you.
          </p>

          <h2>What we do with it</h2>
          <p>
            We use it to reply to you and to talk about looking after your house. We don&rsquo;t
            sell it, and we don&rsquo;t pass it to anyone else except the services that run this
            site for us.
          </p>

          <h2>Where it goes</h2>
          <p>
            The form is handled by Netlify, who host this website and hold the enquiries we
            receive. Their servers may be outside Australia.
          </p>

          <h2>Asking us about your details</h2>
          <p>
            You can ask us what we hold about you, ask us to correct it, or ask us to delete it.
            Get in touch and we&rsquo;ll sort it out.
          </p>

          {/* Add the business name, ABN and a contact address for privacy requests before launch. */}
        </div>
        <p style={{ marginTop: 32 }}><a href="/" className="link-rule">Back to the home page</a></p>
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
