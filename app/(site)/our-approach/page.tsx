import Image from "next/image";
import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

export const metadata: Metadata = {
  title: "Our Approach",
  description:
    "How PLANTED. works day to day: the first conversation, the appraisal and plan, onboarding, leasing, inspections and reporting, maintenance, renewals and the end of a tenancy.",
  alternates: { canonical: "/our-approach" },
};

/*
 * Getting started. A genuine sequence — each step only makes sense after the one
 * before it — so the numerals are doing real work rather than decorating a grid.
 */
const STEPS = [
  {
    n: "01",
    title: "Talk to us",
    body: [
      "It starts with a conversation and a look at the property. We want to know what you own and how long you have owned it, what has gone well and what has not, and what you actually want from a manager: income, low involvement, a building kept in good order, or all three at once.",
      "There is no cost at this stage and nothing to sign. If we are not the right fit for your property, we would rather tell you than take it on.",
    ],
  },
  {
    n: "02",
    title: "The appraisal and the plan",
    body: [
      "We appraise the property properly: condition, presentation, position, and what comparable homes nearby are being advertised and leased for. You get a written rental range with the reasoning behind it, including the small pieces of work that would lift the rent or shorten the time to lease.",
      "With it comes a plan: what we would recommend before listing, how the property would be marketed, how inspections and maintenance would be handled, and what management costs. All of it in writing, before you commit to anything.",
    ],
  },
  {
    n: "03",
    title: "We take over",
    body: [
      "Once the management agreement is signed, the detail becomes ours. Keys, compliance records, utilities, the bond, the existing tenancy if there is one, and every document that needs to come across.",
      "From there you move into the ongoing rhythm below, and the day-to-day running of the property is no longer yours to drive.",
    ],
  },
];

/*
 * The ongoing rhythm. Also a sequence — it is the order a tenancy actually moves
 * through — and numbered separately from the three steps above because this part
 * repeats for as long as we manage the property.
 */
const RHYTHM = [
  {
    n: "01",
    title: "Onboarding",
    body: "Everything moves across: the lease, the bond details, the condition report, keys, compliance records and any maintenance history. We introduce ourselves to the tenant in writing so they know who to contact and what to expect. Nothing about the tenancy itself changes except who is looking after it.",
  },
  {
    n: "02",
    title: "Leasing",
    body: "If the property is vacant it is photographed and listed properly, enquiries are answered quickly and inspections are run in person rather than by lockbox. Applications are screened thoroughly and come to you with the detail behind them, together with a recommendation. The decision stays yours.",
  },
  {
    n: "03",
    title: "The tenancy",
    body: "The lease is prepared on the correct South Australian form, the bond is lodged and the entry condition report is completed and signed before anyone moves in. Rent is reconciled against the ledger continuously, and arrears are followed up from the first day rather than the first week.",
  },
  {
    n: "04",
    title: "Inspections and reporting",
    body: "Routine inspections run at the frequency set in your management agreement and within what South Australian tenancy law allows. Each comes back as a written report with photographs covering condition, care and anything worth doing before it becomes urgent. Statements arrive on a predictable cycle.",
  },
  {
    n: "05",
    title: "Maintenance",
    body: "Requests are triaged on arrival. Safety, security and essential services are acted on immediately; everything else is quoted where the cost warrants it and approved by you within the limit you set. Work goes to local trades who know the area and the age of the building, and is followed through to completion.",
  },
  {
    n: "06",
    title: "Renewals",
    body: "Well before a lease ends we review the market, make a recommendation on rent and term, and talk it through with you. Any rent adjustment is made within the notice periods and frequency limits South Australian law requires. Keeping a good tenant is usually worth more than a higher rent on paper.",
  },
  {
    n: "07",
    title: "The end of a tenancy",
    body: "The outgoing inspection is completed against the original condition report, so what is fair wear and what is not is a matter of record rather than opinion. Anything outstanding is worked through, the bond claim or release goes through the proper channel, and re-letting begins as soon as the property is ready.",
  },
];

