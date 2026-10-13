import type { Metadata } from "next";
import { AREAS, BRAND } from "@/lib/planted";
import { AreaCard } from "@/components/planted/AreaCard";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

/*
 * /areas-we-serve — the regional overview. Every area listed here comes from
 * AREAS in lib/planted.ts; the notes below are the page's own editorial layer
 * and are deliberately different from the copy on each area's own page, so the
 * two never read as the same text twice.
 */

export const metadata: Metadata = {
  title: "Areas We Serve on the Copper Coast",
  description:
    "Residential property management across the Copper Coast: Kadina, Wallaroo, Moonta, Moonta Bay, North Beach and Port Hughes, on South Australia's Yorke Peninsula.",
  alternates: { canonical: "/areas-we-serve" },
};

/** Where each area sits in the region. The Copper Triangle is the three mining towns. */
const TAGS: Record<string, string> = {
  kadina: "Copper Triangle",
  wallaroo: "Copper Triangle",
  moonta: "Copper Triangle",
  "moonta-bay": "Copper Coast",
  "north-beach": "Copper Coast",
  "port-hughes": "Copper Coast",
};

/** One line per area on what owners here actually ask about. */
const NOTES: Record<string, string> = {
  kadina:
    "Most of the conversations here are about keeping a good tenant for years rather than filling a vacancy quickly — which usually comes back to how well the home is looked after.",
  wallaroo:
    "Two streets apart can mean two completely different maintenance briefs: a heritage cottage near the port and a newer home by the marina age nothing alike.",
  moonta:
    "Solid older housing on generous blocks, where planned maintenance and a clear agreement about the garden prevent most of the problems that surface later.",
  "moonta-bay":
    "A family rental market where the right tenant tends to stay, and where the time of year a lease ends can matter as much as the rent it is set at.",
  "north-beach":
    "A small pocket of homes where the weather does more wear than any tenant will, so the exterior is where the attention goes.",
  "port-hughes":
    "Largely owned by people living elsewhere, which makes clear reporting and someone genuinely on the ground the whole of the job.",
};

export default function AreasWeServePage() {
  return (
    <>
      {/* ── 1. Opening ──────────────────────────────────────── */}
      {/* A plain section rather than <Section>: .section sets padding-block
          unlayered, so a pt-* utility cannot override it. The fixed header
          needs roughly 9rem of clearance. */}
      <section className="bg-ivory pb-20 pt-36 md:pb-28 md:pt-44">
        <div className="shell">
          <div className="reveal reveal-1">
            <Label>Areas We Serve</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[18ch]">
            The Copper Coast is where we&rsquo;re planted.
          </h1>

          <div className="reveal reveal-3 mt-12 grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-7">
              <p className="lede">
                Kadina, Wallaroo and Moonta &mdash; the Copper Triangle &mdash; sit at the top of
                South Australia&rsquo;s Yorke Peninsula, around a two-hour drive west of Adelaide.
                The coastal communities that sit around them are where {BRAND.name} works.
              </p>
            </div>
            <div className="md:col-span-4 md:col-start-9">
              <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
                Six communities, close enough together to be managed properly and different enough
                from each other that a single approach to all of them would serve none of them well.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. The areas ────────────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead
            label="Where we work"
            heading={<>Six communities.<br />Six different briefs.</>}
          >
            Each of these towns asks something particular of an owner and of a property manager.
            What follows is what we see in each of them.
          </SectionHead>

          {/*
            Market context — rental demand, vacancy, median rents — belongs here
            once there is a sourced and dated figure to quote. Nothing goes in
            until there is: see the README on statistics.
          */}

          <div className="mt-20 md:mt-28">
            {AREAS.map((area, i) => (
              <div
                key={area.slug}
                className={i > 0 ? "mt-20 border-t border-line pt-20 md:mt-28 md:pt-28" : ""}
              >
                <AreaCard
                  area={area}
                  tag={TAGS[area.slug]}
                  note={NOTES[area.slug]}
                  reverse={i % 2 === 1}
                />
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 3. Beyond these six ─────────────────────────────── */}
      <Section tone="ivory" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label>Elsewhere on the Copper Coast</Label>
              <h2 className="display display-lg mt-6">
                If your property is nearby, ask.
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure text-ink-muted">
                <p className="lede">
                  The six areas above are where most of our work is. They are not a fence.
                </p>
                <p className="mt-6">
                  We already talk with owners elsewhere on the Copper Coast, and whether we can
                  look after a particular property comes down to one honest question: can we get
                  to it often enough to manage it properly? If the answer is yes, we would like to
                  hear from you. If it is no, we will tell you that plainly rather than take it on.
                </p>
                <p className="mt-5 text-[0.9375rem]">
                  Our service area will grow as the business does. We will add towns to this page
                  when we genuinely serve them, and not before.
                </p>
              </div>
              <div className="mt-10">
                <RuleLink href="/contact">Ask About Your Area</RuleLink>
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
                Knowing a region
                <br />
                is not the same
                <br />
                as covering it.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <p className="lede lede-light max-w-sm">
                One coastline, six communities, and the time to understand what each of them asks
                of a property.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Final call to action ─────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">What could your property achieve here?</h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              Start with an appraisal of what your property could reasonably rent for, and an
              honest view of what managing it well would involve.
            </p>
            <div className="mt-12 flex flex-col justify-center gap-4 sm:flex-row">
              <Button href="/rental-appraisal" variant="primary">
                Request a Rental Appraisal
              </Button>
              <Button href="/contact" variant="outline">
                Contact {BRAND.name}
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
