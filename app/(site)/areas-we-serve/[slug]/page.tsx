import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AREAS, BRAND, CONTACT, areaBySlug, type Area } from "@/lib/planted";
import { AreaPhoto } from "@/components/planted/AreaCard";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";

/*
 * ── THE SUBURB PAGE TEMPLATE ───────────────────────────────────────────────
 *
 * This one file renders every area page, and it is the template future suburb
 * pages are cloned from. Nothing here is hard-coded to a town.
 *
 * To add an area:
 *   1. add it to AREAS in lib/planted.ts (slug, name, intro, character);
 *   2. add a matching entry to AREA_DETAIL below;
 *   3. add a photograph to AREA_PHOTOS in components/planted/AreaCard.tsx if
 *      one exists — if it does not, a visible placeholder renders instead.
 * generateStaticParams, generateMetadata, the JSON-LD and the sibling links all
 * follow from AREAS without further edits.
 *
 * These pages must never become doorway pages. Every entry in AREA_DETAIL is
 * written for its own town: what the housing is actually like, what management
 * there actually involves, why someone being nearby changes the outcome. If a
 * new entry reads like an existing one with the name swapped, it is not ready.
 *
 * Nothing invented: no yields, no vacancy rates, no median rents, no counts of
 * properties managed. Qualitative local knowledge only.
 */

type Point = { title: string; body: string };

type AreaDetail = {
  /** One sentence under the h1. */
  lede: string;
  /** Two paragraphs expanding `intro` and `character` from the data. */
  context: [string, string];
  /** What managing a rental here specifically involves. */
  managing: [Point, Point, Point];
  /** Why someone being physically nearby changes the result here. */
  presence: [string, string];
};

