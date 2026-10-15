import type { ElementType, ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/*
 * Small, stateless building blocks: SectionLabel, Panel, Skeleton, KeyValueList.
 * Server-safe. Larger structures live in their own files.
 */

// ── SectionLabel ─────────────────────────────────────────────

/** The small uppercase tracked label (11px). Use `as` to make it a heading in the outline. */
export function SectionLabel({
  as: Tag = "p",
  children,
  className,
  id,
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <Tag id={id} className={cx("hq-label", className)}>
      {children}
    </Tag>
  );
}

// ── Panel ────────────────────────────────────────────────────

/** An ivory surface with a hairline border and a 6px radius. No shadow. Use sparingly: whitespace and hairlines come first. */
export function Panel({
  as: Tag = "section",
  children,
  className,
  flush,
  tone = "ivory",
  ...rest
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  /** Remove the inner padding (for tables or lists that run edge to edge). */
  flush?: boolean;
  /** `ivory` (default) or `white` for a panel on an ivory ground. */
  tone?: "ivory" | "white";
  "aria-labelledby"?: string;
  id?: string;
}) {
  return (
    <Tag className={cx("hq-panel", flush && "hq-panel--flush", tone === "white" && "hq-panel--white", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Title on the left (DM Sans 600), a small uppercase meta label and/or an action on the right. */
export function PanelHeader({
  title,
  meta,
  action,
  level = 3,
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3 | 4;
  id?: string;
}) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className="hq-panel__head">
      <H id={id} className="hq-panel__title">
        {title}
      </H>
      {meta ? <span className="hq-panel__meta">{meta}</span> : null}
      {action ? <div className="hq-panel__action">{action}</div> : null}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────

/**
 * A placeholder while data loads. Purely visual (aria-hidden): put `aria-busy="true"`
 * on the region that is loading. The pulse is a gentle fade and stops under
 * prefers-reduced-motion.
 */
export function Skeleton({
  variant = "line",
  width,
  height,
  className,
}: {
  variant?: "line" | "heading" | "block" | "circle";
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "hq-skeleton",
        variant === "block" && "hq-skeleton--block",
        variant === "circle" && "hq-skeleton--circle",
        variant === "heading" && "hq-skeleton--heading",
        className,
      )}
      style={{ width, height }}
    />
  );
}

/** Several skeleton lines of decreasing width. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx("hq-skeleton-text", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "58%" : "100%"} />
      ))}
    </span>
  );
}

// ── KeyValueList ─────────────────────────────────────────────

export type KeyValueItem = {
  label: string;
  /** null, undefined or "" shows the quiet empty text instead. */
  value?: ReactNode;
  /** Override the empty text for this row, e.g. "No follow-up set". */
  empty?: string;
};

/** A definition list: quiet label, medium-weight value. A missing value reads as "Not recorded", never a blank. */
export function KeyValueList({
  items,
  emptyText = "Not recorded",
  className,
}: {
  items: readonly KeyValueItem[];
  emptyText?: string;
  className?: string;
}) {
  return (
    <dl className={cx("hq-kv", className)}>
      {items.map((item) => {
        const missing = item.value === null || item.value === undefined || item.value === "";
        return (
          <div key={item.label} className="hq-kv__row">
            <dt>{item.label}</dt>
            <dd className={missing ? "hq-kv__nil" : undefined}>{missing ? (item.empty ?? emptyText) : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

// ── InlineNote ───────────────────────────────────────────────

/** A quiet, non-alarming note with a clay marker, like the one in the visual reference. For guidance, not errors. */
export function InlineNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("hq-note", className)}>
      <Icon name="info" size={16} className="hq-note__icon" />
      <span>{children}</span>
    </p>
  );
}
