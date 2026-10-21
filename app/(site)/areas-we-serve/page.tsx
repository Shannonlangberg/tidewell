import type { Metadata } from "next";
import { AREAS, BRAND, REGIONS } from "@/lib/planted";
import { AreaCard } from "@/components/planted/AreaCard";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

/*
 * /areas-we-serve: the overview of where PLANTED. works. Areas come from AREAS
 * and are grouped by REGIONS in lib/planted.ts, so a new region or town is a
 * data change, not a page rewrite. The notes below are the page's own editorial
 * layer and are deliberately different from the copy on each area's own page,
 * so the two never read as the same text twice.
 *
 * Copper Coast is where PLANTED. is starting, not the edge of the brand: say
 * "starting", never "only", and add a place here only once it is genuinely served.
 */

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

export const metadata: Metadata = {
  title: "Areas We Serve on the Copper Coast",
  description:
    "Where PLANTED. offers residential property management: Kadina, Wallaroo, Moonta, Moonta Bay, North Beach and Port Hughes on the Copper Coast, South Australia. We are starting here.",
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
    "Most of the conversations here are about keeping a good tenant for years rather than filling a vacancy quickly, which usually comes back to how well the home is looked after.",
  wallaroo:
    "Two streets apart can mean two completely different maintenance briefs: a heritage cottage near the port and a newer home by the marina age nothing alike.",
  moonta:
    "Solid older housing on generous blocks, where planned maintenance and a clear agreement about the garden prevent most of the problems that surface later.",
  "moonta-bay":
    "A family rental market where the right tenant tends to stay, and where the time of year a lease ends can matter as much as the rent it is set at.",
  "north-beach":
    "A small pocket of homes where the weather does more wear than any tenant will, so the exterior is where the attention goes.",
  "port-hughes":
    "Largely owned by people living elsewhere, which makes clear reporting and someone on the ground the whole of the job.",
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
            Where we are starting.
          </h1>

          <div className="reveal reveal-3 mt-12 grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-7">
              <p className="lede">
                {BRAND.name} is starting on the Copper Coast. It sits at the top of South Australia&rsquo;s
                Yorke Peninsula, around a two-hour drive west of Adelaide. The Copper Triangle towns of
                Kadina, Wallaroo and Moonta, and the coastal communities around them, are where we offer
                property management today.
              </p>
            </div>
            <div className="md:col-span-4 md:col-start-9">
              <p className="text-[0.9375rem] leading-relaxed text-ink-muted">
                {countWord(AREAS.length)} communities, close enough together to look after properly and
                different enough from each other that one approach to all of them would suit none.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. The areas, region by region ──────────────────── */}
      {REGIONS.map((region) => {
        const areas = AREAS.filter((a) => a.region === region.slug);
        if (areas.length === 0) return null;
        return (
          <Section key={region.slug} tone="white" className="rule">
            <div className="shell">
              <SectionHead
                label={`${region.name}, ${region.state}`}
                heading={
                  <>
                    {countWord(areas.length)} communities.
                    <br />
                    {countWord(areas.length)} different briefs.
                  </>
                }
              >
                {region.intro} Each town asks something particular of an owner and of a property manager.
                Here is what we see in each of them.
              </SectionHead>

              {/*
                Market context (rental demand, vacancy, median rents) belongs here
                once there is a sourced and dated figure to quote. Nothing goes in
                until there is: see the README on statistics.
              */}

              <div className="mt-20 md:mt-28">
                {areas.map((area, i) => (
                  <div
                    key={area.slug}
                    className={i > 0 ? "mt-20 border-t border-line pt-20 md:mt-28 md:pt-28" : ""}
                  >
                    <AreaCard
                      area={area}
                      tag={TAGS[area.slug] ?? region.name}
                      note={NOTES[area.slug] ?? ""}
                      reverse={i % 2 === 1}
                    />
                  </div>
                ))}
              </div>
            </div>
          </Section>
        );
      })}

      {/* ── 3. Beyond the listed areas ──────────────────────── */}
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
                  The areas above are where we are starting. They are not a fence.
                </p>
                <p className="mt-6">
                  Owners elsewhere on the Copper Coast are welcome to ask. Whether we can look after a
                  particular property comes down to one honest question: can we get to it often enough to
                  manage it properly? If the answer is yes, we would like to hear from you. If it is no,
                  we will tell you plainly rather than take it on.
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
                Every town asks
                <br />
                something different
                <br />
                of a property.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <p className="lede lede-light max-w-sm">
                That will be true wherever we work. We will learn each new place properly before we say
                we serve it.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Final call to action ─────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">Have a property on the Copper Coast?</h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              Start with a rental appraisal: what it could reasonably rent for, and a straight
              conversation about what looking after it would involve.
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
