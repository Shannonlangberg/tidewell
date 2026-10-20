import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * EmptyState: the title is in the display style; the body is Hanken Grotesk guidance that says what to do next. It must read as real
 * guidance ("No referrals recorded yet. Add your first introduction..."), never filler.
 *
 * ErrorState: a load failure. Hanken Grotesk throughout (it is not an empty-state title),
 * with an alert icon as well as words, and a way to try again.
 */

export function EmptyState({
  title,
  children,
  action,
  as: Heading = "h3",
  compact,
  className,
}: {
  title: string;
  /** Plain guidance: what this will show and what to do next. */
  children?: ReactNode;
  /** A Button or LinkButton. */
  action?: ReactNode;
  as?: "h2" | "h3" | "h4";
  /** Tighter spacing, for inside a panel. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("hq-empty", compact && "hq-empty--compact", className)}>
      <Heading className="hq-empty__title">{title}</Heading>
      {children ? <div className="hq-empty__body">{children}</div> : null}
      {action ? <div className="hq-empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "We could not load this",
  children = "Something went wrong while loading this. Try again in a moment, and if it keeps happening, let the team know.",
  action,
  className,
}: {
  title?: string;
  children?: ReactNode;
  /** A Button (retry) or LinkButton. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cx("hq-error", className)}>
      <Icon name="alert" size={20} className="hq-error__icon" />
      <div>
        <p className="hq-error__title">{title}</p>
        <div className="hq-error__body">{children}</div>
        {action ? <div className="hq-error__action">{action}</div> : null}
      </div>
    </div>
  );
}