export default function OurApproachPage() {
  return (
    <>
      {/* ── 1. Editorial opening ────────────────────────────── */}
      <section className="bg-ivory">
        <div className="shell pb-20 pt-36 md:pb-28 md:pt-44">
          <div className="reveal reveal-1">
            <Label>Our Approach</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[15ch]">
            How we look after your property.
          </h1>
          <div className="prose-measure reveal reveal-3 mt-10">
            <p className="lede">
              Three steps to begin, then a rhythm that keeps going for as long as we manage it.
            </p>
            <p className="mt-6 text-ink-muted">
              Most of the work happens quietly, in the weeks when nothing goes wrong. Here is what each
              part involves.
            </p>
          </div>
        </div>
      </section>

      {/* ── 2. Getting started ──────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead label="Getting started" heading={<>From a conversation to a signed agreement.</>}>
            <p>
              Nothing is signed until you have the appraisal, the plan and the cost in front of you
              in writing.
            </p>
          </SectionHead>

          <ol className="mt-20 border-t border-line">
            {STEPS.map((s) => (
              <li key={s.n} className="border-b border-line">
                <div className="grid gap-x-16 gap-y-6 py-12 md:grid-cols-12 md:py-16">
                  <div className="md:col-span-3">
                    <p className="display tnum text-[2.5rem] leading-none text-clay">{s.n}</p>
                    <h3 className="display display-md mt-5">{s.title}</h3>
                  </div>
                  <div className="prose-measure text-ink-muted md:col-span-8 md:col-start-5">
                    {s.body.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* ── 3. Feature image ────────────────────────────────── */}
      {/* Framed in the 2026 style: a 28px-radius plate inside the page, not full bleed. */}
      <section className="bg-ivory pb-[var(--section-y)]">
        <div className="shell">
          <div className="on-dark relative flex min-h-[32rem] items-center overflow-hidden rounded-[var(--radius-lg)] bg-forest py-28 md:min-h-[40rem]">
            <Image
              src="/photos/wallaroo.jpg"
              alt="A heritage sandstone house on a Copper Coast street, with a wide verandah, iron lace brackets, two chimneys and a low stone fence, photographed in late afternoon light"
              fill
              sizes="100vw"
              className="img-cover object-[center_60%]"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-forest/60" />
            <div className="relative z-10 px-[clamp(1.5rem,5vw,4rem)]">
              <div className="max-w-3xl">
                <p className="display display-lg text-ivory">
                  Every house asks something different of whoever looks after it.
                </p>
                <p className="label label-light mt-10">
                  How a house ages depends on its materials, its age and how close it is to the sea.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. The ongoing rhythm ───────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <SectionHead label="Once we are managing" heading={<>The rhythm of a well-run tenancy.</>}>
            <p>
              This is the cycle a property moves through under management, and what we are doing at
              each point in it.
            </p>
          </SectionHead>

          {/* A <ul> rather than an <ol>: the sequence is carried by the visible
              numerals, and the closing cell belongs to the grid, not the cycle. */}
          <ul className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {RHYTHM.map((r) => (
              <li key={r.n} className="flex flex-col bg-ivory p-8 lg:p-10">
                <p className="label tnum text-clay-deep">{r.n}</p>
                <h3 className="display display-sm mt-6">{r.title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">{r.body}</p>
              </li>
            ))}

            {/* Closes the grid so the hairlines resolve rather than stopping short. */}
            <li className="flex flex-col justify-between bg-ivory p-8 lg:col-span-2 lg:p-10">
              <p className="display display-md max-w-md">And then it begins again.</p>
              <div className="mt-10">
                <RuleLink href="/property-management">What Management Covers</RuleLink>
              </div>
            </li>
          </ul>
        </div>
      </Section>

      {/* ── 5. Call to action ───────────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">Start at step one.</h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              A conversation and a look at the property. Everything else follows from there, and
              none of it commits you to anything.
            </p>
            <div className="mt-12 flex flex-col justify-center gap-4 sm:flex-row">
              <Button href="/rental-appraisal" variant="light">
                Request a rental appraisal
              </Button>
              <Button href="/contact" variant="ghost-light">
                Contact {BRAND.name}
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
