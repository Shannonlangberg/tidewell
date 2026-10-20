import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { AREAS, BRAND } from "@/lib/planted";
import { Button, Label, RuleLink, Section, SectionHead } from "@/components/planted/ui";
import { IconCare, IconCommunication, IconLocal, IconModern } from "@/components/planted/Icons";

export const metadata: Metadata = {
  title: `${BRAND.name} | ${BRAND.descriptor}, Copper Coast`,
  description:
    "Thoughtful residential property management on the Copper Coast. Proactive care, clear communication and local knowledge for investment property owners in Kadina, Wallaroo, Moonta and nearby.",
  alternates: { canonical: "/" },
};

const VALUES = [
  {
    icon: IconCare,
    title: "Proactive Property Care",
    body: "Regular inspections, attentive maintenance coordination and a long-term approach to protecting your investment.",
  },
  {
    icon: IconCommunication,
    title: "Communication That Matters",
    body: "Clear updates, responsive service and a property management relationship built around transparency.",
  },
  {
    icon: IconLocal,
    title: "Local Market Knowledge",
    body: "A grounded understanding of the Copper Coast rental market and the communities we serve.",
  },
  {
    icon: IconModern,
    title: "Modern Management",
    body: "Efficient digital processes, accessible information and thoughtful systems designed to make ownership easier.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Let's Talk",
    body: "Tell us about your property and what matters most to you.",
  },
  {
    n: "02",
    title: "Your Property, Our Plan",
    body: "We'll discuss your property's needs, rental potential and a tailored management approach.",
  },
  {
    n: "03",
    title: "Consider It Cared For",
    body: "Once appointed, we coordinate the management process and keep you informed along the way.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ── 1. Hero ─────────────────────────────────────────── */}
      <section className="on-dark relative flex min-h-[min(100svh,54rem)] flex-col justify-end overflow-hidden bg-charcoal">
        <Image
          src="/photos/12-bayview-road.jpg"
          alt="A contemporary Copper Coast home at dusk, lit from within"
          fill
          priority
          sizes="100vw"
          className="img-cover object-[center_62%]"
        />
        {/* Readability scrim: weighted to the bottom where the type sits. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(23,23,23,0.86) 0%, rgba(23,23,23,0.62) 34%, rgba(23,23,23,0.3) 66%, rgba(23,23,23,0.42) 100%)" }}
        />

        <div className="shell relative z-10 pb-20 pt-40 md:pb-28">
          <div className="reveal reveal-1">
            <Label tone="light">
              {BRAND.descriptor} &middot; Copper Coast
            </Label>
          </div>
          <h1 className="display display-xl reveal reveal-2 mt-8 max-w-[16ch] text-ivory">
            Your property deserves to be well looked after.
          </h1>
          <p className="lede lede-light reveal reveal-3 mt-8 max-w-xl">
            Thoughtful property management for people who expect more. Local expertise, proactive care
            and clear communication, designed to protect what matters.
          </p>
          <div className="reveal reveal-4 mt-12 flex flex-col gap-4 sm:flex-row">
            <Button href="/rental-appraisal" variant="light">
              Get a Rental Appraisal
            </Button>
            <Button href="/why-planted" variant="ghost-light">
              Discover {BRAND.name}
            </Button>
          </div>
        </div>

        <div aria-hidden="true" className="shell relative z-10 pb-10">
          <span className="flex items-center gap-4 text-[0.625rem] uppercase tracking-[0.22em] text-stone/70">
            Scroll
            <span className="relative block h-px w-16 overflow-hidden bg-stone/30">
              <span className="scroll-tick absolute inset-y-0 left-0 w-6 bg-stone" />
            </span>
          </span>
        </div>
      </section>

      {/* ── 2. Introduction ─────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <Label>Welcome to {BRAND.name}</Label>
              <h2 className="display display-lg mt-6">
                Property management, thoughtfully reimagined.
              </h2>
            </div>
            <div className="md:col-span-7 md:col-start-6">
              <div className="prose-measure text-ink-muted">
                <p className="lede">Your investment property deserves more than routine management.</p>
                <p className="mt-6">
                  At {BRAND.name} we believe exceptional property management starts with genuine care,
                  clear communication and a long-term perspective.
                </p>
                <p className="mt-5">
                  We combine local knowledge with modern systems to make owning an investment property
                  feel simpler, more transparent and better supported.
                </p>
              </div>
              <div className="mt-10">
                <RuleLink href="/our-approach">Our Approach</RuleLink>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 3. Value proposition ────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <SectionHead label="Why owners choose us" heading={<>More than management.<br />Peace of mind.</>} />

          <div className="mt-20 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col bg-softwhite p-8 lg:p-10">
                <Icon className="text-clay-deep" />
                <h3 className="display display-sm mt-8">{title}</h3>
                <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 4. Feature image ────────────────────────────────── */}
      <section className="on-dark relative flex min-h-[32rem] items-center overflow-hidden bg-charcoal py-28 md:min-h-[40rem]">
        <Image
          src="/photos/port-hughes.jpg"
          alt="A Copper Coast house in late afternoon light"
          fill
          sizes="100vw"
          className="img-cover object-[center_58%]"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
        <div className="shell relative z-10">
          <blockquote className="max-w-3xl">
            <p className="display display-lg text-ivory">
              Good property management is an investment in the future.
            </p>
            <footer className="mt-10">
              <p className="label label-light">Protecting today. Preparing for tomorrow.</p>
            </footer>
          </blockquote>
        </div>
      </section>

      {/* ── 5. How it works ─────────────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <SectionHead label="How it works" heading={<>A simpler way to manage your property.</>} />

          {/* A real sequence, so the numbers carry meaning. */}
          <ol className="mt-20 grid gap-px bg-line md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-ivory pr-8 md:p-10 md:pl-10">
                <p className="display text-[2.5rem] leading-none text-clay">{s.n}</p>
                <h3 className="display display-sm mt-6">{s.title}</h3>
                <p className="mt-4 max-w-sm text-[0.9375rem] leading-relaxed text-ink-muted">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-16">
            <Button href="/rental-appraisal" variant="outline">
              Start With a Rental Appraisal
            </Button>
          </div>
        </div>
      </Section>

      {/* ── 6. Switching ────────────────────────────────────── */}
      <Section tone="stone">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label>Switching managers</Label>
              <h2 className="display display-lg mt-6">
                Ready for a better property management experience?
              </h2>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="prose-measure">
                <p className="lede">
                  Changing property managers doesn&rsquo;t need to feel complicated.
                </p>
                <p className="mt-6 text-ink-muted">
                  If you&rsquo;re considering a change, we&rsquo;ll explain the process, review your
                  current arrangements and help you understand the next steps.
                </p>
                <p className="mt-5 text-[0.9375rem] text-ink-muted">
                  Any transfer is subject to your existing management agreement and the notice it
                  requires, along with the applicable South Australian requirements.
                </p>
              </div>
              <div className="mt-10">
                <Button href="/contact?enquiry=switching" variant="primary">
                  Let&rsquo;s Talk About Switching
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 7. Local expertise ──────────────────────────────── */}
      <Section tone="ivory" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-12 md:grid-cols-12">
            <div className="md:col-span-5">
              <Label>Where we work</Label>
              <h2 className="display display-lg mt-6">
                Proudly local.<br />Built for what comes next.
              </h2>
              <div className="prose-measure mt-8 text-ink-muted">
                <p>
                  Beginning on South Australia&rsquo;s Copper Coast, {BRAND.name} is built around the
                  communities we know and the people who invest in them.
                </p>
                <p className="mt-5">
                  Our focus is simple: exceptional property management, strong relationships and
                  lasting value.
                </p>
              </div>
              <div className="mt-10">
                <RuleLink href="/areas-we-serve">Explore Our Service Areas</RuleLink>
              </div>
            </div>

            <div className="md:col-span-6 md:col-start-7">
              <ul className="rule">
                {AREAS.map((area) => (
                  <li key={area.slug} className="border-b border-line">
                    <Link
                      href={`/areas-we-serve/${area.slug}`}
                      className="group flex items-baseline justify-between gap-6 py-6 no-underline transition-[padding] duration-500 hover:pl-3"
                    >
                      <span className="display display-sm">{area.name}</span>
                      <span className="label transition-colors duration-500 group-hover:text-clay-deep">
                        South Australia
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 8. Brand statement ──────────────────────────────── */}
      <Section tone="charcoal">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <p className="display display-xl text-ivory">
                People.<br />Property.<br />Potential.
              </p>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <p className="lede lede-light max-w-sm">
                We believe the best investments are built on strong foundations and thoughtful care.
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── 9. Final call to action ─────────────────────────── */}
      <Section tone="ivory">
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="display display-lg">Let&rsquo;s talk about your property.</h2>
            <p className="lede mx-auto mt-8 max-w-xl">
              Whether you&rsquo;re investing for the first time or looking for a more considered
              management experience, we&rsquo;d love to hear from you.
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
