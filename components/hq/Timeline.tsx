import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./icons";

/*
 * Relationship timeline: an icon marker, a bold title with a quiet meta line (when, who),
 * the note, and an optional chip (e.g. "Follow-up Tue 20 Oct"). A hairline joins the markers.
 * The marker is a 4px-radius square, not a circle: circles are reserved for avatars.
 */

export function Timeline({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <ol className={cx("hq-timeline", className)} aria-label={label}>
      {children}
    </ol>
  );
}

export function TimelineItem({
  icon,
  title,
  meta,
  children,
  footer,
}: {
  icon: IconName;
  title: ReactNode;
  /** "Today, 9:40 am · Shannon" */
  meta?: ReactNode;
  /** The note. */
  children?: ReactNode;
  /** A chip or small action under the note. */
  footer?: ReactNode;
}) {
  return (
    <li className="hq-timeline__item">
      <span className="hq-timeline__marker" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <div className="hq-timeline__body">
        <p className="hq-timeline__head">
          <span className="hq-timeline__title">{title}</span>
          {meta ? <span className="hq-timeline__meta">{meta}</span> : null}
        </p>
        {children ? <div className="hq-timeline__note">{children}</div> : null}
        {footer ? <div className="hq-timeline__footer">{footer}</div> : null}
      </div>
    </li>
  );
}
