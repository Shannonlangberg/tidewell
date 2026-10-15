import Link from "next/link";
import { cx } from "./cx";

/*
 * Link-based tabs for views of the same list ("My tasks", "Team", "Overdue"). They are
 * NAVIGATION, not an ARIA tablist: each is a real link, the current one has
 * aria-current="page", and the URL is the state, so back/forward and sharing work.
 */

export type TabItem = {
  label: string;
  href: string;
  /** The current view. The page decides (usually from a search param). */
  current?: boolean;
  /** A quiet count after the label. */
  count?: number | null;
};

export function Tabs({ items, label, className }: { items: readonly TabItem[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cx("hq-tabs", className)}>
      <ul>
        {items.map((t) => (
          <li key={t.href + t.label}>
            <Link href={t.href} className="hq-tabs__link" aria-current={t.current ? "page" : undefined}>
              {t.label}
              {t.count !== undefined && t.count !== null ? <span className="hq-tabs__count">{t.count.toLocaleString("en-AU")}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