const AREA_DETAIL: Record<string, AreaDetail> = {
  kadina: {
    lede:
      "Kadina is the business end of the Copper Triangle, and its rental market behaves accordingly: steadier, longer and more local than the coast.",
    context: [
      "Kadina sits a short drive inland from the gulf and carries most of the region's everyday business — the shops, the schools, the health services and the trades. That shapes who rents here. Tenants are more often working locally and looking for somewhere to stay for years rather than a season, which makes tenant selection and tenant retention the part of the job worth doing properly.",
      "The housing reflects a long history. Character stone cottages sit a street away from post-war brick homes and newer builds on the edge of town, and each of those asks something different of an owner. A well-kept cottage can be the most sought-after rental in its street. A neglected one becomes an expensive problem slowly, and then quickly.",
    ],
    managing: [
      {
        title: "Older homes, planned upkeep",
        body: "Stone and post-war houses reward a maintenance plan rather than a run of emergency call-outs. Roof plumbing, gutters, verandah structures and damp are worth a proper look before summer and again before winter.",
      },
      {
        title: "Comfort away from the breeze",
        body: "Inland, Kadina gets the full range of a South Australian summer and genuinely cold winter nights. Heating and cooling that works is not a luxury here; it is often the difference between a tenant renewing and a tenant looking.",
      },
      {
        title: "Tenancies that last",
        body: "With a local workforce renting, careful application assessment and a decent working relationship with the tenant do more for an owner's return than almost anything else. Vacancy is the expensive part of owning a rental.",
      },
    ],
    presence: [
      "Kadina is where the region's trades and suppliers are based. A manager who is actually here can usually get a quote, a plumber or an electrician moving this week rather than next.",
      "It also means the manager is a known quantity. In a town this size, how a property is run and how tenants are treated is not a secret — and that reputation is part of what brings good tenants to an owner's property in the first place.",
    ],
  },

  wallaroo: {
    lede:
      "A working port town, where the sea is the single biggest factor in how a property ages.",
    context: [
      "Wallaroo has a deep-water harbour, a ferry across Spencer Gulf and a residential community that has been here far longer than the holiday trade. It is a town with a job, which is part of why demand for long-term rentals is steady rather than purely seasonal.",
      "Within a few streets the housing changes completely: heritage cottages near the port, newer homes around the marina, and conventional family housing in the estates behind. One management approach applied across all three would be doing at least two of them badly.",
    ],
    managing: [
      {
        title: "Salt is the other tenant",
        body: "Close to the water, fixings, window hardware, fly screens, hot water services and air conditioning condensers corrode years ahead of schedule. An inspection here has to look at the metal, not only the walls and the floor coverings.",
      },
      {
        title: "Heritage next door to new",
        body: "A port cottage and a marina townhouse need different trades, different inspection notes and different expectations set with the owner. Treating them as the same asset is how small jobs turn into structural ones.",
      },
      {
        title: "Long-term, not short-stay",
        body: "Holiday letting sits alongside residential renting here. An owner choosing a long-term tenancy is choosing certainty over peak-season rates, and a manager should be plain about that trade-off rather than quiet about it.",
      },
    ],
    presence: [
      "Weather arrives across the gulf without much notice. Being close enough to check a property after a front has gone through — rather than waiting for a tenant to report it — is often the difference between a repair and a claim.",
      "It matters just as much that the trades we use understand coastal work: the right fixings, the right paint system, the right time of year to do it. That knowledge is local, and it does not travel from the city.",
    ],
  },

  moonta: {
    lede:
      "Cornish stone, generous blocks and a protected town character — all three shape what managing a rental here involves.",
    context: [
      "Moonta sits a few minutes inland from the bay and wears its mining history openly. The conservation-listed town centre is the reason the main street looks the way it does, and the reason a change to a frontage can become a planning question rather than a weekend job.",
      "Away from the centre, the housing is mostly stone and brick on generous blocks, with newer development running toward the bay. Older homes here are often solid and well built, which is not the same as maintenance-free — and the blocks are big enough that garden expectations have to be written down rather than assumed.",
    ],
    managing: [
      {
        title: "Stone needs the right trades",
        body: "Repointing, damp, roof plumbing and verandah timbers on an older stone home are specialist work. On this housing stock the cheapest quote is frequently the one that costs the most within five years.",
      },
      {
        title: "Check before you change",
        body: "Parts of Moonta sit within a protected town character. Before an owner replaces a roof, a fence or a frontage, the local council is the authority on what consent is required — a question much better asked beforehand.",
      },
      {
        title: "Big blocks, clear expectations",
        body: "Lawns, established gardens, sheds and rainwater tanks all come with a generous allotment. Setting out who maintains what at the start of a tenancy prevents most of the disagreements that otherwise surface at the end of one.",
      },
    ],
    presence: [
      "Knowing which streets fall inside the town's protected character, and which tradespeople can actually work on stone, is local knowledge. No checklist produces it.",
      "Moonta's permanent community is well established, and tenants here notice whether a property is genuinely cared for. A home that has been looked after leases faster, and tends to hold a better tenant for longer.",
    ],
  },

  "moonta-bay": {
    lede:
      "A family address a few minutes from the jetty, where the right tenant usually stays and the calendar genuinely matters.",
    context: [
      "Moonta Bay is where Moonta meets the water: a long jetty, a swimming beach and a residential strip that has grown steadily over the past two decades. It reads as a place people live rather than a place people visit, and most tenants here are families.",
      "The housing splits roughly in two. Established family homes a few streets back from the water need attention to the ordinary things — roofs, hot water, heating, fencing. Newer coastal builds closer to the front need attention to what weather does to new materials faster than anyone expects it to.",
    ],
    managing: [
      {
        title: "Two kinds of house, one suburb",
        body: "An established brick home and a recent coastal build do not age the same way. Inspection notes here are worth writing specifically rather than ticking through a standard form.",
      },
      {
        title: "Time the vacancy",
        body: "Demand along the bay moves with the seasons and the school year. Lining a lease end up with the right part of the calendar can be worth more to an owner than a few dollars a week on the rent.",
      },
      {
        title: "Outdoors is part of the house",
        body: "Decks, pergolas, shade structures and lawns take sun, sand and salt. They are the first thing a tenant uses and the first thing to look tired if nobody is watching them.",
      },
    ],
    presence: [
      "In summer the bay fills up. Access, parking and tradespeople's availability all change, and scheduling work around that is far easier for someone who already knows how the town behaves in January.",
      "It also helps to know the streets. A house three rows back from the water lives a different life to one on the front, and a maintenance budget should reflect that rather than average it out.",
    ],
  },

  "north-beach": {
    lede: "A quiet pocket north of Wallaroo, where the weather does more wear than any tenant will.",
    context: [
      "North Beach is residential and very little else: no shops, no through traffic, just houses close to the sand. That is precisely why tenants want to be here, and why they tend to stay once they are in.",
      "Most homes are detached and sit on larger allotments. That gives a tenant space, and gives an owner more to look after — lawns, irrigation, fencing, sheds, and whatever outdoor structure came with the house.",
    ],
    managing: [
      {
        title: "Exposure first",
        body: "Onshore weather is relentless on exteriors. Paint systems, roof fixings, flashings, screens and external fittings deserve a proper look at every inspection, well before anything actually fails.",
      },
      {
        title: "Land, not just house",
        body: "A larger allotment means irrigation, fencing, sheds and garden beds form part of the tenancy. Recording their condition properly at the start is what makes them manageable at the end.",
      },
      {
        title: "A small pool, handled individually",
        body: "There are rarely many rentals available here at once. Each vacancy deserves its own thinking about price and presentation rather than being processed as one of a batch.",
      },
    ],
    presence: [
      "There is nothing at North Beach to drive past on the way to somewhere else. A property here only gets looked at if someone makes the trip deliberately, which is more or less the argument for a local manager in one sentence.",
      "Tenants here have chosen quiet. Inspections should be properly arranged and properly brief, and maintenance should arrive when it said it would.",
    ],
  },

  "port-hughes": {
    lede:
      "A small coastal community largely owned from somewhere else — which makes reporting, and someone genuinely on the ground, the whole of the job.",
    context: [
      "Port Hughes sits south of Moonta Bay and is small by design: a jetty, a boat ramp, the golf links and a few streets of houses. The rental pool is modest, and a high proportion of the homes are relatively new.",
      "Many owners here live in Adelaide or interstate. They bought for the coast, they visit when they can, and for the rest of the year they need to know what is happening at their property without having to chase anyone for it.",
    ],
    managing: [
      {
        title: "Newer homes, proper records",
        body: "Appliance warranties, builder defect periods, compliance certificates and service histories are worth keeping properly on a newer home. They are the documents that save an owner money three years in.",
      },
      {
        title: "Decisions at a distance",
        body: "An owner living elsewhere needs photographs, a clear explanation and a recommendation — not a forwarded quote and a question mark. Reporting is not administration here; it is the service itself.",
      },
      {
        title: "A modest rental pool",
        body: "With fewer homes available, pricing and presentation matter more than volume. Thinking carefully about one vacancy beats applying a strategy designed for a hundred of them.",
      },
    ],
    presence: [
      "When an owner lives in Adelaide or interstate, somebody has to physically be there: to meet a tradesperson, to photograph a problem properly, to confirm that what was quoted is what was actually done.",
      "That is the part of property management that cannot be digitised. Good systems make the work visible; a person nearby makes it true.",
    ],
  },
};

