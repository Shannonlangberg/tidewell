import { Label, Section } from "@/components/planted/ui";

/*
 * NEVER populate this with invented reviews.
 *
 * Only real, attributable quotes from real clients, given with their permission
 * and recorded somewhere we can point to. A fabricated testimonial is a false
 * claim about a person who did not say it, and on a business that is not yet
 * trading it is also a claim about clients that do not exist. Until there is
 * something genuine to show, the list stays empty and this renders nothing.
 */

export type Testimonial = {
  quote: string;
  /** The person, as they agreed to be named. Never invented, never anonymised into a type. */
  attribution: string;
};

export function Testimonials({ items }: { items?: Testimonial[] }) {
  if (!items || items.length === 0) return null;

  return (
    <Section tone="white" className="rule">
      <div className="shell">
        <Label>In their words</Label>

        <ul className="rule mt-12">
          {items.map((t) => (
            <li key={t.attribution} className="border-b border-line py-14">
              <figure className="grid gap-x-16 gap-y-8 md:grid-cols-12">
                <blockquote className="md:col-span-9">
                  <p className="display display-md text-charcoal">{t.quote}</p>
                </blockquote>
                <figcaption className="flex items-end md:col-span-3">
                  <span className="label">{t.attribution}</span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
