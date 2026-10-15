import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * The statistics band: a FLAT strip divided by hairlines, not a row of boxed cards.
 * Every figure is DM Sans (tabular numerals), never a serif.
 *
 * A Stat whose `value` is null shows an em dash and its hint ("Appears once connected
 * to Ailo"): the band never shows an invented number. A value of 0 is shown quietly
 * (grey, regular weight) as in the visual reference; pass `quiet={false}` to keep it bold.
 */

export function StatBand({
  children,
  columns = 4,
  label,
  className,
}: {
  children: ReactNode;
  /** Columns from 768px up (2 columns below). Default 4. */
  columns?: 2 | 3 | 4;
  /** Accessible name for the group, e.g. "Growth at a glance". */
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("hq-statband", className)} data-cols={columns}>
      {children}
    </div>
  );
}

export type StatProps = {
  label: string;
  /** A number or short string. null means "no data": an em dash and the hint. */
  value: number | string | null;
  hint?: ReactNode;
  /** Make the whole cell a link (e.g. to the filtered list behind the number). */
  href?: string;
  quiet?: boolean;
  className?: string;
};

export function Stat({ label, value, hint, href, quiet, className }: StatProps) {
  const empty = value === null;
  const isQuiet = quiet ?? (empty || value === 0 || value === "0");
  const display = empty ? "—" : typeof value === "number" ? value.toLocaleString("en-AU") : value;
  const body = (
    <>
      <p className="hq-label">{label}</p>
      <p className={cx("hq-stat__value", isQuiet && "hq-stat__value--quiet")}>
        {empty ? <span aria-hidden="true">{display}</span> : display}
        {empty ? <span className="sr-only">No data yet</span> : null}
      </p>
      {hint ? <p className="hq-stat__hint">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className={cx("hq-stat hq-stat--link", className)}>
      {body}
    </Link>
  ) : (
    <div className={cx("hq-stat", className)}>{body}</div>
  );
}
