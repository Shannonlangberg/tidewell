import Link from "next/link";
import { Logo } from "@/components/planted/Logo";
import { cx } from "./cx";
import { HQ_ROUTES } from "./nav";

/*
 * The PLANTED. wordmark: the 2026 outlined logo artwork (components/planted/Logo,
 * the same file the public site uses; never retyped as live text), PROPERTY
 * MANAGEMENT beneath it in small tracked Hanken Grotesk, and a small HQ tag.
 *
 * `tone="onDark"` (default) is for the forest sidebar: ivory letters with the lime
 * full stop. `"onLight"` is for ivory or white screens such as sign-in: forest.
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

/** Cap height of the outlined wordmark per size, in px. */
const LOGO_HEIGHT = { sm: 15, md: 19, lg: 30 } as const;

export function Wordmark({ tone = "onDark", size = "md", descriptor = true, href = HQ_ROUTES.dashboard, className }: WordmarkProps) {
  const body = (
    <>
      <span className="hq-wordmark__name">
        <Logo tone={tone === "onLight" ? "dark" : "light"} height={LOGO_HEIGHT[size]} />
      </span>
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
