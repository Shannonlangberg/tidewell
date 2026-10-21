import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";
import { FAQ, type FaqItem } from "@/components/planted/FAQ";
import {
  IconCare,
  IconCommunication,
  IconLocal,
  IconModern,
  IconReporting,
  IconStewardship,
} from "@/components/planted/Icons";

export const metadata: Metadata = {
  title: "Property Management, Copper Coast",
  description:
    "What PLANTED. looks after for rental property owners: appraisal, leasing, rent and arrears, inspections, maintenance, reporting, renewals and the end of a tenancy. Based on the Copper Coast, South Australia.",
  alternates: { canonical: "/property-management" },
};

/*
 * Ten capabilities, set as a hairline-ruled editorial list rather than a grid of
 * cards: at this length cards flatten the reading and turn a service into a tile.
 * The order is how an owner meets them, not a ranked sequence, so there are no
 * numbers here.
 */
const SERVICES = [
  {
    title: "Rental market appraisal",
    body: "Before anything else we look at the property in its own context: condition, presentation, layout, position and what comparable homes nearby are being advertised and leased for. You get a considered rental range and the reasoning behind it, not a figure pulled off a portal.",
  },
  {
    title: "Property marketing and leasing",
    body: "Proper photography, an honest description and a listing placed where people actually look for a rental. Enquiries are answered quickly, inspections are run in person, and you hear how the interest is tracking rather than waiting for an outcome.",
  },
  {
    title: "Tenant applications and screening",
    body: "Every application is checked properly: identity, income and employment, rental history, references and the tenancy databases. We set out what we found alongside a recommendation, because who lives in your property is your decision to make.",
  },
  {
    title: "Lease preparation and administration",
    body: "The lease is prepared on the correct South Australian form, the bond is lodged and the entry condition report is completed and signed before anyone moves in. Getting the paperwork right at the start is what makes everything after it straightforward.",
  },
  {
    title: "Rent collection and arrears processes",
    body: "Rent is reconciled against the ledger continuously rather than checked when something looks wrong. A missed payment is followed up on the day it happens and handled through the process South Australian tenancy law sets out, and you hear about it from us early.",
  },
  {
    title: "Routine inspections",
    body: "Inspections are carried out in person, with photographs and a written report you can actually read. We are looking for more than damage: early wear, work that is cheaper now than later, and whether the home is genuinely being cared for.",
  },
  {
    title: "Maintenance coordination",
    body: "Requests are triaged on arrival and sorted by urgency, with safety, security and essential services dealt with immediately. Work goes to local trades who know the area and the age of the building, and is followed through to completion rather than left for you to chase.",
  },
  {
    title: "Owner communication and reporting",
    body: "Statements arrive on a predictable cycle and are set out so the numbers are easy to follow. Between them you hear from us when there is something worth telling you, and when you call you reach the person who already knows your property.",
  },
  {
    title: "Lease renewals",
    body: "The renewal conversation starts well before a lease ends, with a current read on the market and a recommendation on rent and term. Any rent adjustment is made within the notice periods and frequency limits South Australian law requires, and the decision to renew, adjust or re-let stays yours.",
  },
  {
    title: "Vacate and bond processes",
    body: "The outgoing inspection is completed against the original condition report, so fair wear is a matter of record rather than opinion. Anything outstanding is worked through, the bond claim or release is handled through the proper channel, and the property is readied for what comes next.",
  },
];

const DIFFERENCES = [
  {
    icon: IconLocal,
    title: "One person who knows it",
    body: "Your property has a person looking after it, and they know the tenant, the history and what was agreed last time. You are not starting from scratch on every call.",
  },
  {
    icon: IconCommunication,
    title: "Updates while it happens",
    body: "You hear from us during a repair or a vacancy, not after it. Statements come on a set cycle, and messages are answered promptly.",
  },
  {
    icon: IconCare,
    title: "Small things found early",
    body: "A building rewards attention. We inspect to find the small things early, because that is where the money and the goodwill are saved.",
  },
  {
    icon: IconReporting,
    title: "Fees in writing",
    body: "Set out before anything is signed, with what is included and what is not. Statements show the full picture, and there is no line item you have to ring us to understand.",
  },
  {
    icon: IconModern,
    title: "Records in one place",
    body: "Statements, inspection reports, maintenance history and lease dates are kept together, so nothing depends on one person remembering and you can find them when you want them.",
  },
  {
    icon: IconStewardship,
    title: "Advice for the next decade",
    body: "Decisions are weighed against the next ten years of ownership, not the next statement. Sometimes the right advice is to spend rather than save.",
  },
];

