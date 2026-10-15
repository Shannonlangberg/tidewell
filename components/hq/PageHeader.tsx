import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * Page title area. Two looks:
 *  - default: the title in DM Sans 600 at 26px, for every data page (lists, profiles, forms);
 *  - welcome: Cormorant Garamond, large, for the dashboard greeting ONLY (and sign-in).
 * An `eyebrow` (small uppercase label: a date, the module name) sits above the title.
 */

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({
  items,
  className,
  tone = "default",
  label,
}: {
  items: readonly Crumb[];
  className?: string;
  tone?: "default" | "bar";
  /** The landmark name. Defaults to "Breadcrumb" (or "Breadcrumb, top bar" for tone="bar"), so two on one page stay distinguishable. */
  label?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label ?? (tone === "bar" ? "Breadcrumb, top bar" : "Breadcrumb")} className={cx("hq-crumbs", tone === "bar" && "hq-crumbs--bar", className)}>
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`}>
              {c.href && !last ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={last ? "page" : undefined}>{c.label}</span>
              )}
              {!last ? <Icon name="chevron-right" size={13} className="hq-crumbs__sep" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type PageHeaderProps = {
  /** The page's h1. */
  title: ReactNode;
  /** `welcome` uses Cormorant and is for the dashboard greeting only. */
  variant?: "default" | "welcome";
  /** Small uppercase label above the title: "Thursday 15 October" or "Growth". */
  eyebrow?: ReactNode;
  /** One or two sentences of plain guidance under the title. */
  description?: ReactNode;
  breadcrumbs?: readonly Crumb[];
  /** Buttons on the right (wraps below on narrow screens). */
  actions?: ReactNode;
  /** Chips or other quiet metadata under the description. */
  meta?: ReactNode;
  className?: string;
};

export function PageHeader({ title, variant = "default", eyebrow, description, breadcrumbs, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cx("hq-pageheader", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} className="hq-pageheader__crumbs" /> : null}
      <div className="hq-pageheader__row">
        <div className="hq-pageheader__text">
          {eyebrow ? <p className="hq-label">{eyebrow}</p> : null}
          <h1 className={cx("hq-pageheader__title", variant === "welcome" && "hq-pageheader__title--welcome")}>{title}</h1>
          {description ? <p className="hq-pageheader__desc">{description}</p> : null}
          {meta ? <div className="hq-pageheader__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="hq-pageheader__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
