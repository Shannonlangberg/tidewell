import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { AREAS, BRAND, CONTACT, telHref } from "@/lib/planted";
import { turnstileSiteKey } from "@/lib/enquiries";
import { Arrow, Button, Lines, PhotoPlaceholder, RuleLink, SecRule } from "@/components/planted/ui";
import { FAQ } from "@/components/planted/FAQ";
import { ContactForm } from "@/components/planted/ContactForm";
import { TownRail } from "@/components/planted/TownRail";
import { Words } from "@/components/planted/Motion";

export const metadata: Metadata = {
  title: `${BRAND.name} | ${BRAND.descriptor}, Copper Coast`,
  description:
    "Residential property management that starts with people. Based on South Australia's Copper Coast, for owners and tenants in Kadina, Wallaroo, Moonta and nearby.",
  alternates: { canonical: "/" },
};

/*
 * The homepage, built to the 2026 Claude Design handoff (design/website):
 * split hero, then (01) approach, (02) owners, (03) tenants, (04) people,
 * (05) community and (06) contact, which flows into the footer.
 *
 * Copy is the approved copy from the handoff, itself drawn from the existing
 * site. No captions say a photograph shows a property PLANTED. manages, and
 * every team or trades image is a labelled placeholder until real photography
 * is commissioned. Motion classes (.rv, .line-mask, .reveal-img, .words) are
 * driven by components/planted/Motion.tsx.
 */

const d = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

const PRINCIPLES = [
  ["Someone who knows your property", "One person looks after it. When you ring, they already know the property, the tenant and the history, without opening a file."],
  ["Updates before you ask", "You hear from us while things are happening, not afterwards. Statements arrive on a set cycle, and a message gets a reply the same business day where we can."],
  ["Inspections that find small things", "Photographed, written up so you can read them, and flagged while a problem is still cheap to fix."],
  ["Systems behind the people", "Records, reports and tasks live in one place, so nothing depends on someone remembering. That is what gives a person time to pick up the phone."],
];

const SERVICES = [
  ["Rental market appraisal", "We look at the property in its own context: condition, presentation, layout, position and what comparable homes nearby are being advertised and leased for. You get a rental range and the reasoning behind it."],
  ["Marketing and leasing", "Proper photography, an honest description and a listing placed where people actually look for a rental. Inspections are run in person, and you hear how the interest is tracking."],
  ["Tenant screening", "Every application is checked properly: identity, income and employment, rental history, references and the tenancy databases. Who lives in your property is your decision to make."],
  ["Routine inspections", "Carried out in person, with photographs and a written report you can actually read. We look for early wear and for work that is cheaper to do now than later."],
  ["Maintenance coordination", "Every request is looked at the day it arrives. Work goes to local trades who know the area and the age of the building, and is followed through to completion."],
  ["Reporting and renewals", "Statements on a predictable cycle, set out so the numbers are easy to follow. Renewal conversations start well before a lease ends, and the decision stays yours."],
];

const TENANT_CARDS: { title: string; body: string; photo?: { src: string; alt: string }; placeholder?: string }[] = [
  {
    title: "Finding a home",
    body: "Inspections run in person, enquiries answered quickly, and an application process that is clear about what we need from you.",
    photo: { src: "/photos/north-beach.jpg", alt: "A limestone house with a deep wraparound verandah and the sea beyond" },
  },
  {
    title: "Repairs that get seen to",
    body: "Every request is looked at the day it arrives. Anything that affects safety, security or an essential service is dealt with straight away.",
    placeholder: "Local tradesperson at a front door — to commission",
  },
  {
    title: "Moving on, fairly",
    body: "The final inspection is compared with the condition report from the start of the tenancy, so fair wear and tear is on record rather than a matter of opinion.",
    photo: { src: "/photos/wallaroo.jpg", alt: "A sandstone villa with a bullnose verandah and cast-iron lacework" },
  },
];

/** Town photographs we hold. The other towns show a labelled placeholder. */
const TOWN_PHOTOS: Record<string, { src: string; alt: string }> = {
  wallaroo: { src: "/photos/wallaroo.jpg", alt: "A sandstone villa with a bullnose verandah" },
  "north-beach": { src: "/photos/north-beach.jpg", alt: "A limestone house with a wraparound verandah" },
  "port-hughes": { src: "/photos/port-hughes.jpg", alt: "A contemporary house above the dunes" },
};