type Params = { slug: string };

/** All six areas are prerendered at build time, straight from the data. */
export function generateStaticParams(): Params[] {
  return AREAS.map((area) => ({ slug: area.slug }));
}

/** In Next 16 `params` is a Promise and must be awaited. */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const area = areaBySlug(slug);
  if (!area) return {};

  return {
    title: `Property Management in ${area.name}`,
    description: `${BRAND.name} manages residential investment properties in ${area.name}, on South Australia's Copper Coast. ${area.character}`,
    alternates: { canonical: `/areas-we-serve/${area.slug}` },
  };
}

/**
 * Service-area structured data. `url`, `telephone` and `email` only appear once
 * the matching value in CONTACT is real — nothing here may be invented.
 */
function areaJsonLd(area: Area) {
  const site = CONTACT.url?.replace(/\/+$/, "");

  const provider = {
    "@type": "LocalBusiness",
    name: BRAND.name,
    description: `Residential property management on the ${BRAND.region}.`,
    areaServed: AREAS.map((a) => ({ "@type": "Place", name: `${a.name}, South Australia` })),
    ...(site ? { url: site } : {}),
    ...(CONTACT.phone ? { telephone: CONTACT.phone } : {}),
    ...(CONTACT.email ? { email: CONTACT.email } : {}),
    ...(CONTACT.legalName ? { legalName: CONTACT.legalName } : {}),
  };

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `Property management in ${area.name}`,
    serviceType: "Residential property management",
    description: area.intro,
    provider,
    areaServed: {
      "@type": "Place",
      name: area.name,
      address: {
        "@type": "PostalAddress",
        addressLocality: area.name,
        addressRegion: "SA",
        addressCountry: "AU",
      },
    },
    ...(site ? { url: `${site}/areas-we-serve/${area.slug}` } : {}),
  };
}

