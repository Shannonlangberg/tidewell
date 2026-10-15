import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * The under-768px alternative to a DataTable: one stacked item per row, a clean list
 * rather than a table squeezed sideways (see the pattern note in DataTable.tsx). Pair
 * it with the table through <ResponsiveTable table={...} list={...} />.
 *
 * An item is: a bold title, a quiet subtitle, and a bottom row with a status chip on
 * the left and one short fact on the right ("Follow up Tue"). With `href` the whole item
 * is one link, 44px or more tall.
 */

export function MobileList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <ul className={cx("hq-mlist", className)} aria-label={label}>
      {children}
    </ul>
  );
}

export function MobileListItem({
  href,
  title,
  subtitle,
  status,
  meta,
}: {
  href?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Usually a StatusChip. */
  status?: ReactNode;
  /** One short fact, right-aligned. */
  meta?: ReactNode;
}) {
  const body = (
    <>
      <span className="hq-mitem__top">
        <span className="hq-mitem__text">
          <span className="hq-mitem__title">{title}</span>
          {subtitle ? <span className="hq-mitem__sub">{subtitle}</span> : null}
        </span>
        {href ? <Icon name="chevron-right" size={16} className="hq-mitem__chev" /> : null}
      </span>
      {status || meta ? (
        <span className="hq-mitem__row">
          <span>{status}</span>
          {meta ? <span className="hq-mitem__meta">{meta}</span> : null}
        </span>
      ) : null}
    </>
  );
  return (
    <li className="hq-mitem">
      {href ? (
        <Link href={href} className="hq-mitem__link">
          {body}
        </Link>
      ) : (
        <div className="hq-mitem__link">{body}</div>
      )}
    </li>
  );
}