/** The design's order: the three photographed towns first. */
const TOWN_ORDER = ["wallaroo", "north-beach", "port-hughes", "kadina", "moonta", "moonta-bay"];

/** One sentence per town, from the area entries in lib/planted.ts. */
const TOWN_LINES: Record<string, string> = {
  wallaroo: "A working port town with a deep-water harbour and a steady residential community alongside the holiday trade.",
  "north-beach": "A quiet residential pocket north of Wallaroo, close to the sand and well regarded for space and calm.",
  "port-hughes": "A small coastal community known for its jetty, its boat ramp and the golf links on its doorstep.",
  kadina: "The largest of the Copper Triangle towns and the commercial centre of the region.",
  moonta: "Known for its Cornish mining heritage and conservation-listed town centre.",
  "moonta-bay": "The coastal side of Moonta, with a long jetty, a swimming beach and a growing residential strip.",
};

function FeatureCard({ n, title, body, media, href, cta }: { n: string; title: string; body: string; media: ReactNode; href: string; cta: string }) {
  return (
    <Link href={href} className="pl-card">
      <div className="pl-card-media" style={{ aspectRatio: "5 / 4" }}>
        {media}
      </div>
      <div className="flex flex-1 flex-col gap-[0.7rem] px-[1.1rem] pt-6">
        <span className="num">{n}</span>
        <h3 className="display-sm">{title}</h3>
        <p className="text-muted m-0 text-[0.975rem]">{body}</p>
        <span className="pl-card-go mt-auto flex items-center gap-2 pt-5 text-[0.9rem] font-medium">
          {cta}
          <i>
            <Arrow size={12} />
          </i>
        </span>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const towns = TOWN_ORDER.map((slug) => AREAS.find((a) => a.slug === slug)).filter((a) => a !== undefined);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section id="top" className="shell hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div>
            <p className="label rv" style={d(0.1)}>
              Residential property management
            </p>
            <Lines
              as="h1"
              id="hero-title"
              className="display-hero mt-[clamp(1.5rem,3vw,2.5rem)]"
              delay={0.15}
              lines={[
                "Good property management",
                <>
                  starts with <span className="it">people.</span>
                </>,
              ]}
            />
            <div className="rv mt-[clamp(1.5rem,2.5vw,2.25rem)]" style={d(0.55)}>
              <p className="lede">
                Owning an investment property should feel easier. You should know who is looking after
                it, what is happening with it, and that someone genuinely cares.
              </p>
              <div className="hero-actions">
                <Button href="#contact">Let&rsquo;s talk about your property</Button>
                <RuleLink href="#approach" arrow={false}>
                  How we work <Arrow direction="down" size={12} />
                </RuleLink>
              </div>
            </div>
          </div>
          <div className="hero-foot rv" style={d(0.8)}>
            <p className="m-0 font-medium">{BRAND.name} {BRAND.descriptor}</p>
            <p className="text-muted m-0 max-w-[22rem] text-right text-[0.875rem]">
              For owners, and the people who rent from them.
            </p>
          </div>
        </div>
        <div className="hero-media reveal-img" style={d(0.2)}>
          <Image
            src="/photos/12-bayview-road.jpg"
            alt="A contemporary home at dusk, lit from within"
            width={1600}
            height={1333}
            sizes="(min-width: 64rem) 50vw, 100vw"
            preload
            data-parallax="0.5"
          />
          <div className="glass">
            <span>
              <b className="font-medium">A better place</b> for your property
            </span>
            <span aria-hidden="true" className="inline-flex items-center gap-2 opacity-85">
              Scroll <Arrow direction="down" size={12} />
            </span>
          </div>
        </div>
      </section>

      {/* ── 01 Our approach ─────────────────────────────────────── */}
      <section id="approach" className="section" aria-labelledby="approach-h">
        <div className="shell">
          <SecRule label="Our approach" n="01" className="rv" />
          <h2 id="approach-h" className="sr-only">
            Our approach
          </h2>
          <div className="pl-grid mt-[clamp(3rem,6vw,5rem)]">
            <div className="md:col-span-10 md:col-start-3">
              <Words text="Most of property management is small things done on time, and telling you about them before you have to ask. That is what we are building PLANTED around." />
            </div>
          </div>
          <div className="principles">
            {PRINCIPLES.map(([title, body], i) => (
              <div key={title} className="principle rv" style={d(i * 0.08)}>
                <span className="num">0{i + 1}</span>
                <h3 className="display-sm">{title}</h3>
                <p className="text-muted m-0 text-[0.975rem]">{body}</p>
              </div>
            ))}
          </div>
          <div className="rv mt-12">
            <RuleLink href="/our-approach">Our approach in full</RuleLink>
          </div>
        </div>
      </section>

      {/* ── 02 For property owners ──────────────────────────────── */}
      <section id="owners" className="section on-dark bg-forest text-ivory" aria-labelledby="owners-h">
        <div className="shell">
          <SecRule label="For property owners" n="02" className="rv" />
          <div className="pl-grid mt-[clamp(3rem,6vw,5rem)] gap-y-12">
            <div className="md:col-span-5">
              <div className="md:sticky md:top-24">
                <Lines id="owners-h" lines={["What we look after", <span key="c" className="it">for you.</span>]} />
                <p className="lede rv mt-7">
                  Management is a long list of small jobs done on time. Here is each one in plain terms.
                </p>
                <div className="rv mt-9">
                  <Button href="#contact" variant="light">
                    Request an appraisal
                  </Button>
                </div>
                <div className="media-frame reveal-img mt-[clamp(2.5rem,5vw,4rem)] aspect-[4/3]">
                  <Image
                    src="/photos/port-hughes.jpg"
                    alt="A contemporary two-storey house with a glass-balustraded deck, looking over the dunes at dusk"
                    width={1580}
                    height={1046}
                    sizes="(min-width: 48rem) 40vw, 100vw"
                    data-parallax="0.3"
                  />
                </div>
              </div>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="rv">
                <FAQ tone="light" items={SERVICES.map(([q, a]) => ({ q, a }))} />
              </div>
              <p className="text-muted rv mt-8 max-w-[34rem] text-[0.875rem]">
                Fees in writing before anything is signed. If you are switching managers, any transfer is
                subject to your existing management agreement and the notice it requires.
              </p>
              <div className="rv mt-8">
                <RuleLink href="/property-management" tone="light">
                  Everything management covers
                </RuleLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 For tenants ──────────────────────────────────────── */}
      <section id="tenants" className="section bg-stone" aria-labelledby="tenants-h">
        <div className="shell">
          <SecRule label="For tenants" n="03" className="rv" />
          <div className="mt-[clamp(3rem,6vw,5rem)] flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
            <Lines
              id="tenants-h"
              lines={[
                "A home that’s",
                <>
                  <span className="it">looked after.</span>
                </>,
              ]}
            />
            <p className="lede rv max-w-[26rem]">
              Good tenancies depend on both sides being treated fairly. You will know who to call, what
              happens next and when.
            </p>
          </div>
          <div className="cards3">
            {TENANT_CARDS.map((c, i) => (
              <div key={c.title} className="rv flex" style={d(i * 0.1)}>
                <FeatureCard
                  n={`0${i + 1}`}
                  title={c.title}
                  body={c.body}
                  href="/contact?enquiry=tenant"
                  cta="Get in touch"
                  media={
                    c.photo ? (
                      <Image src={c.photo.src} alt={c.photo.alt} fill sizes="(min-width: 64rem) 31vw, 100vw" className="img-cover" />
                    ) : (
                      <PhotoPlaceholder label={c.placeholder ?? "Photography to commission"} ratio="5 / 4" className="!rounded-none" />
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 04 Our people ───────────────────────────────────────── */}
      <section id="people" className="section" aria-labelledby="people-h">
        <div className="shell">
          <SecRule label="Our people" n="04" className="rv" />
          <div className="pl-grid mt-[clamp(3rem,6vw,5rem)] gap-y-6">
            <div className="flex flex-col justify-between gap-12 md:col-span-5">
              <div>
                <Lines id="people-h" lines={["The people", <span key="m" className="it">behind it.</span>]} />
                <div className="rv mt-7 grid max-w-[30rem] gap-[1.1rem]">
                  <p className="lede text-ink">
                    We want to still be dealing with the same owners, tenants and trades in ten years. That
                    changes how you handle every conversation, including the hard ones.
                  </p>
                  <p className="text-muted m-0">
                    When you ring, you reach someone who already knows your property.
                  </p>
                </div>
                <div className="rv mt-8">
                  <RuleLink href="/about">About {BRAND.nameInText}</RuleLink>
                </div>
              </div>
              <div className="media-frame reveal-img aspect-[4/3]">
                <PhotoPlaceholder label="Owner and property manager in conversation — to commission" ratio="4 / 3" className="h-full !rounded-none" />
              </div>
            </div>
            <div className="md:col-span-6 md:col-start-7">
              <div className="media-frame reveal-img aspect-[4/5]" style={d(0.15)}>
                <PhotoPlaceholder label="Portrait of a PLANTED. property manager on site — to commission" ratio="4 / 5" className="h-full !rounded-none" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 05 Community ────────────────────────────────────────── */}
      <section id="community" className="section !pt-0" aria-labelledby="community-h">
        <div className="shell">
          <SecRule label="Where we begin" n="05" className="rv" />
        </div>
        <TownRail
          head={
            <>
              <Lines
                id="community-h"
                lines={["Where we", <span key="b" className="it">are starting.</span>]}
              />
              <p className="lede rv mt-6">
                {BRAND.name} begins on South Australia&rsquo;s Copper Coast, in the towns below. We will add
                a place to this list only once we can look after properties there properly.
              </p>
            </>
          }
        >
          {towns.map((t, i) => {
            const photo = TOWN_PHOTOS[t.slug];
            return (
              <article key={t.slug} className="town rv" style={d(i * 0.06)}>
                <Link href={`/areas-we-serve/${t.slug}`} className="block no-underline" draggable={false}>
                  <div className="media-frame">
                    {photo ? (
                      <Image src={photo.src} alt={photo.alt} width={1580} height={1046} sizes="(min-width: 64rem) 24rem, 75vw" draggable={false} />
                    ) : (
                      <PhotoPlaceholder label={`${t.name} photography to come`} ratio="3 / 4" className="!rounded-none" />
                    )}
                  </div>
                  <h3 className="display-sm">{t.name}</h3>
                </Link>
                <p className="text-muted m-0 text-[0.95rem]">{TOWN_LINES[t.slug]}</p>
              </article>
            );
          })}
        </TownRail>
        <div className="shell rv mt-10">
          <RuleLink href="/areas-we-serve">All the areas we serve</RuleLink>
        </div>
      </section>

      {/* ── 06 Contact & appraisal ──────────────────────────────── */}
      <section id="contact" className="on-dark contact-band bg-forest text-ivory" aria-labelledby="contact-h">
        <div className="shell section !pb-[clamp(3rem,6vw,5rem)]">
          <div className="sec-rule rv">
            <p className="label">Contact &amp; appraisal</p>
            <span className="num">(06)</span>
          </div>
          <div className="pl-grid mt-[clamp(3rem,6vw,5rem)] gap-y-14">
            <div className="md:col-span-5">
              <Lines
                id="contact-h"
                lines={[
                  "Let’s talk about",
                  <>
                    your <span className="it">property.</span>
                  </>,
                ]}
              />
              <p className="lede rv mt-7">
                A good first step is a rental appraisal. It costs nothing and commits you to nothing. You
                come away knowing what the property could rent for and what looking after it would involve.
              </p>
              <dl className="rv mt-12 grid gap-5">
                {CONTACT.phone && (
                  <div className="dl-row">
                    <dt className="text-muted text-[0.875rem]">Phone</dt>
                    <dd className="m-0">
                      <RuleLink href={telHref(CONTACT.phone)} tone="light" arrow={false}>
                        {CONTACT.phone}
                      </RuleLink>
                    </dd>
                  </div>
                )}
                {CONTACT.email && (
                  <div className="dl-row">
                    <dt className="text-muted text-[0.875rem]">Email</dt>
                    <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">
                      <RuleLink href={`mailto:${CONTACT.email}`} tone="light" arrow={false}>
                        {CONTACT.email}
                      </RuleLink>
                    </dd>
                  </div>
                )}
              </dl>
              <p className="text-muted rv mt-8 text-[0.875rem]">
                Prefer to tell us more about the property first? Use the{" "}
                <Link href="/rental-appraisal" className="underline underline-offset-4 hover:text-lime">
                  full rental appraisal form
                </Link>
                .
              </p>
            </div>
            <div className="rv md:col-span-6 md:col-start-7">
              <ContactForm turnstileSiteKey={turnstileSiteKey()} initialEnquiryType="Rental Appraisal" tone="dark" />
            </div>
          </div>
        </div>
      </section>

      {/* Phones: the next step at thumb height once the hero has gone, hidden
          again at the contact band (Motion.tsx toggles it). */}
      <div className="mcta" aria-hidden="true" inert>
        <Button href="#contact">Let&rsquo;s talk</Button>
      </div>
    </>
  );
}
