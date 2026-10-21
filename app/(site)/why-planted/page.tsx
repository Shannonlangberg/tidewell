import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";
import { Testimonials } from "@/components/planted/Testimonials";

export const metadata: Metadata = {
  title: "Why PLANTED.",
  description:
    "Why PLANTED. exists, what we think good property management looks like, and what we are building to deal with the frustrations owners know well: chasing for updates, slow maintenance, unclear fees and feeling like a number.",
  alternates: { canonical: "/why-planted" },
};

/*
 * The frustration, then the answer.
 *
 * Deliberately not a comparison table. We have no evidence about how any other
 * agency works, so nothing here describes anyone else: the left column is a
 * familiar frustration of owning an investment property, the right is what we
 * are setting PLANTED. up to do about it. That is a claim we can stand behind;
 * "unlike other agents" is not. We have no clients yet, so nothing here says
 * "owners tell us". Several answers are service commitments (reply times,
 * a named person, handover before a manager changes): confirm them before launch.
 */
const CONCERNS = [
  {
    title: "Chasing for updates",
    concern: "Ringing for news, then ringing again because nobody came back to you.",
    answer:
      "You hear from us while things are happening, not once they are finished. A message gets a reply the same business day where we can, and if we can't give you an answer yet, we tell you when you will have one. We would far rather you rang us than sat wondering.",
  },
  {
    title: "Not knowing what is happening",
    concern:
      "Learning about a repair, a vacancy or a decision after it has been made, and only finding out the condition of the property when something goes wrong.",
    answer:
      "Updates come when there is something to tell you. Inspections are photographed and written up plainly, including the things you would rather not read, and anything worth attending to, like a failing seal, a tired hot water service or early corrosion, is flagged while it is still small.",
  },
  {
    title: "Feeling like a number",
    concern: "Being one row on a spreadsheet, with a question that waits its turn behind two hundred others.",
    answer:
      "We build the team around the number of properties, not the other way round. A property manager takes on only as many properties as they can look after properly, and we add people before we add pressure.",
  },
  {
    title: "Wondering whether maintenance is moving",
    concern:
      "A repair that sits unresolved while the tenant grows frustrated and a small problem quietly becomes an expensive one.",
    answer:
      "Requests are looked at the day they arrive and sorted by urgency, with safety, security and essential services handled immediately. You set a spending limit, so routine work goes ahead without waiting on your approval, and anything above it comes to you with a quote.",
  },
  {
    title: "A new manager every few months",
    concern: "Explaining your property again to someone new, and never being sure who is looking after it this month.",
    answer:
      "You deal with the same person, and they keep the file up to date so anyone covering for them knows the history: the tenant, the repairs and what has been agreed. If your manager does change, we tell you before it happens, not after.",
  },
  {
    title: "Fees that need decoding",
    concern: "A charge on a statement with no explanation, or a fee structure that takes a second reading to make sense of.",
    answer:
      "Fees are set out in writing, in plain language, before you sign anything, including what is included and what is not. If something is charged, it was agreed first. We would rather have the awkward conversation up front than defend a line item later.",
  },
  {
    title: "Feeling disconnected from your investment",
    concern: "Owning a significant asset and having no easy way to see how it is going.",
    answer:
      "Statements, inspection reports, maintenance history and lease dates are kept together and written to be read, not filed. You should be able to answer most questions yourself, any time, and still be welcome to ring and ask.",
  },
  {
    title: "Tenants handled differently each time",
    concern: "Rules applied one way this month and another way next month, so nobody is sure where they stand.",
    answer:
      "The same process every time: thorough screening before a tenancy, expectations made clear at the start, arrears followed up on the first day they occur, and the lease applied the same way for everyone. Tenants who are dealt with fairly tend to look after a home, and that protects your asset.",
  },
];

const BELIEFS = [
  {
    title: "Relationships before transactions",
    body: "A tenancy runs for years, and a good relationship is worth more than a quick result. We will take the slower, more honest answer over the fast one.",
  },
  {
    title: "People before process",
    body: "Process is there to give people time, not to stand between you and a person. When the two clash, the person comes first, and the job still gets done properly.",
  },
  {
    title: "Plain communication",
    body: "Short, clear and free of jargon. If we have to use a technical term, we explain it. If something has gone wrong, you hear it from us first.",
  },
  {
    title: "The same standard every time",
    body: "The inspection on time, the ledger reconciled, the lease correct, the call returned. Almost all of property management is detail, and we want it done the same way for every property.",
  },
  {
    title: "Strong systems, human service",
    body: "Good systems make the work visible and stop it depending on one person's memory. They support the relationship and leave the conversation to people.",
  },
];

