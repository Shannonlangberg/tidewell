import Link from "next/link";
import { cx } from "./cx";
import { HQ_ROUTES } from "./nav";

/*
 * The PLANTED. wordmark, as in the approved reference: "PLANTED." in Cormorant 500
 * with 0.05em tracking (the full stop is permanent), PROPERTY MANAGEMENT beneath it in
 * tiny tracked DM Sans, and a small HQ tag. No leaves, buildings or icons, ever.
 *
 * `tone="onDark"` (default) is for the charcoal sidebar; `"onLight"` for ivory or
 * soft-white screens such as sign-in. The wordmark is a logotype, so it is exempt from
 * the text-size contrast rules, but both tones still pass them.
 */

export type WordmarkProps = {
  tone?: "onDark" | "onLight";
  size?: "sm" | "md" | "lg";
  /** Show PROPERTY MANAGEMENT and the HQ tag. Default true. */
  descriptor?: boolean;
  /** Link to the dashboard. Pass false on screens that are not signed in. */
  href?: string | false;
  className?: string;
};

export function Wordmark({ tone = "onDark", size = "md", descriptor = true, href = HQ_ROUTES.dashboard, className }: WordmarkProps) {
  const body = (
    <>
      <span className="hq-wordmark__name">PLANTED.</span>
      {descriptor ? (
        <span className="hq-wordmark__row">
          <span className="hq-wordmark__desc">Property Management</span>
          {/* Spaces keep the link's accessible name readable: "PLANTED. Property Management HQ". */}{" "}
          <span className="hq-wordmark__tag">HQ</span>
        </span>
      ) : null}
      {href !== false ? <span className="sr-only">, dashboard</span> : null}
    </>
  );
  const classes = cx("hq-wordmark", tone === "onLight" && "hq-wordmark--light", size !== "md" && `hq-wordmark--${size}`, className);
  if (href === false) {
    return <span className={classes}>{body}</span>;
  }
  return (
    <Link href={href} className={classes}>
      {body}
    </Link>
  );
}
