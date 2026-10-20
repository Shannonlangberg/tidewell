import type { ReactNode } from "react";

/*
 * Accordion built on native <details>/<summary>, so every item is readable,
 * expandable and linkable with JavaScript switched off. 2026 style (handoff,
 * design/components/content/FAQ): numbered rows, and a plus disc that fills
 * lime and turns to a cross when the row opens. `tone="light"` is for forest
 * bands.
 */

export type FaqItem = {
  q: string;
  /** A string, or one or more <p> elements; `.prose-measure` spaces them. */
  a: ReactNode;
};

export function FAQ({ items, tone = "dark", numbered = true }: { items: FaqItem[]; tone?: "dark" | "light"; numbered?: boolean }) {
  if (items.length === 0) return null;
  const line = tone === "light" ? "border-[var(--line-dark)]" : "border-[var(--line)]";

  return (
    <div className={`border-t ${line}`}>
      {items.map((item, i) => (
        <details key={item.q} className={`pl-faq border-b ${line}`}>
          <summary className={`grid items-center gap-4 py-6 ${numbered ? "grid-cols-[2.5rem_1fr_auto]" : "grid-cols-[1fr_auto]"}`}>
            {numbered && <span className="num">{String(i + 1).padStart(2, "0")}</span>}
            <h3 className="pl-faq-q display-md m-0 text-[clamp(1.2rem,1.7vw,1.5rem)]">{item.q}</h3>
            {/* Decorative: the open state is already announced by <details>. */}
            <span aria-hidden="true" className={`pl-faq-plus ${tone === "light" ? "border-[var(--line-dark)]" : ""}`}>
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M6 0v12M0 6h12" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </span>
          </summary>
          <div className={`prose-measure text-muted pb-7 ${numbered ? "pl-14" : ""}`}>
            {typeof item.a === "string" ? <p>{item.a}</p> : item.a}
          </div>
        </details>
      ))}
    </div>
  );
}
