import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/*
 * The small shared pieces every page is built from, in the 2026 style (see the
 * Claude Design handoff, design/components/*). Existing props are kept so pages
 * that predate the redesign keep working; new options are additive.
 */

// ── arrows ───────────────────────────────────────────────────

/** 14px arrow, 1.4 stroke, currentColor. */
export function Arrow({
  direction = "right",
  size = 14,
  className = "",
}: {
  direction?: "right" | "down" | "left" | "up";
  size?: number;
  className?: string;
}) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={className}
      style={rot ? { transform: `rotate(${rot}deg)` } : undefined}
    >
      <path d="M1 7h11.5M8 2.5 12.5 7 8 11.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// ── eyebrow label ────────────────────────────────────────────

export function Label({ children, tone = "dark", className = "" }: { children: ReactNode; tone?: "dark" | "light"; className?: string }) {
  return <p className={`label ${tone === "light" ? "label-light" : ""} ${className}`.trim()}>{children}</p>;
}

// ── buttons and links ────────────────────────────────────────

type Variant = "primary" | "outline" | "light" | "lime" | "ghost-light";

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: Variant;
  size?: "md" | "sm";
  arrow?: boolean;
  block?: boolean;
  className?: string;
};

export function buttonClass({ variant = "primary", size = "md", arrow = true, block = false, className = "" }: Omit<ButtonProps, "href" | "children">) {
  return [
    "btn",
    variant !== "primary" ? `btn-${variant}` : "",
    size === "sm" ? "btn-sm" : "",
    arrow ? "" : "btn-noarrow",
    block ? "btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The arrow disc: one arrow slides out to the right as its twin slides in. */
export function ButtonArrow() {
  return (
    <span className="ar" aria-hidden="true">
      <Arrow />
      <Arrow />
    </span>
  );
}

/** Pill button: a lime layer rises on hover and the arrow slides through its disc. */
export function Button({ href, children, variant = "primary", size = "md", arrow = true, block = false, className = "" }: ButtonProps) {
  const cls = buttonClass({ variant, size, arrow, block, className });
  const inner = (
    <>
      <span>{children}</span>
      {arrow && <ButtonArrow />}
    </>
  );
  const external = href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:");
  if (external) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/** Text link: the underline retracts on hover and the arrow nudges forward. */
export function RuleLink({
  href,
  children,
  tone = "dark",
  arrow = true,
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: "dark" | "light";
  arrow?: boolean;
  className?: string;
}) {
  const style = { color: tone === "light" ? "var(--planted-ivory)" : "var(--planted-ink)" };
  const inner = (
    <>
      {children}
      {arrow && <Arrow />}
    </>
  );
  if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return (
      <a href={href} className={`link-rule ${className}`.trim()} style={style}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={`link-rule ${className}`.trim()} style={style}>
      {inner}
    </Link>
  );
}

// ── section scaffolding ──────────────────────────────────────

type Tone = "ivory" | "white" | "stone" | "forest" | "charcoal";

const TONES: Record<Tone, string> = {
  ivory: "bg-ivory text-ink",
  white: "bg-white text-ink",
  stone: "bg-stone text-ink",
  forest: "bg-forest text-ivory on-dark",
  // Pre-2026 name, kept as an alias for forest.
  charcoal: "bg-forest text-ivory on-dark",
};

/** A full-width band with the system's vertical rhythm. */
export function Section({
  children,
  tone = "ivory",
  className = "",
  id,
  rounded = false,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  id?: string;
  /** Rounded top corners: the contact band that flows into the footer. */
  rounded?: boolean;
  style?: CSSProperties;
}) {
  return (
    <section id={id} className={`section ${TONES[tone]} ${rounded ? "contact-band" : ""} ${className}`.trim()} style={style}>
      {children}
    </section>
  );
}

/** The numbered rule every section opens with: eyebrow on the left, (01) on the right. */
export function SecRule({ label, n, className = "" }: { label: string; n?: string; className?: string }) {
  return (
    <div className={`sec-rule ${className}`.trim()}>
      <p className="label">{label}</p>
      {n && <span className="num">({n})</span>}
    </div>
  );
}

/**
 * The standard section opening: the numbered rule, then a large heading with an
 * optional lede (and action) set beside it.
 */
export function SectionHead({
  label,
  n,
  heading,
  children,
  tone = "dark",
  action,
}: {
  label?: string;
  n?: string;
  heading: ReactNode;
  children?: ReactNode;
  tone?: "dark" | "light";
  action?: ReactNode;
}) {
  return (
    <div>
      {label && <SecRule label={label} n={n} />}
      <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-6 ${label ? "mt-[clamp(3rem,6vw,5rem)]" : ""}`}>
        <h2 className="display-xl max-w-[16ch]">{heading}</h2>
        {(children || action) && (
          <div className="max-w-[26rem]">
            {children && <div className={`lede ${tone === "light" ? "lede-light" : ""}`}>{children}</div>}
            {action && <div className="mt-7">{action}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/** A headline whose lines rise from a mask, 90ms apart (see Motion.tsx). */
export function Lines({
  lines,
  as: Tag = "h2",
  className = "display-xl",
  delay = 0,
  id,
}: {
  lines: ReactNode[];
  as?: "h1" | "h2" | "h3";
  className?: string;
  delay?: number;
  id?: string;
}) {
  return (
    <Tag id={id} className={className}>
      {lines.map((line, i) => (
        <span key={i} className="line-mask" style={{ "--d": `${delay + i * 0.09}s` } as CSSProperties}>
          <span>{line}</span>
        </span>
      ))}
    </Tag>
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
    <div className={`photo-placeholder ${className}`.trim()} style={{ aspectRatio: ratio }} role="img" aria-label={`Placeholder for photography: ${label}`}>
      <span className="m-4 rounded-full bg-ivory/90 px-3 py-1.5 text-[0.78rem] font-medium leading-snug text-ink">{label}</span>
    </div>
  );
}
