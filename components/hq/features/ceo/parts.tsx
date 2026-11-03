import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "../../cx";
import { Icon } from "../../icons";
import type { Change } from "@/lib/hq/ceo/rules";
import s from "./ceo.module.css";

/*
 * The CEO Command Centre's building blocks. Server-safe (no hooks), so every panel renders on the server
 * from the records it was given; only the growth chart and the targets form are client components.
 */

export { s as ceo };

export function Section({ id, eyebrow, title, aside, children }: { id: string; eyebrow: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.section} aria-labelledby={id}>
      <div className={s.sectionHead}>
        <div>
          <p className={s.sectionEyebrow}>{eyebrow}</p>
          <h2 id={id} className={s.sectionTitle}>
            {title}
          </h2>
        </div>
        {aside ? <div className={s.sectionAside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Panel({
  title,
  hint,
  link,
  tag,
  span,
  className,
  children,
  foot,
  labelledBy,
}: {
  title: string;
  hint?: ReactNode;
  link?: { href: string; label: string } | null;
  tag?: ReactNode;
  span?: "span3" | "span4" | "span5" | "span6" | "span7" | "span8" | "span12";
  className?: string;
  children: ReactNode;
  foot?: ReactNode;
  labelledBy?: string;
}) {
  const id = labelledBy ?? `p-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article className={cx(s.panel, span && s[span], className)} aria-labelledby={id}>
      <div className={s.panelHead}>
        <div style={{ minWidth: 0 }}>
          <h3 id={id} className={s.panelTitle}>
            {title} {tag}
          </h3>
          {hint ? <p className={s.panelHint}>{hint}</p> : null}
        </div>
        {link ? (
          <Link href={link.href} className={s.panelLink}>
            {link.label}
            <Icon name="chevron-right" size={13} />
          </Link>
        ) : null}
      </div>
      {children}
      {foot ? <div className={s.panelFoot}>{foot}</div> : null}
    </article>
  );
}

export type TagKind = "estimate" | "target" | "awaiting" | "warn" | "plain";
export function Tag({ kind = "plain", children }: { kind?: TagKind; children: ReactNode }) {
  return <span className={cx(s.tag, kind === "estimate" && s.tagEstimate, kind === "target" && s.tagTarget, kind === "awaiting" && s.tagAwaiting, kind === "warn" && s.tagWarn)}>{children}</span>;
}

/** The change line under a KPI. Up is not always good (losses), so the caller says which way is good. */
export function Delta({ change, text, goodWhen = "up" }: { change: Change | null; text: string | null; goodWhen?: "up" | "down" | "neither" }) {
  if (!change || !text) return null;
  const good = goodWhen === "neither" || change.direction === "flat" ? null : (change.direction === "up") === (goodWhen === "up");
  return (
    <span className={cx(s.delta, good === true && s.deltaUp, good === false && s.deltaDown)}>
      {change.direction === "up" ? <Icon name="arrow-up" size={12} /> : change.direction === "down" ? <Icon name="arrow-down" size={12} /> : null}
      {text}
    </span>
  );
}

export function Kpi({
  label,
  href,
  value,
  muted,
  unit,
  sub,
  children,
}: {
  label: string;
  href: string | null;
  value: ReactNode;
  muted?: boolean;
  unit?: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className={s.kpiLabel}>
        {label}
        {href ? <Icon name="arrow-up-right" size={14} className={s.kpiArrow} /> : null}
      </span>
      <span className={cx(s.kpiValue, muted && s.kpiValueMuted)}>
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      {sub ? <span className={s.kpiSub}>{sub}</span> : null}
      {children ? <span className={s.kpiFoot}>{children}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className={s.kpi}>
      {body}
    </Link>
  ) : (
    <div className={s.kpi}>{body}</div>
  );
}

export function Meter({ value, max, mark, label }: { value: number; max: number; mark?: number | null; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const markPct = mark !== null && mark !== undefined && max > 0 ? Math.max(0, Math.min(1, mark / max)) : null;
  return (
    <span className={s.meter} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className={s.meterFill} style={{ width: `${pct * 100}%` }} />
      {markPct !== null ? <span className={s.meterMark} style={{ left: `calc(${markPct * 100}% - 1px)` }} /> : null}
    </span>
  );
}

export function Figure({ value, label, muted }: { value: ReactNode; label: ReactNode; muted?: boolean }) {
  return (
    <div className={s.figure}>
      <div className={cx(s.figureValue, muted && s.figureValueMuted)}>{value}</div>
      <div className={s.figureLabel}>{label}</div>
    </div>
  );
}

/** A small trend line: eight weeks, the last (this week, unfinished) drawn open; the target as a dashed lime line. */
export function Sparkline({ values, target, label }: { values: readonly number[]; target: number | null; label: string }) {
  const w = 96;
  const h = 30;
  const max = Math.max(1, target ?? 0, ...values);
  const x = (i: number) => (values.length <= 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const done = values.slice(0, -1);
  const path = done.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg className={s.spark} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      {target !== null ? <line x1="0" x2={w} y1={y(target)} y2={y(target)} stroke="var(--planted-sage)" strokeWidth="1.2" strokeDasharray="3 3" /> : null}
      <path d={path} fill="none" stroke="var(--planted-forest)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {last > 0 ? <line x1={x(last - 1)} y1={y(values[last - 1])} x2={x(last)} y2={y(values[last])} stroke="var(--planted-forest)" strokeWidth="1.4" strokeDasharray="2 2" /> : null}
      {last >= 0 ? <circle cx={x(last)} cy={y(values[last])} r="2.6" fill="var(--planted-white)" stroke="var(--planted-forest)" strokeWidth="1.4" /> : null}
    </svg>
  );
}

/** The goal as a ring: forest for managed, the stone track for the rest. */
export function GoalRing({ value, target }: { value: number; target: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(1, value / target) : 0;
  return (
    <div className={s.ring}>
      <svg viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={r} fill="none" stroke="var(--planted-stone)" strokeWidth="9" />
        {pct > 0 ? <circle cx="66" cy="66" r={r} fill="none" stroke="var(--planted-forest)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} /> : null}
      </svg>
      <div className={s.ringCenter}>
        <span className={s.ringValue}>{value}</span>
        <span className={s.ringOf}>of {target}</span>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}

export function Failed({ what }: { what: string }) {
  return (
    <p className={s.failed} role="status">
      {what} could not be loaded just now. Reload the page to try again.
    </p>
  );
}

/** The state for a figure HQ cannot know without an outside system: what it needs, never a placeholder number. */
export function Setup({ title, children, needs, action }: { title: string; children: ReactNode; needs?: readonly string[]; action?: ReactNode }) {
  return (
    <div className={s.setup}>
      <div>
        <p className={s.setupTitle}>{title}</p>
        <p className={s.setupText}>{children}</p>
      </div>
      {needs?.length ? (
        <ul className={s.setupList}>
          {needs.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      {action}
    </div>
  );
}
