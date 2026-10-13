import type { ReactNode } from "react";

/*
 * Accordion built on native <details>/<summary>, so every question is readable,
 * expandable and linkable with JavaScript switched off. No client component, no
 * state, no library. The marker is drawn from two hairlines on the same 1px grid
 * as the rules in the layout: a plus that turns into a minus when the item opens.
 */

export type FaqItem = {
  q: string;
  /** Usually one or more <p> elements; `.prose-measure` spaces them. */
  a: ReactNode;
};

export function FAQ({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="rule">
      {items.map((item) => (
        <details key={item.q} className="group border-b border-line">
          <summary
            className="flex cursor-pointer list-none items-start justify-between gap-8 py-7 outline-offset-4 [&::-webkit-details-marker]:hidden"
          >
            <h3 className="display display-sm">{item.q}</h3>
            {/* Decorative: the open state is already announced by <details>. */}
            <span aria-hidden="true" className="relative mt-2 block h-4 w-4 shrink-0 text-clay-deep md:mt-3">
              <span className="absolute left-0 top-1/2 block h-px w-4 bg-current" />
              <span className="absolute left-1/2 top-0 block h-4 w-px bg-current transition-transform duration-500 ease-[cubic-bezier(0.22,0.61,0.36,1)] group-open:rotate-90" />
            </span>
          </summary>
          <div className="prose-measure pb-9 text-ink-muted">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
