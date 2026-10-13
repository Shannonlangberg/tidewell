import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND, CONTACT, telHref } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

/*
 * The PLANTED. privacy policy.
 *
 * It is a template. It describes, accurately, what this website does today —
 * two forms, a host, and whatever enquiry delivery the environment variables
 * point at — and nothing more. It does not describe managing a property,
 * because no property is managed yet, and it does not invent a provider, a
 * retention period or a contact address.
 *
 * Every contact point is conditional on lib/planted.ts. While CONTACT is all
 * null the page sends people to /contact and says, visibly, that a privacy
 * address has to be published before launch.
 *
 * Note for the lead: the parked Tidewell app links here too (components/app/
 * SignInForm.tsx and app/app/more/page.tsx both point at /privacy). Clause 01
 * says this policy covers the public website and not the signed-in area, which
 * keeps the statement true, but those two links are worth a decision.
 */

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${BRAND.name} collects, uses, stores and discloses the personal information you send through this website.`,
  alternates: { canonical: "/privacy" },
};

/**
 * Fixed on purpose. A computed date would move every time the site was rebuilt,
 * which would quietly claim the policy had been reviewed when it had not.
 * Change both values together when the policy actually changes.
 */
const LAST_UPDATED = { iso: "2026-10-14", label: "14 October 2026" };

// ── local pieces ─────────────────────────────────────────────
// Deliberately local to this file and duplicated in app/(site)/terms/page.tsx:
// the shared kit in components/planted/ui.tsx is owned elsewhere.

/** A numbered clause: heading on the left, prose in a reading measure on the right. */
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

/** A visible marker for something that has to be settled before the business trades. */
function PreLaunch({ children }: { children: ReactNode }) {
  return (
    <aside className="mt-8 border-l border-clay-deep pl-6">
      <p className="label">Before launch</p>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{children}</p>
    </aside>
  );
}

// ── the policy ───────────────────────────────────────────────

const CLAUSES: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "about",
    title: "About this policy",
    body: (
      <>
        <p>
          {BRAND.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a residential property
          management business on the {BRAND.region}. This policy explains what we do with the personal
          information you send us through this website.
        </p>
        <p>
          It covers this website only. Parts of this domain that sit behind a sign-in are not covered
          here; if you have an account with us, the terms that apply to it are given to you separately.
        </p>
        <p>
          It also does not yet cover the information involved in actually managing a property &mdash;
          tenancy applications, tenant and tradesperson records, inspection reports, trust account
          records and the like. None of that happens through this website. A separate policy,
          written against South Australian residential tenancy and land agent requirements, has to be
          in place before any property is taken under management.
        </p>
      </>
    ),
  },
  {
    id: "privacy-act",
    title: "The Privacy Act and the Australian Privacy Principles",
    body: (
      <>
        <p>
          The Privacy Act 1988 (Cth) sets out thirteen Australian Privacy Principles, which govern how
          personal information is collected, used, stored and disclosed. The Act binds Australian
          Government agencies and organisations whose annual turnover is above a threshold set by the
          Act, and some small businesses regardless of turnover.
        </p>
        <p>
          {BRAND.nameInText} may not currently be an organisation bound by the Act. We do not treat
          that as permission to be careless. We handle personal information in line with the
          Australian Privacy Principles whether or not we are required to, and we will comply with the
          Act in full if and when it applies to us.
        </p>
        <PreLaunch>
          Whether the Act binds this business is a question for a qualified adviser, not an assumption.
          Confirm it, and update this clause to say plainly which position applies.
        </PreLaunch>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What personal information we collect",
    body: (
      <>
        <p>
          Everything we collect through this website, you type into a form. The enquiry form and the
          rental appraisal form ask for, or give you room to tell us:
        </p>
        <ul className="mt-5 space-y-3">
          <li className="border-t border-line pt-3">Your name.</li>
          <li className="border-t border-line pt-3">
            Your email address, and your phone number if you choose to give it.
          </li>
          <li className="border-t border-line pt-3">
            The address or suburb of the property you are asking about.
          </li>
          <li className="border-t border-line pt-3">
            What you tell us about that property &mdash; its type and size, its condition, whether it is
            currently tenanted, and whether it is currently managed by someone else.
          </li>
          <li className="border-t border-line pt-3">
            What you tell us about your own circumstances as an owner &mdash; for example that you live
            interstate, that you are thinking about changing managers, or what you are hoping the
            property will do for you.
          </li>
          <li className="border-t border-line pt-3">Anything else you write in the message.</li>
        </ul>
        <p className="mt-6">
          We do not ask for sensitive information through this website, as the Privacy Act defines that
          term, and we would rather you did not send it. We never ask for bank account details, a tax
          file number, or a copy of an identity document through a form on this site.
        </p>
        <p>
          You can deal with us anonymously or under a pseudonym where that is practical, although we
          will not be able to give you anything useful about a specific property without knowing which
          property it is.
        </p>
      </>
    ),
  },
  {
    id: "how-we-collect",
    title: "How we collect it",
    body: (
      <>
        <p>
          Directly from you, when you fill in a form on this website or contact us using details
          published on it. We do not buy personal information, and we do not collect it from mailing
          lists, data brokers or scraped sources.
        </p>
        <p>
          If somebody else gives us your details &mdash; a co-owner, or a family member acting for you
          &mdash; we handle them the same way, and where it is reasonable to do so we will let you know
          that we hold them.
        </p>
        <p>
          Like every website, the servers that deliver these pages keep standard access logs, which
          include IP addresses and the pages requested. We use those only to keep the site running and
          secure.
        </p>
        <p>
          This website does not set advertising cookies, and it does not run third-party analytics or
          tracking scripts.
        </p>
        <PreLaunch>
          That last sentence is true of the site as built. If any analytics, advertising pixel, chat
          widget or embedded map is ever added, this clause must be rewritten on the same day.
        </PreLaunch>
      </>
    ),
  },
  {
    id: "why-we-use-it",
    title: "Why we use it",
    body: (
      <>
        <p>We use what you send us to:</p>
        <ul className="mt-5 space-y-3">
          <li className="border-t border-line pt-3">Answer your enquiry and continue the conversation.</li>
          <li className="border-t border-line pt-3">
            Prepare and send a rental appraisal, where you have asked for one.
          </li>
          <li className="border-t border-line pt-3">
            Talk with you about managing your property, and prepare a management agreement if you want
            one.
          </li>
          <li className="border-t border-line pt-3">
            Keep an accurate record of what was asked and what we said.
          </li>
          <li className="border-t border-line pt-3">Meet our legal and record-keeping obligations.</li>
        </ul>
        <p className="mt-6">
          We use it for the purpose you gave it to us for, and for directly related purposes you would
          reasonably expect. We do not sell personal information, and we do not disclose it for anyone
          else&rsquo;s marketing.
        </p>
        <p>
          We will not add you to a marketing list without your consent. If we ever send you something
          of that kind, every message will carry a plain way to opt out, and we will act on it.
        </p>
      </>
    ),
  },
  {
    id: "disclosure",
    title: "Who we disclose it to",
    body: (
      <>
        <p>We may disclose your personal information to:</p>
        <ul className="mt-5 space-y-3">
          <li className="border-t border-line pt-3">
            The service providers that run this website and carry enquiries to us &mdash; web hosting,
            email delivery, and the system we use to keep track of enquiries. They may use your
            information only to provide that service to us.
          </li>
          <li className="border-t border-line pt-3">
            Our professional advisers, such as a lawyer or an accountant, where we need advice.
          </li>
          <li className="border-t border-line pt-3">
            Anyone we are required or authorised by law to disclose to, including a court, a tribunal
            or a regulator.
          </li>
        </ul>
        <p className="mt-6">We do not disclose it to anyone else without your consent.</p>
      </>
    ),
  },
  {
    id: "overseas",
    title: "Overseas disclosure",
    body: (
      <>
        <p>
          This website is hosted by Netlify, a United States company. Enquiry delivery is set by
          configuration rather than written into the site, which means the provider that carries an
          enquiry from this website to us can change without this page changing.
        </p>
        <p>
          The honest position today: some of the providers involved in hosting this site and delivering
          its enquiries store or process information on servers outside Australia, including in the
          United States. When we disclose personal information to an overseas recipient we take
          reasonable steps to satisfy ourselves that it will be handled consistently with the
          Australian Privacy Principles.
        </p>
        <PreLaunch>
          Name the actual providers here &mdash; the host, the email delivery service, and any enquiry or
          CRM system &mdash; and the countries their servers are in. Australian Privacy Principle 8
          expects that list wherever it is practicable to give one, and &ldquo;may be overseas&rdquo; is
          a placeholder, not a disclosure.
        </PreLaunch>
      </>
    ),
  },
  {
    id: "storage",
    title: "Storage and security",
    body: (
      <>
        <p>
          We take reasonable steps to protect personal information from misuse, interference and loss,
          and from unauthorised access, modification or disclosure. This website is served over an
          encrypted connection, and access to enquiries is limited to the people who need it to do
          their work.
        </p>
        <p>
          No system is completely secure. We cannot guarantee the security of information while it is
          travelling over the internet, and you send it to us at your own risk.
        </p>
        <p>
          We keep enquiries for as long as we need them for the purpose they were given and for as long
          as the law requires us to keep them. When we no longer need personal information and no law
          requires us to hold it, we destroy it or de-identify it.
        </p>
        <PreLaunch>
          Set a written retention period, check it against the record-keeping requirements that apply to
          a South Australian land agent, and state it here as a number of years rather than as
          &ldquo;as long as we need&rdquo;.
        </PreLaunch>
      </>
    ),
  },
  {
    id: "access",
    title: "Access and correction",
    body: (
      <>
        <p>
          You can ask us for a copy of the personal information we hold about you, and you can ask us to
          correct it if it is wrong, out of date, incomplete, irrelevant or misleading. We will respond
          within a reasonable time.
        </p>
        <p>
          We may need to confirm who you are before we act on a request. We do not charge for making a
          request; if giving access would cost us something, we will tell you what it is before we incur
          it, and you can decide whether to go ahead.
        </p>
        <p>
          If we refuse access or refuse to make a correction, we will tell you why in writing and explain
          how to complain about that decision.
        </p>
        <p>
          You can also ask us to delete what we hold about you. We will do that unless a law requires us
          to keep it, in which case we will tell you which obligation stops us.
        </p>
      </>
    ),
  },
  {
    id: "complaints",
    title: "How to complain",
    body: (
      <>
        <p>
          If you think we have mishandled your personal information, tell us first. Describe what
          happened and what you would like us to do about it. We will acknowledge your complaint, look
          into it properly, and write back to you with the outcome and our reasons.
        </p>
        <p>
          If you are not satisfied with our response, and the Privacy Act applies to us, you can take the
          complaint to the Office of the Australian Information Commissioner. Their website is{" "}
          <a href="https://www.oaic.gov.au" className="underline underline-offset-4">
            oaic.gov.au
          </a>
          , and it explains how to make a privacy complaint and what the Commissioner can do about one.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contacting us about privacy",
    body: (
      <>
        {CONTACT.email || CONTACT.phone || CONTACT.address ? (
          <>
            <p>For anything in this policy &mdash; a question, a request for access, a correction or a complaint &mdash; reach us at:</p>
            <ul className="mt-5 space-y-3">
              {CONTACT.email && (
                <li className="border-t border-line pt-3">
                  <a href={`mailto:${CONTACT.email}`} className="underline underline-offset-4">
                    {CONTACT.email}
                  </a>
                </li>
              )}
              {CONTACT.phone && (
                <li className="border-t border-line pt-3">
                  <a href={telHref(CONTACT.phone)} className="underline underline-offset-4">
                    {CONTACT.phone}
                  </a>
                </li>
              )}
              {CONTACT.address && <li className="border-t border-line pt-3">{CONTACT.address}</li>}
            </ul>
          </>
        ) : (
          <>
            <p>
              {BRAND.nameInText} has not yet published a dedicated address for privacy requests. Until it
              does, send anything about this policy &mdash; a question, a request for access, a correction
              or a complaint &mdash; through the contact form, and say in the message that it is a privacy
              matter so it reaches the right person.
            </p>
            <div className="mt-8">
              <Button href="/contact" variant="outline">
                Contact {BRAND.name}
              </Button>
            </div>
            <PreLaunch>
              A privacy contact must be published here before the business begins operating: an email
              address, a postal address, and the name or title of the person responsible for privacy.
              They live in <code>CONTACT</code> in <code>lib/planted.ts</code>, and this clause will
              show them automatically as soon as they are set.
            </PreLaunch>
          </>
        )}
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <>
        <p>
          We may update this policy from time to time. The version published on this page is always the
          current one, and the date at the top of the page tells you when it last changed.
        </p>
        <p>
          If we make a change that materially affects how we handle information we already hold, we will
          take reasonable steps to tell the people affected rather than relying on them to notice the
          date.
        </p>
      </>
    ),
  },
];

const num = (i: number) => String(i + 1).padStart(2, "0");

export default function PrivacyPage() {
  return (
    <>
      {/* ── Masthead ────────────────────────────────────────────
          A plain section rather than <Section>: the fixed header has to be
          cleared with pt-36, and .section would otherwise set the top padding. */}
      <section className="bg-ivory pb-16 pt-36 md:pb-20 md:pt-44">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-8">
              <Label>Legal</Label>
              <h1 className="display display-xl mt-6">Privacy Policy</h1>
            </div>
            <div className="flex md:col-span-3 md:col-start-10 md:items-end md:justify-end">
              <p className="label">
                Last updated <time dateTime={LAST_UPDATED.iso}>{LAST_UPDATED.label}</time>
              </p>
            </div>
          </div>

          <p className="lede prose-measure mt-10">
            What {BRAND.nameInText} collects when you use this website, why we collect it, who sees it,
            and how to ask us about it.
          </p>

          {/* The template warning. Prominent, above the fold, in plain words. */}
          <div className="prose-measure mt-14 border-y border-charcoal py-8">
            <p className="label">Please read &mdash; this is a template</p>
            <p className="mt-4 text-charcoal">
              This policy has not been reviewed by a lawyer or a privacy adviser. It is a careful,
              honest starting point that describes what this website does today, and nothing more.
            </p>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
              {BRAND.nameInText} is not yet trading. Before the business begins operating, this policy
              must be reviewed by a qualified adviser and extended to cover what the business actually
              does &mdash; including everything involved in managing a property, which this website does
              not do. The marked notes through the page list what is still missing.
            </p>
          </div>
        </div>
      </section>

      {/* ── The policy ──────────────────────────────────────── */}
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
            label="Still have a question?"
            heading={<>Ask us about anything on this page.</>}
            action={
              <div className="flex flex-col gap-4 sm:flex-row">
                <Button href="/contact" variant="primary">
                  Get in Touch
                </Button>
                <span className="flex items-center">
                  <RuleLink href="/terms">Terms &amp; Disclaimer</RuleLink>
                </span>
              </div>
            }
          >
            If something here is unclear, or you want to know what we hold about you, say so and we will
            answer in plain words.
          </SectionHead>
        </div>
      </Section>
    </>
  );
}
