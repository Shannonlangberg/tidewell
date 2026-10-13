import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND, CONTACT } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

/*
 * The PLANTED. website terms of use and disclaimer.
 *
 * Like the privacy policy, a template: it says what a careful property
 * management website should say, and it is explicit that it has not been
 * reviewed. The business details clause renders only what lib/planted.ts
 * actually holds and names, visibly, whatever is still missing — which today
 * is all four of them.
 */

export const metadata: Metadata = {
  title: "Terms & Disclaimer",
  description: `The terms on which you may use the ${BRAND.name} website, and the disclaimers that apply to the general information published on it.`,
  alternates: { canonical: "/terms" },
};

/** Fixed, for the same reason as on the privacy page. Change both together. */
const LAST_UPDATED = { iso: "2026-10-14", label: "14 October 2026" };

// ── local pieces ─────────────────────────────────────────────
// Duplicated from app/(site)/privacy/page.tsx on purpose: the shared kit in
// components/planted/ui.tsx is owned elsewhere.

function Clause({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <article id={id} className="rule grid scroll-mt-32 gap-x-16 gap-y-6 py-14 md:grid-cols-12 md:py-20">
      <div className="md:col-span-4">
        <p className="label">{n}</p>
        <h2 className="display display-sm mt-4">{title}</h2>
      </div>
      <div className="prose-measure text-ink-muted md:col-span-7 md:col-start-6">{children}</div>
    </article>
  );
}

function PreLaunch({ children }: { children: ReactNode }) {
  return (
    <aside className="mt-8 border-l border-clay-deep pl-6">
      <p className="label">Before launch</p>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{children}</p>
    </aside>
  );
}

// ── business details ─────────────────────────────────────────

/**
 * The details that have to appear on the site of a South Australian agency.
 * Each is null in CONTACT until it is real, so the clause below publishes what
 * exists and lists what does not. Nothing here is ever guessed.
 */
const BUSINESS_DETAILS: { label: string; value: string | null }[] = [
  { label: "Registered business name", value: CONTACT.legalName },
  { label: "ABN", value: CONTACT.abn },
  { label: "South Australian land agent registration", value: CONTACT.licenceNumber },
  { label: "Registered office", value: CONTACT.address },
];

// ── the terms ────────────────────────────────────────────────