const FAQS: FaqItem[] = [
  {
    q: "How much does property management cost?",
    a: (
      <>
        <p>
          Fees depend on the property and on the scope of the service: a unit on a settled long-term
          lease and a coastal house that needs regular attention are not the same job, and pretending
          otherwise helps nobody.
        </p>
        <p>
          We would rather talk it through and give you a figure that reflects your property, with
          what is and is not included set out in writing before you sign anything.
        </p>
        <div className="mt-7">
          <RuleLink href="/contact">Ask What It Would Cost</RuleLink>
        </div>
      </>
    ),
  },
  {
    q: "How do I change property managers?",
    a: (
      <>
        <p>
          Start with your current management agreement: it sets out how the appointment ends and how
          much notice is required. Everything after that is largely administrative: notice is given,
          and the file, keys, condition reports, bond details and tenant records are transferred
          across.
        </p>
        <p>
          The tenancy itself continues on its existing terms; what changes is who the tenant deals
          with. We will walk you through the steps and handle the paperwork.
        </p>
      </>
    ),
  },
  {
    q: "How is my rental price determined?",
    a: (
      <>
        <p>
          By looking at the property itself and at what comparable homes in the same area are
          currently being advertised and leased for. Condition, presentation, bedrooms, parking,
          heating and cooling, outdoor space and the time of year all move the figure.
        </p>
        <p>
          You get a range with the reasoning attached rather than a single number, so you can weigh a
          higher rent against a longer vacancy and decide which you would rather have.
        </p>
      </>
    ),
  },
  {
    q: "How often will my property be inspected?",
    a: (
      <>
        <p>
          An entry condition report is completed and signed before the tenancy begins. Routine
          inspections then run at a frequency set in your management agreement and within what South
          Australian tenancy law allows, including the notice a tenant is entitled to and the limits
          on how often they can be asked to accommodate one.
        </p>
        <p>
          We will recommend a rhythm that suits the property. Older housing stock and homes close to
          the water generally justify a closer eye than a newer home a few streets back.
        </p>
      </>
    ),
  },
  {
    q: "How do you handle maintenance?",
    a: (
      <>
        <p>
          Requests are assessed as they arrive and sorted by urgency. Anything affecting safety,
          security or an essential service is acted on straight away, as the law requires.
        </p>
        <p>
          Everything else is quoted where the cost warrants it and approved by you. You set a
          spending limit in the management agreement so routine work can simply be done rather than
          waiting on an email, and anything above it comes to you with the quote attached.
        </p>
      </>
    ),
  },
  {
    q: "Can you manage my property if I live interstate?",
    a: (
      <>
        <p>
          Yes. Distance is the main reason detailed reporting exists. The point of photographs and
          written inspections is that you can see the condition of your property without standing in
          it.
        </p>
        <p>
          Statements, inspection reports and maintenance updates reach you wherever you are, and the
          inspections, site visits and trades are all handled locally, on the Copper Coast.
        </p>
      </>
    ),
  },
  {
    q: "How do I get started?",
    a: (
      <>
        <p>
          Request a rental appraisal or send an enquiry, and we will arrange a time to see the
          property. You will come away with a written appraisal, a clear explanation of what
          management with {BRAND.name} involves and what it costs, and no obligation to go further.
        </p>
        <p>
          If it suits you, we prepare the management agreement and take it from there.
        </p>
      </>
    ),
  },
];

export default function PropertyManagementPage() {
  return (
    <>
      {/* ── 1. Editorial opening ────────────────────────────── */}
      <section className="bg-ivory">
        <div className="shell pb-20 pt-36 md:pb-28 md:pt-44">
          <div className="reveal reveal-1">
            <Label>{BRAND.descriptor}</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[17ch]">
            Property management that keeps you in the picture.
          </h1>
          <div className="prose-measure reveal reveal-3 mt-10">
            <p className="lede">
              Most of your involvement should be reading a statement and making the occasional
              decision.
            </p>
            <p className="mt-6 text-ink-muted">
              We look after the rest, and tell you what is happening while it is happening. Here is
              what that covers, and how we go about it.
            </p>
          </div>
          <div className="reveal reveal-4 mt-12 flex flex-col gap-4 sm:flex-row">
            <Button href="/rental-appraisal" variant="primary">
              Request a rental appraisal
            </Button>
            <Button href="/contact" variant="outline">
              Talk to us
            </Button>
          </div>
        </div>
      </section>

      {/* ── 2. What management covers ───────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead
            label="What we do"
            heading={<>What management covers.</>}
          >
            <p>
              These are the jobs that make up a tenancy, and what each one involves.
            </p>
          </SectionHead>

          <ul className="rule mt-20">
            {SERVICES.map((s) => (
              <li key={s.title} className="border-b border-line">
                <div className="grid gap-x-16 gap-y-4 py-10 md:grid-cols-12 md:py-12">
                  <h3 className="display display-sm md:col-span-4">{s.title}</h3>
                  <p className="text-ink-muted md:col-span-7 md:col-start-6">{s.body}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="prose-measure mt-12 text-[0.9375rem] leading-relaxed text-ink-muted">
            Residential property management in South Australia is a registered activity.{" "}
            {BRAND.name} will confirm its registration details before entering into any management
            agreement, and those details will be published here once they are held.
          </p>
        </div>
      </Section>

      {/* ── 3. What makes PLANTED. different ────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <SectionHead
            label="How we work"
            heading={<>What you can expect from us.</>}
          >
            <p>
              Six things we hold ourselves to on every property.
            </p>
          </SectionHead>

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {DIFFERENCES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col bg-ivory p-8 lg:p-10">
                <Icon className="text-clay-deep" />
                <h3 className="display display-sm mt-8">{title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 4. Questions ────────────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-12 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label>Common questions</Label>
              <h2 className="display display-lg mt-6">
                The things owners ask first.
              </h2>
              <p className="mt-8 text-ink-muted">
                If yours is not here, ask it directly. We would rather answer a question than have
                you guess at the answer.
              </p>
              <div className="mt-10">
                <RuleLink href="/contact">Ask a Question</RuleLink>
              </div>
            </div>

            <div className="md:col-span-7 md:col-start-6">
              <FAQ items={FAQS} />
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Call to action ───────────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="grid gap-x-16 gap-y-12 md:grid-cols-12">
            <div className="md:col-span-7">
              <h2 className="display display-lg text-ivory">
                Start with an appraisal.
              </h2>
              <p className="lede lede-light mt-8 max-w-xl">
                It costs nothing and commits you to nothing. You will know what the property could
                rent for and what looking after it would involve.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <div className="flex w-full flex-col gap-4">
                <Button href="/rental-appraisal" variant="light">
                  Get a rental appraisal
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