export default function WhyPlantedPage() {
  return (
    <>
      {/* ── 1. Editorial opening ────────────────────────────── */}
      <section className="bg-ivory">
        <div className="shell pb-20 pt-36 md:pb-28 md:pt-44">
          <div className="reveal reveal-1">
            <Label>Why {BRAND.name}</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[16ch]">
            What good property management should feel like.
          </h1>
          <div className="prose-measure reveal reveal-3 mt-10">
            <p className="lede">
              Most owners don&rsquo;t want more paperwork. They want to stop wondering.
            </p>
            <p className="mt-6 text-ink-muted">
              We started {BRAND.nameInText} because we think property management can be better: for owners
              who want to be kept informed, for tenants who want to be treated fairly, and for the people
              doing the job. This page sets out what we think that looks like, and what we are building to
              get there.
            </p>
          </div>
          <div className="reveal reveal-4 mt-12">
            <RuleLink href="/our-approach">See How We Work</RuleLink>
          </div>
        </div>
      </section>

      {/* ── 2. What matters, and how we answer it ───────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead
            label="Common frustrations"
            heading={<>The same frustrations come up again and again.</>}
          >
            <p>
              None of them are hard to understand. Fixing them takes people who have the time to do the
              unglamorous parts of the job, and systems that stop things slipping.
            </p>
          </SectionHead>

          {/* Column headings sit above the list on wide screens; on narrow ones
              each item carries its own, so the frame never goes missing. */}
          <div className="rule mt-20 hidden gap-x-16 pt-6 md:grid md:grid-cols-12">
            <p className="label md:col-span-5">The frustration</p>
            <p className="label md:col-span-6 md:col-start-7">What we do about it</p>
          </div>

          <ul className="rule mt-10 md:mt-6">
            {CONCERNS.map((c) => (
              <li key={c.title} className="border-b border-line">
                <div className="grid gap-x-16 gap-y-8 py-12 md:grid-cols-12">
                  <div className="md:col-span-5">
                    <p className="label md:hidden">The frustration</p>
                    <h3 className="display display-sm mt-4 md:mt-0">{c.title}</h3>
                    <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
                      {c.concern}
                    </p>
                  </div>
                  <div className="md:col-span-6 md:col-start-7">
                    <p className="label md:hidden">What we do about it</p>
                    <p className="mt-4 text-ink-muted md:mt-0">{c.answer}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── 3. Values ───────────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <SectionHead
            label="What we believe"
            heading={<>The things we come back to.</>}
          >
            <p>
              When a decision is difficult, these are what we check it against.
            </p>
          </SectionHead>

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {BELIEFS.map((v) => (
              <div key={v.title} className="flex flex-col bg-ivory p-8 lg:p-10">
                <h3 className="display display-md">{v.title}</h3>
                <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-muted">{v.body}</p>
              </div>
            ))}

            {/* The sixth cell closes the grid rather than leaving a gap in the rule. */}
            <div className="flex flex-col justify-between bg-ivory p-8 lg:p-10">
              <p className="display display-sm text-clay-deep">{BRAND.tagline}</p>
              <div className="mt-10">
                <RuleLink href="/contact">Let&rsquo;s talk</RuleLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 4. Brand statement ──────────────────────────────── */}
      <Section tone="charcoal">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <p className="display display-xl text-ivory">
                The ordinary things,
                <br />
                done properly,
                <br />
                every time.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <p className="lede lede-light max-w-sm">
                Most of what an owner remembers about a manager comes down to whether the ordinary
                things got done.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/*
        Ready for real reviews. It renders nothing while the list is empty, and
        the list stays empty until there are genuine, attributable client quotes
        given with permission. It must never be populated with invented ones:
        PLANTED. has no clients yet, so any quote here today would be a lie about
        a person who does not exist.
      */}
      <Testimonials items={[]} />

      {/* ── 5. Call to action ───────────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="grid gap-x-16 gap-y-12 md:grid-cols-12">
            <div className="md:col-span-7">
              <h2 className="display display-lg">
                Worth a conversation?
              </h2>
              <p className="lede mt-8 max-w-xl">
                Tell us about your property and what has or hasn&rsquo;t worked for you so far. If we
                are not the right fit, we will say so.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <div className="flex w-full flex-col gap-4">
                <Button href="/rental-appraisal" variant="light">
                  Request a rental appraisal
                </Button>
                <Button href="/contact" variant="ghost-light">
                  Contact {BRAND.name}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
