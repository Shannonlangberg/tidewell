import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AREAS, BRAND, CONTACT, telHref } from "@/lib/planted";
import { Arrow, Button, Point, RuleLink, Stop } from "@/components/planted/ui";

export const metadata: Metadata = {
  title: `${BRAND.name} | ${BRAND.descriptor}, Copper Coast`,
  description:
    "Thoughtful residential property management on the Copper Coast. Proactive care, clear communication and local knowledge for investment property owners in Kadina, Wallaroo, Moonta and nearby.",
  alternates: { canonical: "/" },
};

/*
 * The homepage, set like an architecture journal rather than a property site.
 *
 * - A cover: a dateline, then the tagline at cover scale, the photograph as a
 *   large plate bleeding off the right edge.
 * - Numbered running heads instead of eyebrow labels, so the page reads as a
 *   sequence of short chapters.
 * - One sentence with photographs set into it like words.
 * - The six towns as a poster-scale index, each written the way the wordmark
 *   is: a name and a full stop.
 * - A close where the phone number itself is the display type.
 *
 * The signature is the wordmark's full stop, in clay: it ends the cover line,
 * every town, and the close, and sits on the hairline that carries the steps.
 *
 * Every claim is drawn from content already published on the site or from
 * lib/planted.ts. No caption says where a photograph was taken or that PLANTED.
 * manages the property in it: none of them is, yet.
 */

/** What an owner can expect. Each line is a commitment made on /property-management. */
const EXPECT = [
  {
    title: "A person who knows your property",
    body: "When you call, you reach someone who already knows the house, the tenants and the history of both.",
  },
  {
    title: "Inspections you can actually read",
    body: "In person, with photographs and a written report. We look for early wear and for work that is cheaper now than later.",
  },
  {
    title: "Maintenance, followed through",
    body: "Sorted by urgency, placed with local trades who understand what coastal conditions do to a building, and finished rather than left for you to chase.",
  },
  {
    title: "Fees in writing, before you sign",
    body: "What is and isn’t included, set out in advance. Statements that show the full picture.",
  },
];

/** How it starts. The same three steps the rental appraisal page describes. */
const STEPS = [
  {
    title: "Tell us about the property",
    body: "Four short steps online: where it is, what it is, how it’s managed today and how to reach you.",
  },
  {
    title: "We see it and talk it through",
    body: "You get a rental range with the reasoning behind it, and a plain account of what managing it would involve and cost.",
  },
  {
    title: "Decide in your own time",
    body: "An appraisal commits you to nothing. If it suits you, we prepare the management agreement.",
  },
];

/** A few words per town, each drawn from its entry in lib/planted.ts. */
const TOWN_NOTES: Record<string, string> = {
  kadina: "The region’s commercial centre",
  wallaroo: "Port town, ferry across the Gulf",
  moonta: "Cornish heritage, stone homes",
  "moonta-bay": "Jetty and swimming beach",
  "north-beach": "Quiet pocket north of Wallaroo",
  "port-hughes": "Jetty, boat ramp and golf links",
};

/** The service index. Each is described in full on /property-management. */
const SERVICES = [
  "Rental market appraisal",
  "Marketing and leasing",
  "Tenant applications and screening",
  "Lease preparation",
  "Rent collection and arrears",
  "Routine inspections",
  "Maintenance coordination",
  "Owner statements",
  "Lease renewals",
  "Vacate and bond",
];

