import Link from "next/link";
import type { ReactNode } from "react";

/*
 * The small shared pieces every page is built from. Deliberately few: the system
 * is carried by type, rules and whitespace rather than by a library of boxes.
 */

// ── eyebrow label ────────────────────────────────────────────

export function Label({ children, tone = "dark", className = "" }: { children: ReactNode; tone?: "dark" | "light"; className?: string }) {
  return <p className={`label ${tone === "light" ? "label-light" : ""} ${className}`}>{children}</p>;
}

// ── buttons and links ────────────────────────────────────────

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline" | "light" | "ghost-light";
  className?: string;
};

export function Button({ href, children, variant = "primary", className = "" }: ButtonProps) {
  const cls = `btn btn-${variant} ${className}`.trim();
  const external = href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:");
  if (external) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function RuleLink({ href, children, tone = "dark", className = "" }: { href: string; children: ReactNode; tone?: "dark" | "light"; className?: string }) {
  return (
    <Link href={href} className={`link-rule ${tone === "light" ? "link-rule-light" : ""} ${className}`.trim()}>
      {children}
      <Arrow />
    </Link>
  );
}

export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="8" viewBox="0 0 18 8" fill="none" aria-hidden="true" className={className}>
      <path d="M0 4h16M13 1l3 3-3 3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

// ── section scaffolding ──────────────────────────────────────

export function Section({
  children,
  tone = "ivory",
  className = "",
  id,
}: {
  children: ReactNode;
  tone?: "ivory" | "white" | "charcoal" | "stone";
  className?: string;
  id?: string;
}) {
  const tones = {
    ivory: "bg-ivory text-charcoal",
    white: "bg-softwhite text-charcoal",
    // `on-stone` retunes the muted text colours: stone is light enough that
    // --color-ink-muted only reaches 3.7:1 on it. See planted.css.
    stone: "bg-stone text-charcoal on-stone",
    charcoal: "bg-charcoal text-ivory on-dark",
  } as const;
  return (
    <section id={id} className={`section ${tones[tone]} ${className}`.trim()}>
      {children}
    </section>
  );
}

/**
 * The standard editorial section opening: a label on the left, the heading and
 * supporting copy on the right. Used on nearly every page so the rhythm holds.
 */
export function SectionHead({
  label,
  heading,
  children,
  tone = "dark",
  action,
}: {
  label?: string;
  heading: ReactNode;
  children?: ReactNode;
  tone?: "dark" | "light";
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-x-16 gap-y-8 md:grid-cols-12">
      {label && (
        <div className="md:col-span-3">
          <Label tone={tone}>{label}</Label>
        </div>
      )}
      <div className={label ? "md:col-span-9" : "md:col-span-12"}>
        <h2 className="display display-lg">{heading}</h2>
        {children && <div className={`lede ${tone === "light" ? "lede-light" : ""} prose-measure mt-8`}>{children}</div>}
        {action && <div className="mt-10">{action}</div>}
      </div>
    </div>
  );
}

// ── photography ──────────────────────────────────────────────

/**
 * Stands in for photography that has not been shot or licensed yet. It reads
 * unmistakably as a placeholder: no stock image is ever passed off as the
 * business's own work.
 */
export function PhotoPlaceholder({ label, className = "", ratio = "4 / 3" }: { label: string; className?: string; ratio?: string }) {
  return (
    <div className={`photo-placeholder ${className}`} style={{ aspectRatio: ratio }} role="img" aria-label={`Placeholder for photography: ${label}`}>
      <span
        className="m-5 bg-ivory px-3 py-2 text-charcoal"
        style={{ fontSize: "0.625rem", letterSpacing: "0.18em", textTransform: "uppercase" }}
      >
        {label}
      </span>
    </div>
  );
}
