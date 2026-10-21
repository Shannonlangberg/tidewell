import type { Metadata } from "next";
import { AREAS, BRAND, CONTACT, telHref } from "@/lib/planted";
import { Label, Section } from "@/components/planted/ui";
import { ContactForm } from "@/components/planted/ContactForm";
import { ENQUIRY_TYPE_BY_PARAM, turnstileSiteKey } from "@/lib/enquiries";

/*
 * Contact. Every line in the details column is conditional on a real, confirmed
 * value in lib/planted.ts — all of them are null today, so the column currently
 * carries the service areas and a plain statement that the form is the way to
 * reach us. No placeholder numbers, no "coming soon", no apology.
 */

export const metadata: Metadata = {
  title: "Contact",
  description: `Get in touch with ${BRAND.name}. Tell us about your property or ask a question, and a person will come back to you. Residential property management on South Australia's Copper Coast.`,
  alternates: { canonical: "/contact" },
};

export default async function ContactPage({
  searchParams,
}: {
  // In this version of Next.js searchParams is a promise and must be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = params.enquiry;
  const key = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase().trim();
  const initialEnquiryType = (key && ENQUIRY_TYPE_BY_PARAM[key]) || "";

  const hasDetails = Boolean(CONTACT.email || CONTACT.phone || CONTACT.businessHours || CONTACT.address);

  return (
    <>
      {/* Plain section rather than <Section>: the fixed header needs clearing,
          and .section's padding-block is unlayered, so a utility can't move it. */}
      <section className="bg-ivory">
        <div className="shell pb-16 pt-36 md:pb-24 md:pt-44">
          <div className="grid gap-x-16 gap-y-8 md:grid-cols-12">
            <div className="md:col-span-3">
              <div className="reveal reveal-1">
                <Label>Contact</Label>
              </div>
            </div>
            <div className="md:col-span-9">
              <h1 className="display display-xl reveal reveal-2 max-w-[18ch]">
                Good conversations start here.
              </h1>
              <p className="lede prose-measure reveal reveal-3 mt-8">
                Whether you&rsquo;re weighing up your options, thinking about a change of manager or
                simply want to ask a question, we&rsquo;d like to hear from you.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section tone="white" className="rule">
        <div className="shell">
          <div className="grid gap-x-16 gap-y-20 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <ContactForm turnstileSiteKey={turnstileSiteKey()} initialEnquiryType={initialEnquiryType} />
            </div>

            <aside className="lg:col-span-4 lg:col-start-9">
              <Label>Reaching us</Label>

              {hasDetails ? (
                <ul className="mt-8 grid gap-px bg-line">
                  {CONTACT.email && (
                    <li className="bg-softwhite py-6">
                      <p className="label">Email</p>
                      <p className="mt-2 text-[1.0625rem] text-charcoal">
                        <a href={`mailto:${CONTACT.email}`} className="underline underline-offset-4">
                          {CONTACT.email}
                        </a>
                      </p>
                    </li>
                  )}
                  {CONTACT.phone && (
                    <li className="bg-softwhite py-6">
                      <p className="label">Phone</p>
                      <p className="mt-2 text-[1.0625rem] text-charcoal">
                        <a href={telHref(CONTACT.phone)} className="underline underline-offset-4">
                          {CONTACT.phone}
                        </a>
                      </p>
                    </li>
                  )}
                  {CONTACT.businessHours && (
                    <li className="bg-softwhite py-6">
                      <p className="label">Hours</p>
                      <p className="mt-2 text-[1.0625rem] text-charcoal">{CONTACT.businessHours}</p>
                    </li>
                  )}
                  {CONTACT.address && (
                    <li className="bg-softwhite py-6">
                      <p className="label">Address</p>
                      <p className="mt-2 whitespace-pre-line text-[1.0625rem] text-charcoal">
                        {CONTACT.address}
                      </p>
                    </li>
                  )}
                </ul>
              ) : (
                <div className="prose-measure mt-8 text-ink-muted">
                  <p>
                    The form is the way to reach {BRAND.name} It comes straight to us, and
                    we&rsquo;ll reply by email or phone, whichever you prefer.
                  </p>
                </div>
              )}

              <div className="mt-12 border-t border-line pt-8">
                <p className="label">Where we work</p>
                <ul className="mt-5 grid gap-2">
                  {AREAS.map((area) => (
                    <li key={area.slug} className="text-[0.9375rem] text-charcoal">
                      {area.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-[0.9375rem] leading-relaxed text-ink-muted">
                  Residential property management across the {BRAND.region}.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </Section>
    </>
  );
}