const CLAUSES: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms apply to your use of this website. By using the site you accept them. If you do
          not accept them, please do not use it.
        </p>
        <p>
          They cover the website and nothing else. If you engage {BRAND.nameInText} to manage a
          property, that is a separate written agreement, and where it differs from these terms the
          agreement prevails.
        </p>
      </>
    ),
  },
  {
    id: "general-information",
    title: "General information only",
    body: (
      <>
        <p>
          Everything published on this website is general information. It is not financial, legal,
          taxation, investment or property advice, and it takes no account of your objectives, your
          financial situation or your needs.
        </p>
        <p>
          Nothing here is an offer, an inducement or a recommendation to buy, sell, lease or invest in
          any property. Before you act on anything you read here, get advice from a qualified
          professional who knows your circumstances.
        </p>
      </>
    ),
  },
  {
    id: "no-guarantee",
    title: "No guarantee of rental outcomes or property performance",
    body: (
      <>
        <p>
          We do not guarantee any rental outcome. Nothing on this website is a promise, a projection or
          a forecast about the rent a property will achieve, how long it will take to lease, how long
          a tenant will stay, what maintenance will cost, what the property will be worth, or how the
          rental market will behave.
        </p>
        <p>
          Any discussion of rent or of market conditions, including a rental appraisal, is an opinion
          formed at a point in time from the information available at that time. It is an estimate,
          not a valuation, and it is not a guarantee. Circumstances change, and an opinion given today
          may not hold tomorrow.
        </p>
        <p>
          Property is not a risk-free investment. Rental income can fall as well as rise, and past
          conditions are not a guide to future ones.
        </p>
      </>
    ),
  },
  {
    id: "accuracy",
    title: "Information may change",
    body: (
      <>
        <p>
          We take care to keep this website accurate and current, but we do not warrant that it is
          complete, accurate or up to date. Information goes out of date, and we may change, add to or
          remove any part of this site at any time, without notice.
        </p>
        <p>
          If something on this site matters to a decision you are making, confirm it with us in writing
          before you rely on it.
        </p>
        <p>
          We do not warrant that this website will be available without interruption or free of errors,
          and we are not liable for it being unavailable.
        </p>
      </>
    ),
  },
  {
    id: "third-party-links",
    title: "Third-party links",
    body: (
      <>
        <p>
          This website may link to websites operated by other people. Those links are offered as a
          convenience and are not an endorsement of the site, its owner, or anything on it.
        </p>
        <p>
          We do not control those websites and we are not responsible for their content, their
          accuracy, their availability or the way they handle personal information. Visiting them is at
          your own risk, and their terms and privacy policies apply once you leave this site.
        </p>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual property",
    body: (
      <>
        <p>
          The content of this website &mdash; its text, design, layout, graphics, photography and the{" "}
          {BRAND.name} name and marks &mdash; is owned by us or used with permission, and is protected
          by copyright and trade mark law.
        </p>
        <p>
          You may read this site, and print or save a copy of a page for your own personal use. You may
          not reproduce, republish, adapt, distribute or use any part of it for a commercial purpose
          without our written permission.
        </p>
        <PreLaunch>
          Two things to settle before this clause is relied on: confirm that the {BRAND.name} name and
          mark are available and, if the decision is to register, that registration is under way; and
          confirm in writing the licence or ownership of every photograph on the site.
        </PreLaunch>
      </>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>
          To the extent permitted by law, we exclude all liability for any loss or damage &mdash; direct
          or indirect, foreseeable or not, however caused &mdash; arising from your use of this website
          or from your reliance on anything published on it.
        </p>
        <p>
          Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy you have
          under the Australian Consumer Law or any other law, where doing so would be unlawful. Where
          our liability cannot be excluded, it is limited, at our option, to supplying the relevant
          service again or paying the cost of having it supplied again.
        </p>
      </>
    ),
  },
  {
    id: "privacy",
    title: "Privacy",
    body: (
      <>
        <p>
          What we do with the personal information you send through this website is set out in our
          privacy policy, which forms part of these terms.
        </p>
        <div className="mt-8">
          <RuleLink href="/privacy">Read the Privacy Policy</RuleLink>
        </div>
      </>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law",
    body: (
      <>
        <p>
          These terms are governed by the laws of South Australia. You and we submit to the
          non-exclusive jurisdiction of the courts of South Australia and of the courts that hear
          appeals from them.
        </p>
        <p>
          This website is directed at people in Australia. If you use it from somewhere else, you are
          responsible for complying with the laws that apply where you are.
        </p>
      </>
    ),
  },
  {
    id: "business-details",
    title: "Business details",
    body: (
      <>
        <p>
          These are the details that identify the business behind this website. They must all be
          published here before {BRAND.nameInText} offers, advertises or provides any managed property
          service in South Australia.
        </p>

        {BUSINESS_DETAILS.some((d) => d.value) && (
          <dl className="mt-6">
            {BUSINESS_DETAILS.filter((d) => d.value).map((d) => (
              <div key={d.label} className="border-t border-line py-3">
                <dt className="label">{d.label}</dt>
                <dd className="mt-2 text-charcoal">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {BUSINESS_DETAILS.some((d) => !d.value) && (
          <PreLaunch>
            Not yet confirmed, and so not published:{" "}
            {BUSINESS_DETAILS.filter((d) => !d.value)
              .map((d) => d.label.toLowerCase())
              .join("; ")}
            . Each is held in <code>CONTACT</code> in <code>lib/planted.ts</code> and appears here the
            moment it is set. The land agent registration in particular must be granted before any
            managed service is offered or advertised &mdash; not merely before it is delivered.
          </PreLaunch>
        )}
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <>
        <p>
          We may change these terms at any time. The version published on this page is the one that
          applies, and the date at the top of the page tells you when it last changed. Your continued
          use of the site after a change means you accept the current version.
        </p>
      </>
    ),
  },
];

const num = (i: number) => String(i + 1).padStart(2, "0");

export default function TermsPage() {
  return (
    <>
      {/* ── Masthead ────────────────────────────────────────────
          Plain <section>, so pt-36 clears the fixed header without .section
          setting the top padding itself. */}
      <section className="bg-ivory pb-16 pt-36 md:pb-20 md:pt-44">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <Label>Legal</Label>
              <h1 className="display display-xl mt-6">
                Terms &amp; Disclaimer
              </h1>
            </div>
            <div className="flex md:col-span-3 md:col-start-10 md:items-end md:justify-end">
              <p className="label">
                Last updated <time dateTime={LAST_UPDATED.iso}>{LAST_UPDATED.label}</time>
              </p>
            </div>
          </div>

          <p className="lede prose-measure mt-10">
            The terms on which you may use this website, and the disclaimers that apply to the general
            information published on it.
          </p>

          <div className="prose-measure mt-14 border-y border-charcoal py-8">
            <p className="label">Please read &mdash; this is a template</p>
            <p className="mt-4 text-charcoal">
              These terms have not been reviewed by a lawyer. They are a careful, honest starting point
              and no more than that.
            </p>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
              {BRAND.nameInText} is not yet trading. Before the business begins operating, these terms
              must be reviewed by a qualified adviser, and the business details in clause 10 must be
              confirmed and published. The marked notes through the page list what is still missing.
            </p>
          </div>
        </div>
      </section>

      {/* ── The terms ───────────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <nav aria-label="On this page">
            <p className="label">On this page</p>
            <ol className="mt-6 grid gap-x-12 gap-y-3 sm:grid-cols-2">
              {CLAUSES.map((c, i) => (
                <li key={c.id}>
                  <a
                    href={`#${c.id}`}
                    className="text-[0.9375rem] text-ink-muted no-underline transition-colors duration-300 hover:text-charcoal"
                  >
                    <span className="tnum mr-3 text-clay-deep">{num(i)}</span>
                    {c.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-20">
            {CLAUSES.map((c, i) => (
              <Clause key={c.id} id={c.id} n={num(i)} title={c.title}>
                {c.body}
              </Clause>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Close ───────────────────────────────────────────── */}
      <Section tone="stone">
        <div className="shell">
          <SectionHead
            label="Something unclear?"
            heading={<>Ask before you rely on it.</>}
            action={
              <div className="flex flex-col gap-4 sm:flex-row">
                <Button href="/contact" variant="primary">
                  Get in Touch
                </Button>
                <span className="flex items-center">
                  <RuleLink href="/privacy">Privacy Policy</RuleLink>
                </span>
              </div>
            }
          >
            If anything on this site is material to a decision you are making, ask us to confirm it in
            writing. We would rather answer the question than have you guess.
          </SectionHead>
        </div>
      </Section>
    </>
  );
}