export default async function AreaPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const area = areaBySlug(slug);
  const detail = AREA_DETAIL[slug];

  // An unknown slug, or an area added to the data without its editorial layer.
  if (!area || !detail) notFound();

  const index = AREAS.findIndex((a) => a.slug === area.slug);
  const siblings = [1, 2, 3].map((n) => AREAS[(index + n) % AREAS.length]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(areaJsonLd(area)).replace(/</g, "\\u003c") }}
      />

      {/* ── 1. Opening ──────────────────────────────────────── */}
      {/* Plain section: .section sets padding-block unlayered, so a pt-*
          utility cannot override it, and the fixed header needs clearing. */}
      <section className="bg-ivory pb-20 pt-36 md:pb-28 md:pt-44">
        <div className="shell">
          <div className="reveal reveal-1">
            <Label>{area.name} &middot; South Australia</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[18ch]">
            Property management in {area.name}.
          </h1>
          <p className="lede reveal reveal-3 mt-8 max-w-2xl">{detail.lede}</p>

          <div className="reveal reveal-4 mt-16 grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <AreaPhoto
                slug={area.slug}
                name={area.name}
                sizes="(min-width: 768px) 38vw, 100vw"
                priority
              />
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure text-ink-muted">
                <p>{area.intro}</p>
                <p className="mt-5">{detail.context[0]}</p>
                <p className="mt-5">{detail.context[1]}</p>
              </div>
            </div>
          </div>

          {/*
            A sourced, dated figure on rental demand in this area could sit here
            once one exists. Until then nothing does: see the README.
          */}
        </div>
      </section>

      {/* ── 2. What management involves here ────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead
            label={`Managing in ${area.name}`}
            heading={<>What looking after a rental here actually involves.</>}
          >
            {area.character}
          </SectionHead>

          <div className="mt-20 grid gap-px bg-line md:grid-cols-3">
            {detail.managing.map((point) => (
              <div key={point.title} className="flex flex-col bg-softwhite p-8 lg:p-10">
                <h3 className="display display-sm">{point.title}</h3>
                <p className="mt-5 text-[0.9375rem] leading-relaxed text-ink-muted">{point.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 3. Why local presence matters here ──────────────── */}
      <Section tone="charcoal">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label tone="light">Why local matters</Label>
              <h2 className="display display-lg mt-6 text-ivory">
                Close enough
                <br />
                to be useful.
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure">
                <p className="lede lede-light">{detail.presence[0]}</p>
                <p className="mt-6 text-stone">{detail.presence[1]}</p>
              </div>
              <div className="mt-10">
                <RuleLink href="/our-approach" tone="light">
                  How We Work
                </RuleLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 4. Nearby areas ─────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <Label>Nearby</Label>
              <h2 className="display display-md mt-5">Other areas we serve.</h2>
            </div>
            <RuleLink href="/areas-we-serve">All Service Areas</RuleLink>
          </div>

          <ul className="mt-14 grid gap-px bg-line md:grid-cols-3">
            {siblings.map((sibling) => (
              <li key={sibling.slug} className="bg-ivory">
                <Link
                  href={`/areas-we-serve/${sibling.slug}`}
                  className="group flex h-full flex-col p-8 no-underline lg:p-10"
                >
                  <h3 className="display display-sm transition-colors duration-500 group-hover:text-clay-deep">
                    {sibling.name}
                  </h3>
                  <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
                    {sibling.intro}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── 5. Final call to action ─────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">
              Thinking about renting out a property in {area.name}?
            </h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              Start with an appraisal of what it could reasonably rent for, and a straight
              conversation about what managing it well would involve.
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
