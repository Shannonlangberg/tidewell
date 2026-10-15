import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * FilterBar: a GET form that writes the filters into the URL, so a filtered list can be
 * bookmarked, shared and reached with Back. It uses next/form, so submitting is a
 * client-side navigation (no full reload) and still works with JavaScript off.
 *
 *   <FilterBar action="/hq/growth/contacts" label="Filter contacts" hidden={{ sort, dir }} resetHref="/hq/growth/contacts">
 *     <SearchInput defaultValue={q} placeholder="Search by name or organisation" />
 *     <Select name="status" label="Status" hideLabel placeholder="All statuses" options={...} defaultValue={status} />
 *   </FilterBar>
 *
 * Fields should have `hideLabel` (the bar is compact) but keep their `label` for screen
 * readers. `hidden` carries parameters that must survive a filter change (sort and
 * direction) as hidden inputs. `page` is deliberately NOT carried, so changing a filter
 * returns to page 1. `resetHref` shows a "Clear" link when `active` is true.
 */

export function FilterBar({
  action,
  label,
  children,
  more,
  moreActive,
  moreLabel = "More filters",
  hidden,
  resetHref,
  active,
  applyLabel = "Apply",
  className,
}: {
  /** The pathname the form submits to (the current page). */
  action: string;
  /** Accessible name of the search landmark. */
  label: string;
  children: ReactNode;
  /**
   * Secondary filters, tucked behind a disclosure so the list stays above the fold. It opens by
   * itself when `moreActive` says one of them is in use, so an applied filter is never hidden.
   */
  more?: ReactNode;
  moreActive?: boolean;
  moreLabel?: string;
  hidden?: Record<string, string | undefined | null>;
  resetHref?: string;
  /** Whether any filter is currently applied (shows Clear). */
  active?: boolean;
  applyLabel?: string;
  className?: string;
}) {
  return (
    <Form action={action} role="search" aria-label={label} className={cx("hq-filterbar", className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="hq-filterbar__fields">{children}</div>
      {more ? (
        <details className="hq-filterbar__more" open={moreActive || undefined}>
          <summary className="hq-filterbar__more-summary">{moreLabel}</summary>
          <div className="hq-filterbar__fields hq-filterbar__fields--more">{more}</div>
        </details>
      ) : null}
      <div className="hq-filterbar__actions">
        <button type="submit" className="hq-btn hq-btn--secondary">
          <span className="hq-btn__label">{applyLabel}</span>
        </button>
        {active && resetHref ? (
          <Link href={resetHref} className="hq-filterbar__clear">
            Clear filters
          </Link>
        ) : null}
      </div>
    </Form>
  );
}
