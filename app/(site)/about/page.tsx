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
 * or biography, no staff, no awards, no numbers: only what is actually true
 * about the business today and what it intends. The founder introduction below
 * is the one thing this page still needs from a real person.
 */

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Why we started PLANTED., what the name means, and what we are building: a property management company where owners, tenants and our own people are properly looked after.",
  alternates: { canonical: "/about" },
};

/** The people a property touches, and what PLANTED. owes each of them. */
const AUDIENCES = [
  {
    icon: IconStewardship,
    title: "Owners",
    body: "You should know who is looking after your property, what is happening with it and what it is costing you, without having to ask.",
  },
  {
    icon: IconCare,
    title: "Tenants",
    body: "A home is where someone lives, not only an asset on a ledger. Tenants should get a straight answer, a fair process and repairs that are seen to.",
  },
  {
    icon: IconCommunication,
    title: "Our team",
    body: "People do their best work when they have the time, the systems and the support to look after clients properly. We want PLANTED. to be somewhere people are glad to work.",
  },
  {
    icon: IconModern,
    title: "Local trades",
    body: "Plumbers, electricians and builders are part of the same relationship. We aim to brief them clearly, pay them promptly and work with them again.",
  },
  {
    icon: IconReporting,
    title: "The places we work",
    body: "A rental is part of a street and a town. We want to be a good neighbour wherever we work.",
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
            Why we started {BRAND.nameInText}.
          </h1>
          <p className="lede reveal reveal-3 mt-8 max-w-2xl">
            We think property management can be better, for owners, for tenants and for the people who do
            the job. {BRAND.name} is our attempt to build it that way.
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
                What the job really is.
              </h2>
            </div>
            <div className="md:col-span-7 md:col-start-6">
              <div className="prose-measure text-ink-muted">
                <p className="lede">
                  Collecting the rent is the straightforward part. Everything that matters sits
                  around it.
                </p>
                <p className="mt-6">
                  Owners should know what is happening with their property. Tenants should be treated
                  fairly and have repairs seen to. The people managing the property need the time, the
                  systems and the support to make both happen.
                </p>
                <p className="mt-5">
                  We use technology where it saves people time. What owners and tenants remember is
                  whether someone rang them back. {BRAND.name} exists to make sure someone does.
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
                  That is the idea behind the name. Strong foundations. Learning a place properly
                  before claiming to know it. Growth that is steady rather than hurried. Looking
                  after something that belongs to somebody else. And belonging, for owners, for the
                  people living in these homes and for the team.
                </p>
                <p className="mt-5 text-stone">
                  It is an unusual name for a property company. We chose it because it describes how
                  we want to work, not how we want to sound.
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
            label="Who we are here for"
            heading={<>A property involves more people than the owner.</>}
          />

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {AUDIENCES.map(({ icon: Icon, title, body }) => (
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
              <h2 className="display display-lg mt-6">Who you&rsquo;ll deal with.</h2>
              <div className="prose-measure mt-8 text-ink-muted">
                <p className="lede">
                  However many properties we look after, you should be dealing with a person who knows
                  yours.
                </p>
                <p className="mt-6">
                  A manager can only know a property if they have the time to. So we plan the team
                  around the number of properties, and keep each file up to date, so you are not
                  explaining yourself again to someone new every time something comes up.
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
                Where we are
                <br />
                headed.
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure">
                <p className="lede lede-light">
                  We want to build Australia&rsquo;s most loved property management company. We are at the
                  very beginning, and we know it gets earned one property at a time.
                </p>
                <p className="mt-6 text-stone">
                  We are starting on the Copper Coast, because it is better to look after one place
                  properly than several thinly. As we grow, new places will be added once we can
                  properly look after properties there, and the way we work will come with us.
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
              If this is how you would want your investment looked after, we would like to hear from
              you.
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
