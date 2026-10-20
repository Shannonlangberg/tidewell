import Link from "next/link";
import { BRAND } from "@/lib/planted";

/*
 * The wordmark is typographic, never an illustration: no leaf, tree, root or
 * house. The full stop is part of the name and is always present.
 */

type Props = {
  /** `full` adds the PROPERTY MANAGEMENT descriptor beneath. */
  variant?: "full" | "wordmark" | "monogram";
  tone?: "dark" | "light";
  className?: string;
  /** Wraps the mark in a link home. Off for the footer's display wordmark. */
  href?: string | null;
};

export function Logo({ variant = "wordmark", tone = "dark", className = "", href = "/" }: Props) {
  const colour = tone === "light" ? "text-ivory" : "text-charcoal";

  const mark =
    variant === "monogram" ? (
      <span className={`font-display leading-none ${colour}`} style={{ letterSpacing: "-0.01em" }}>
        P.
      </span>
    ) : (
      <span className="flex flex-col">
        <span
          className={`font-display leading-[0.9] ${colour}`}
          style={{ fontWeight: 400, letterSpacing: "0.04em" }}
        >
          {BRAND.name}
        </span>
        {variant === "full" && (
          <span
            className={tone === "light" ? "text-taupe" : "text-ink-muted"}
            style={{
              fontSize: "0.5625rem",
              fontWeight: 500,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              marginTop: "0.5rem",
            }}
          >
            {BRAND.descriptor}
          </span>
        )}
      </span>
    );

  const content = (
    <span className={`inline-flex ${className}`} aria-label={`${BRAND.name} ${BRAND.descriptor}`}>
      {mark}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="inline-flex no-underline" aria-label={`${BRAND.name}, home`}>
      {content}
    </Link>
  );
}
