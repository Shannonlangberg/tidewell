import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, PhotoPlaceholder, RuleLink, Section, SectionHead } from "@/components/planted/ui";
import {
  IconCare,
  IconCommunication,
  IconModern,
  IconReporting,
  IconStewardship,
} from "@/components/planted/Icons";

/*
 * /about — who PLANTED. is and why it exists.
 *
 * The name carries a quiet idea about roots, foundations and long-term growth.
 * It is expressed here as values and nothing else: no scripture, no symbolism,
 * no religious language. If a line could only be read one way, it is wrong.
 *
 * Nothing on this page is invented. There is no founder name, title, portrait
 * or biography, no staff, no awards, no numbers — only what is actually true
 * about the business today and what it intends.
 */

export const metadata: Metadata = {
  title: "About Us",
  description:
    "PLANTED. was created around a simple belief: property management should be personal, professional and built for the long term. Our values, and where we are starting.",
  alternates: { canonical: "/about" },
};

/** Five values, written for this page: concrete, operational, understated. */
const VALUES = [
  {
    icon: IconStewardship,
    title: "Stewardship",
    body: "A property belongs to someone. We treat it as something held in trust and handed back better, not as a file to be administered.",
  },
  {
    icon: IconReporting,
    title: "Transparency",
    body: "No surprises. Owners see what we see, when we see it, including the things that are inconvenient to report.",
  },
  {
    icon: IconCare,
    title: "Excellence",
    body: "Doing the ordinary work properly and on time, which is harder and far rarer than doing the occasional impressive thing.",
  },
  {
    icon: IconCommunication,
    title: "Relationships",
    body: "Owners, tenants and tradespeople are all people we expect to be dealing with in ten years. We work on that assumption.",
  },
  {
    icon: IconModern,
    title: "Growth",
    body: "Building carefully enough that getting bigger never costs the thing that made the service worth choosing in the first place.",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* ── 1. Opening ──────────────────────────────────────── */}
      {/* Plain section: .section sets padding-block unlayered, so a pt-*
          utility cannot override it, and the fixed header needs clearing. */}
      <section className="bg-ivory pb-20 pt-36 md:pb-28 md:pt-44">
        <div className="shell">
          <div className="reveal reveal-1">
            <Label>About {BRAND.name}</Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[14ch]">
            Built on strong foundations.
          </h1>
          <p className="lede reveal reveal-3 mt-8 max-w-2xl">
            {BRAND.name} was created around a simple belief: property management should be personal,
            professional and built for the long term.
          </p>
        </div>
      </section>

      {/* ── 2. Why we exist ─────────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label>Why we exist</Label>
              <h2 className="display display-lg mt-6">
                More than collecting rent.
              </h2>
            </div>
            <div className="md:col-span-7 md:col-start-6">
              <div className="prose-measure text-ink-muted">
                <p className="lede">
                  Collecting the rent is the straightforward part. Everything that matters sits
                  around it.
                </p>
                <p className="mt-6">
                  Great property management means caring for homes, protecting the investment they
                  represent, supporting the people who live in them, and giving owners enough
                  confidence to plan past the next lease.
                </p>
                <p className="mt-5">
                  That is a slower and more considered way to work. It is also the only version of
                  the job we think is worth doing, and the reason {BRAND.name} exists at all.
                </p>
              </div>
              <div className="mt-10">
                <RuleLink href="/our-approach">Our Approach</RuleLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 3. The name ─────────────────────────────────────── */}
      <Section tone="charcoal">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label tone="light">The name</Label>
              <h2 className="display display-lg mt-6 text-ivory">
                What it means
                <br />
                to be planted.
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure">
                <p className="lede lede-light">
                  Something planted has roots. It is put somewhere deliberately, cared for over
                  years rather than weeks, and judged by what it becomes.
                </p>
                <p className="mt-6 text-stone">
                  That is the whole idea behind the name. Strong foundations. Putting down roots in
                  one region and learning it properly. Growth that is steady rather than hurried.
                  Stewardship of something that belongs to somebody else. And belonging &mdash; for
                  owners, for the people living in these homes, and for the business itself.
                </p>
                <p className="mt-5 text-stone">
                  It is an unusual name for a property company. We chose it because it describes how
                  we intend to work, not how we intend to sound.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 4. Values ───────────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <SectionHead
            label="What we stand for"
            heading={<>Five things that hold everything else up.</>}
          />

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {VALUES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col bg-ivory p-8 lg:p-10">
                <Icon className="text-clay-deep" />
                <h3 className="display display-sm mt-8">{title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">{body}</p>
              </div>
            ))}

            {/* Sixth cell completes the grid rather than leaving a gap in it. */}
            <div className="flex flex-col justify-end bg-ivory p-8 lg:p-10">
              <p className="display display-sm text-clay-deep">{BRAND.tagline}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 5. Who you deal with ────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <div className="grid items-start gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              {/*
                AWAITING REAL CONTENT.
                This section is built and ready for the founder's photograph and
                a short biography. Nothing is written in until it is true: no
                name, no title, no portrait, no history. Replace the placeholder
                below with a real photograph and the holding copy on the right
                with the actual introduction before launch.
              */}
              <PhotoPlaceholder label="Founder portrait to come" ratio="4 / 5" />
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <Label>Who you deal with</Label>
              <h2 className="display display-lg mt-6">A person, not a queue.</h2>
              <div className="prose-measure mt-8 text-ink-muted">
                <p className="lede">
                  {BRAND.name} is deliberately small, and intends to stay personal as it grows.
                </p>
                <p className="mt-6">
                  The point of a small portfolio is that the person you speak to knows your
                  property, knows your tenants and knows the history of both &mdash; so you are not
                  re-explaining yourself to somebody new every time something comes up.
                </p>
                <p className="mt-5 text-[0.9375rem]">
                  A proper introduction, with a photograph, will appear here shortly.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 6. Where this goes ──────────────────────────────── */}
      <Section tone="charcoal">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label tone="light">Where this goes</Label>
              <h2 className="display display-lg mt-6 text-ivory">
                Starting here.
                <br />
                Built to grow.
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure">
                <p className="lede lede-light">
                  The ambition is a property company known for exceptional service, thoughtful
                  innovation and genuine relationships.
                </p>
                <p className="mt-6 text-stone">
                  We are starting on the Copper Coast because it is home, and because knowing one
                  region properly is worth more than covering several of them thinly. What gets
                  built here is designed to grow &mdash; on the condition that growing never costs
                  the personal approach that makes good service possible.
                </p>
              </div>
              <div className="mt-10">
                <RuleLink href="/areas-we-serve" tone="light">
                  Where We Work
                </RuleLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 7. Final call to action ─────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">Let&rsquo;s talk about your property.</h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              If this is the way you would want your investment looked after, we would like to hear
              about it.
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
