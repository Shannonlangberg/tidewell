import type { Metadata } from "next";
import { BRAND } from "@/lib/planted";
import { Button, Label, RuleLink } from "@/components/planted/ui";

/*
 * The shared confirmation page. Both forms land here when the person is
 * submitting without JavaScript, which is why it is a real page rather than a
 * state inside a component.
 *
 * It is reached only by a redirect after a delivered enquiry, so it is kept out
 * of the index — there is nothing here for a search result to offer anyone.
 * It also says nothing about when a reply will come: that is not ours to
 * promise yet.
 */

export const metadata: Metadata = {
  title: "Thank you",
  description: `Your enquiry has reached ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default function EnquiryReceivedPage() {
  return (
    <section className="bg-ivory">
      <div className="shell pb-24 pt-36 md:pb-32 md:pt-44">
        <div className="grid gap-x-16 gap-y-10 md:grid-cols-12">
          <div className="md:col-span-3">
            <div className="reveal reveal-1">
              <Label>Enquiry received</Label>
            </div>
          </div>

          <div className="md:col-span-8">
            <h1 className="display display-xl reveal reveal-2 max-w-[16ch]">
              Thank you for getting in touch.
            </h1>

            <div className="prose-measure reveal reveal-3 mt-10 text-ink-muted">
              <p className="lede">Your enquiry has reached us.</p>
              <p className="mt-6">
                A person at {BRAND.name} will read what you&rsquo;ve sent and come back to you about
                it. If you told us about a property, we&rsquo;ll look at the details you gave us
                before we do.
              </p>
              <p className="mt-5">
                There&rsquo;s nothing else you need to do. If something changes in the meantime, or
                you&rsquo;d like to add to what you sent, send another enquiry and we&rsquo;ll put
                the two together.
              </p>
            </div>

            <div className="reveal reveal-4 mt-14 flex flex-col gap-4 sm:flex-row">
              <Button href="/" variant="outline">
                Back to the Homepage
              </Button>
            </div>

            <div className="rule mt-16 pt-8">
              <RuleLink href="/property-management">How We Manage Properties</RuleLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