/** A chapter opening: a number, a name and a rule the full width of the page. */
function RunningHead({ n, children, className = "" }: { n: string; children: ReactNode; className?: string }) {
  return (
    <p className={`runhead ${className}`.trim()}>
      <span className="runhead-n tnum">{n}</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * A photograph set into a line of display type, like a word. Decorative.
 * `zoom` crops in on a detail (lacework, a verandah post) so it reads at the
 * size of a word; `origin` is the point of the photograph to zoom towards.
 */
function InlinePlate({ src, origin, zoom = 2.2 }: { src: string; origin: string; zoom?: number }) {
  return (
    <span aria-hidden="true" className="inplate">
      <span className="inplate-zoom" style={{ transform: `scale(${zoom})`, transformOrigin: origin }}>
        <Image src={src} alt="" fill sizes="(min-width: 64rem) 360px, 200px" className="img-cover photo-tone" style={{ objectPosition: origin }} />
      </span>
    </span>
  );
}

export default function HomePage() {
  return (
    <>
      {/* ── Cover ───────────────────────────────────────────────
          Phones get the line, the sentence and the button before the plate. */}
      <section className="overflow-x-clip bg-ivory pt-[4.75rem] md:pt-[5.25rem]">
        <div className="shell">
          <div className="dateline reveal reveal-1">
            <span className="font-medium text-charcoal">{BRAND.descriptor}</span>
            <span>Copper Coast, South Australia</span>
            {CONTACT.phone && (
              <a href={telHref(CONTACT.phone)} className="tnum ml-auto no-underline hover:text-charcoal max-sm:hidden">
                {CONTACT.phone}
              </a>
            )}
          </div>

          <h1 className="display display-cover mt-8 md:mt-12">
            <span className="mask-line">
              <span>A better place</span>
            </span>
            <span className="mask-line lg:text-right">
              <span>
                for your property<Stop />
              </span>
            </span>
          </h1>
        </div>

        <div className="mx-auto mt-10 grid max-w-[var(--max)] md:mt-14 lg:grid-cols-12">
          <div className="reveal reveal-3 flex flex-col px-[var(--gutter)] pb-14 lg:col-span-4 lg:pb-0 lg:pr-4">
            <p className="lede max-w-[30rem] md:max-w-[38rem]">
              {BRAND.name} looks after long-term rental homes in six towns on the Copper Coast.
              Inspected in person, repairs followed through, and your call answered by someone who
              knows the house.
            </p>
            <div className="mt-9 flex flex-col gap-5 sm:flex-row sm:items-center lg:flex-col lg:items-start">
              <Button href="/rental-appraisal" variant="primary" className="w-full sm:w-auto">
                Get a rental appraisal
              </Button>
              {CONTACT.phone && (
                <a href={telHref(CONTACT.phone)} className="group inline-flex items-baseline gap-2 text-[0.9375rem] no-underline">
                  <span className="text-ink-muted">or call</span>
                  <span className="tnum border-b border-charcoal/30 pb-0.5 font-medium transition-colors duration-300 group-hover:border-charcoal">
                    {CONTACT.phone}
                  </span>
                </a>
              )}
            </div>
          </div>

          <figure className="lg:col-span-8 lg:col-start-5 lg:mr-[min(0px,calc((var(--max)-100vw)/2))]">
            <div className="plate-reveal plate-scroll relative aspect-[4/5] overflow-hidden bg-stone sm:aspect-[3/2] lg:aspect-[16/11]">
              <Image
                src="/photos/12-bayview-road.jpg"
                alt="A timber-clad house at dusk, its folding doors open onto a verandah and a lit living room."
                fill
                preload
                sizes="(min-width: 64rem) 62vw, 100vw"
                className="img-cover photo-tone object-[56%_78%]"
              />
            </div>
          </figure>
        </div>
      </section>

      {/* ── 01 The short version ────────────────────────────────
          One sentence at display size, with two photographs set into it. */}
      <section className="bg-ivory py-[var(--section-y)]">
        <div className="shell">
          <RunningHead n="01">Why {BRAND.name}</RunningHead>
          <p className="display statement mt-12 md:mt-16">
            Collecting the rent <InlinePlate src="/photos/wallaroo.jpg" origin="47% 50%" /> is the
            straightforward part. Everything that matters sits around it: the right tenants,
            inspections you can read, repairs seen through{" "}
            <InlinePlate src="/photos/north-beach.jpg" origin="70% 52%" zoom={2.6} />, and a call answered by someone who already knows the house.
          </p>
          <div className="mt-12 grid gap-x-16 gap-y-8 md:mt-16 lg:grid-cols-12">
            <p className="text-ink-muted lg:col-span-5 lg:col-start-6">
              Good management is a long list of small obligations done on time. It is slower, more
              considered work, and the only version of the job we think is worth doing.
            </p>
            <div className="lg:col-span-2 lg:col-start-11 lg:pt-1 lg:text-right">
              <RuleLink href="/our-approach">Our approach</RuleLink>
            </div>
          </div>
        </div>
      </section>

      {/* ── 02 What to expect ───────────────────────────────────
          The plate bleeds off the left edge at a crop that keeps the whole
          facade; beside it, the four commitments as one numbered column. */}
      <section className="overflow-x-clip bg-softwhite py-[var(--section-y)]">
        <div className="shell">
          <RunningHead n="02">What you can expect</RunningHead>
        </div>
        <div className="mx-auto mt-12 grid max-w-[var(--max)] gap-y-12 md:mt-16 lg:grid-cols-12 lg:gap-x-16">
          <figure className="lg:sticky lg:top-28 lg:col-span-6 lg:self-start lg:ml-[min(0px,calc((var(--max)-100vw)/2))]">
            <div className="wide-plate relative aspect-[4/3] overflow-hidden bg-stone">
              <Image
                src="/photos/wallaroo.jpg"
                alt="A sandstone villa with a bullnose verandah, cast-iron lacework and a low stone front wall, seen from the street in late afternoon light."
                fill
                sizes="(min-width: 64rem) 50vw, 100vw"
                className="img-cover photo-tone object-[50%_60%]"
              />
            </div>
            <figcaption className="caption mt-4 max-w-[30rem] px-[var(--gutter)]">
              Stone, iron lacework and a deep verandah. Older homes reward a manager who plans the
              maintenance ahead.
            </figcaption>
          </figure>

          <div className="px-[var(--gutter)] lg:col-span-6 lg:pl-0">
            <h2 className="display display-lg max-w-[16ch]">Ordinary work, done properly.</h2>
            <ol className="mt-12 md:mt-16">
              {EXPECT.map((item, i) => (
                <li key={item.title} className="arrive grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-charcoal py-7 md:grid-cols-[3.5rem_1fr] md:py-9">
                  <p className="display tnum text-[1.75rem] leading-none text-clay-deep md:text-[2.25rem]">{i + 1}</p>
                  <div>
                    <h3 className="display display-md">{item.title}</h3>
                    <p className="mt-3 max-w-[34rem] text-charcoal/80">{item.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── 03 How it starts ────────────────────────────────────
          The one true sequence: the points on a hairline, oversized numerals. */}
      <section className="on-stone bg-stone py-[var(--section-y)]">
        <div className="shell">
          <RunningHead n="03">How it starts</RunningHead>
          <div className="mt-12 grid gap-x-16 gap-y-8 md:mt-16 lg:grid-cols-12">
            <h2 className="display display-xl lg:col-span-7">
              Three steps, no obligation<Stop />
            </h2>
            <p className="lede self-end lg:col-span-4 lg:col-start-9">
              You come away knowing what the property should rent for and what looking after it
              properly would involve.
            </p>
          </div>

          <ol className="pointline pointline-h-lg mt-16 md:mt-24">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Point />
                <p className="numeral tnum" aria-hidden="true">
                  {i + 1}
                </p>
                <h3 className="display display-sm mt-7">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-3 max-w-[22rem] text-[0.9375rem] leading-relaxed md:text-base">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-14 md:mt-16">
            <Button href="/rental-appraisal" variant="primary" className="w-full sm:w-auto">
              Get a rental appraisal
            </Button>
          </div>
        </div>
      </section>

      {/* ── Panorama ──────────────────────────────────────────── */}
      <figure className="bg-ivory">
        <div className="shutter relative aspect-[4/3] overflow-hidden bg-ivory sm:aspect-[2/1] lg:aspect-[12/5]">
          <Image
            src="/photos/port-hughes.jpg"
            alt="A contemporary house with a glass-balustraded deck above the dunes, the sea beyond it at dusk."
            fill
            sizes="100vw"
            className="img-cover photo-tone object-[30%_42%] lg:object-[50%_40%]"
          />
        </div>
        <figcaption className="shell caption pt-4 text-right">A deck above the dunes, at dusk.</figcaption>
      </figure>

      {/* ── 04 Where we work ────────────────────────────────────
          The six towns at poster scale, each set the way the wordmark is. */}
      <section className="bg-ivory pb-[var(--section-y)] pt-[calc(var(--section-y)*0.7)]">
        <div className="shell">
          <RunningHead n="04">Where we work</RunningHead>
          <div className="mt-12 grid gap-x-16 gap-y-6 md:mt-16 lg:grid-cols-12">
            <h2 className="display display-lg lg:col-span-6">
              Starting on the Copper Coast, because it&rsquo;s home.
            </h2>
            <p className="text-charcoal/80 lg:col-span-5 lg:col-start-8">
              Houses near the water need an eye on salt and weather. Older stone homes reward
              maintenance planned ahead. Many owners live elsewhere, so clear reporting and a
              reliable local presence matter more than usual.
            </p>
          </div>

          <ul className="mt-14 border-t border-charcoal md:mt-20">
            {AREAS.map((a) => (
              <li key={a.slug} className="border-b border-line">
                <Link href={`/areas-we-serve/${a.slug}`} className="town-row group">
                  <span className="display town-name">
                    {a.name}
                    <Stop />
                  </span>
                  <span className="town-note">
                    {TOWN_NOTES[a.slug]}
                    <Arrow className="shrink-0 text-clay-deep transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 05 Who you deal with ────────────────────────────────
          A large line, then three compact columns: the person, the work, and
          the path for owners who already have a manager. */}
      <section className="bg-softwhite py-[var(--section-y)]">
        <div className="shell">
          <RunningHead n="05">Who you deal with</RunningHead>
          <h2 className="display display-xl mt-12 md:mt-16">A person, not a queue.</h2>

          <div className="mt-14 grid gap-x-12 gap-y-14 md:mt-20 md:grid-cols-2 lg:grid-cols-3">
            <div className="arrive border-t border-charcoal pt-5">
              <h3 className="text-[0.8125rem] font-medium uppercase tracking-[0.14em]">The person</h3>
              <p className="mt-4">
                {BRAND.name} is deliberately small, and intends to stay personal as it grows. The
                person you speak to knows your property, your tenants and the history of both.
              </p>
              <div className="mt-8">
                <RuleLink href="/about">About us</RuleLink>
              </div>
            </div>

            <div className="arrive border-t border-charcoal pt-5">
              <h3 className="text-[0.8125rem] font-medium uppercase tracking-[0.14em]">The work</h3>
              <ul className="mt-4 space-y-1.5">
                {SERVICES.map((s) => (
                  <li key={s} className="flex items-baseline gap-3 leading-snug">
                    <Point className="translate-y-[-0.15em] [--pt-size:0.3125rem]" />
                    {s}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <RuleLink href="/property-management">What each involves</RuleLink>
              </div>
            </div>

            <div className="arrive border-t border-charcoal pt-5 md:col-span-2 lg:col-span-1">
              <h3 className="text-[0.8125rem] font-medium uppercase tracking-[0.14em]">Already with another manager?</h3>
              <p className="mt-4">
                Changing is mostly paperwork. Your current agreement sets the notice required, the
                tenancy continues on its existing terms, and we walk you through the handover of
                keys, records and bond details.
              </p>
              <div className="mt-8">
                <RuleLink href="/contact?enquiry=switching">Talk to us about switching</RuleLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Close ───────────────────────────────────────────────
          The number is the display type: the fastest way to a person. */}
      <section id="close" className="on-dark bg-charcoal py-[var(--section-y)] text-ivory">
        <div className="shell">
          <h2 className="display display-cover text-ivory">
            <span className="mask-line">
              <span>
                Let&rsquo;s talk<Stop />
              </span>
            </span>
          </h2>

          <div className="mt-12 grid gap-x-16 gap-y-12 border-t border-taupe/30 pt-10 md:mt-16 lg:grid-cols-12">
            <div className="lg:col-span-7">
              {CONTACT.phone && (
                <a href={telHref(CONTACT.phone)} className="display display-xl tnum block text-ivory no-underline decoration-taupe decoration-1 underline-offset-[0.15em] hover:underline">
                  {CONTACT.phone}
                </a>
              )}
              {CONTACT.email && (
                <a href={`mailto:${CONTACT.email}`} className="mt-4 inline-block break-all text-stone no-underline hover:text-ivory sm:break-normal md:text-lg">
                  {CONTACT.email}
                </a>
              )}
            </div>
            <div className="lg:col-span-4 lg:col-start-9">
              <p className="lede lede-light">
                Or start with a rental appraisal: tell us about the property and we&rsquo;ll be in
                touch to talk it through.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row lg:flex-col">
                <Button href="/rental-appraisal" variant="light">
                  Get a rental appraisal
                </Button>
                <Button href="/contact" variant="ghost-light">
                  Send an enquiry
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
