import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";
import { Testimonials } from "@/components/planted/Testimonials";

export const metadata: Metadata = {
  title: "Why PLANTED.",
  description:
    "The things owners say they want from a property manager — to be kept informed, to have maintenance move, to understand the fees — and how PLANTED. approaches each of them.",
  alternates: { canonical: "/why-planted" },
};

/*
 * The frustration, then the answer.
 *
 * Deliberately not a comparison table. We have no evidence about how any other
 * agency works, so nothing here describes anyone else: the left column is what
 * owners say they care about, the right is what we do about it. That is a claim
 * we can stand behind; "unlike other agents" is not.
 */
const CONCERNS = [
  {
    title: "Being kept in the loop",
    concern:
      "Not knowing what is happening with your own property, and learning about decisions after they have already been made.",
    answer:
      "You hear from us while things are happening, not once they are finished. There is a named person on your property, updates come when there is something to tell you, and a message gets a reply the same business day wherever that is possible.",
  },
  {
    title: "Maintenance that moves",
    concern:
      "Repairs that sit unresolved while a tenant grows frustrated and a small problem quietly becomes an expensive one.",
    answer:
      "Requests are assessed the day they arrive and sorted by urgency, with safety, security and essential services handled immediately. You set a spending limit so routine work can proceed without waiting on an approval email, and anything above it comes to you with a quote.",
  },
  {
    title: "Fees you can actually see",
    concern:
      "Charges that appear on a statement without explanation, and a fee structure that takes a second reading to decode.",
    answer:
      "Fees are set out in writing in plain language before you sign anything, with what is included and what is not. If something is charged, it was agreed first. We would rather have the awkward conversation up front than defend a line item later.",
  },
  {
    title: "Inspections before there is a problem",
    concern:
      "Only hearing about the condition of a property once something has already gone wrong and the cost is fixed.",
    answer:
      "We treat an inspection as a maintenance tool rather than a formality. What we see is photographed and written up plainly, and the things worth attending to — a failing seal, a tired hot water service, early corrosion on coastal fixtures — are flagged while they are still small.",
  },
  {
    title: "Being able to reach someone",
    concern:
      "Calls that land in a queue, emails that go unanswered, and never being certain who is looking after your property this month.",
    answer:
      "You deal with the same person, and that person knows your property without having to open a file to remember it. We would far rather you rang us than sat wondering.",
  },
  {
    title: "Not being a number",
    concern:
      "A portfolio so large that your property is one row on a spreadsheet and your question waits its turn behind two hundred others.",
    answer:
      "We are building a book we can genuinely look after rather than the biggest one available. That is a deliberate choice about quality, and it is the reason your property gets attention rather than processing.",
  },
  {
    title: "Consistent tenant management",
    concern:
      "Rules applied one way this month and another way the next, so neither you nor your tenant is sure where they stand.",
    answer:
      "The same process every time: thorough screening before a tenancy, expectations made clear at the start, arrears followed up on the first day they occur, and the lease applied the same way for everyone. Tenants who are dealt with fairly and consistently tend to look after a home, and that protects your asset.",
  },
  {
    title: "Seeing your investment clearly",
    concern:
      "Owning a significant asset and having no straightforward way to see how it is actually performing.",
    answer:
      "Statements, inspection reports, maintenance history and lease dates kept together and written to be read rather than filed. The aim is that you can answer the question yourself at any moment — and still be welcome to ring and ask.",
  },
];

const VALUES = [
  {
    title: "Stewardship",
    body: "A property is held in trust for whoever owns it next, even when that is you in twenty years. We manage with that horizon in mind: protect the building, keep the records straight, and make decisions that still look right much later.",
  },
  {
    title: "Transparency",
    body: "Fees in writing, statements that show the whole picture and inspection reports that include the things you would rather not read. If something has gone wrong, you hear it from us first and plainly.",
  },
  {
    title: "Excellence",
    body: "Doing the ordinary things properly and consistently — the inspection on time, the ledger reconciled, the lease correct, the call returned. Almost all of property management is detail, and detail is where it is won or lost.",
  },
  {
    title: "Relationships",
    body: "With owners, with tenants and with the trades who keep a building standing. This is a people business before it is anything else, and good relationships are what make the hard conversations workable when they come.",
  },
  {
    title: "Growth",
    body: "Earned rather than chased. For your property it means care that compounds: a well-kept building, a settled tenancy, decisions made early. For us it means taking on only what we can look after properly.",
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
              What follows is what owners say matters to them about managing an investment property,
              and how {BRAND.name} approaches each one. No claims about anybody else &mdash; only
              what we hold ourselves to.
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
            label="Owner by owner"
            heading={<>The same frustrations come up again and again.</>}
          >
            <p>
              None of them are complicated to fix. They are fixed by caring about the unglamorous
              parts of the job and by having few enough properties to do that properly.
            </p>
          </SectionHead>

          {/* Column headings sit above the list on wide screens; on narrow ones
              each item carries its own, so the frame never goes missing. */}
          <div className="rule mt-20 hidden gap-x-16 pt-6 md:grid md:grid-cols-12">
            <p className="label md:col-span-5">What owners tell us matters</p>
            <p className="label md:col-span-6 md:col-start-7">How we approach it</p>
          </div>

          <ul className="rule mt-10 md:mt-6">
            {CONCERNS.map((c) => (
              <li key={c.title} className="border-b border-line">
                <div className="grid gap-x-16 gap-y-8 py-12 md:grid-cols-12">
                  <div className="md:col-span-5">
                    <p className="label md:hidden">What owners tell us matters</p>
                    <h3 className="display display-sm mt-4 md:mt-0">{c.title}</h3>
                    <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
                      {c.concern}
                    </p>
                  </div>
                  <div className="md:col-span-6 md:col-start-7">
                    <p className="label md:hidden">How we approach it</p>
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
            label="What we stand on"
            heading={<>Five values, and what each one costs us.</>}
          >
            <p>
              Values are only worth stating if they change a decision. These change ours.
            </p>
          </SectionHead>

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {VALUES.map((v) => (
              <div key={v.title} className="flex flex-col bg-ivory p-8 lg:p-10">
                <h3 className="display display-md">{v.title}</h3>
                <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-muted">{v.body}</p>
              </div>
            ))}

            {/* The sixth cell closes the grid rather than leaving a gap in the rule. */}
            <div className="flex flex-col justify-between bg-ivory p-8 lg:p-10">
              <p className="display display-sm text-clay-deep">{BRAND.tagline}</p>
              <div className="mt-10">
                <RuleLink href="/contact">Talk to us</RuleLink>
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
                Built on strong
                <br />
                foundations.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <p className="lede lede-light max-w-sm">
                Get the ordinary things right, every time, and the extraordinary ones mostly take
                care of themselves.
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
