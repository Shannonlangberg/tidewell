import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/planted";
import { Label, RuleLink, Section } from "@/components/planted/ui";
import { IconCare, IconCommunication, IconLocal } from "@/components/planted/Icons";
import { turnstileSiteKey } from "@/lib/enquiries";
import { AppraisalForm } from "@/components/planted/AppraisalForm";

/*
 * The primary conversion page. Everything above the form earns the form, and
 * nothing on it promises a timeframe, a fee or a figure: those are not ours to
 * state until they are real.
 */

export const metadata: Metadata = {
  title: "Rental Appraisal",
  description:
    "Request a rental appraisal for your Copper Coast investment property. Tell us about the property and we'll be in touch to discuss its rental potential.",
  alternates: { canonical: "/rental-appraisal" },
};

const STEPS = [
  {
    icon: IconCare,
    title: "Tell us about the property",
    body: "Four short steps: where it is, what it is, how it's managed today and how to reach you.",
  },
  {
    icon: IconCommunication,
    title: "We'll be in touch",
    body: "We'll talk through your property's rental potential and what managing it well would involve.",
  },
  {
    icon: IconLocal,
    title: "Decide in your own time",
    body: "Asking for an appraisal doesn't commit you to anything.",
  },
];

export default function RentalAppraisalPage() {
  return (
    <>
      {/* ── Opening ─────────────────────────────────────────
          Plain section rather than <Section>: the fixed header needs clearing
          and .section's padding-block is unlayered, so a utility can't move it. */}
      <section className="bg-ivory">
        <div className="shell pb-16 pt-36 md:pb-24 md:pt-44">
          <div className="grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-3">
              <div className="reveal reveal-1">
                <Label>Rental appraisal</Label>
              </div>
            </div>
            <div className="md:col-span-9">
              <h1 className="display display-xl reveal reveal-2 max-w-[18ch]">
                Know your property&rsquo;s potential.
              </h1>
              <p className="lede prose-measure reveal reveal-3 mt-8">
                Tell us a little about your investment property, and we&rsquo;ll be in touch to
                discuss its rental potential and how {BRAND.name} may be able to help.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── The form ────────────────────────────────────────── */}
      <Section tone="white" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-16 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <AppraisalForm turnstileSiteKey={turnstileSiteKey()} />
            </div>

            <aside className="lg:col-span-4 lg:col-start-9">
              <Label>How this works</Label>
              <ol className="mt-8 grid gap-px bg-line">
                {STEPS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="bg-softwhite py-8 pr-2">
                    <Icon className="text-clay-deep" />
                    <h2 className="display display-sm mt-5">{title}</h2>
                    <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{body}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-10 text-[0.9375rem] leading-relaxed text-ink-muted">
                Prefer to ask something first? The{" "}
                <Link href="/contact" className="underline underline-offset-4">
                  contact form
                </Link>{" "}
                reaches the same place.
              </p>
            </aside>
          </div>
        </div>
      </Section>

      {/* ── Closing ─────────────────────────────────────────── */}
      <Section tone="forest" rounded>
        <div className="shell">
          <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <h2 className="display display-lg text-ivory">
                Thoughtful management starts with a conversation.
              </h2>
            </div>
            <div className="flex items-end md:col-span-4 md:col-start-9">
              <div>
                <p className="lede lede-light max-w-sm">
                  If you&rsquo;d rather understand our approach before you ask for an appraisal,
                  start there instead.
                </p>
                <div className="mt-10">
                  <RuleLink href="/our-approach" tone="light">
                    Our Approach
                  </RuleLink>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
