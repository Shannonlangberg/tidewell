import type { ReactNode } from "react";
import { HEALTH_LABEL, PROJECT_STATUS_LABEL, healthTone, progressText, progressWidth, projectStatusTone, type Tone } from "@/lib/hq/projects/rules";
import type { ProjectHealth, ProjectStatus } from "@/lib/hq/projects/types";
import { cx } from "../../cx";

/*
 * Small server-safe pieces shared by the project screens: status and health as a dot plus a label
 * (never colour alone), and the thin progress rule with its "n of m done".
 */

export function Dot({ tone = "neutral", quiet, children, className }: { tone?: Tone; quiet?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx("hq-prj-dot", tone !== "neutral" && `hq-prj-dot--${tone}`, quiet && "hq-prj-dot--quiet", className)}>{children}</span>;
}

export function ProjectStatusDot({ status }: { status: ProjectStatus }) {
  return <Dot tone={projectStatusTone(status)}>{PROJECT_STATUS_LABEL[status]}</Dot>;
}

export function HealthDot({ health, className }: { health: ProjectHealth; className?: string }) {
  return (
    <Dot tone={healthTone(health)} className={className}>
      {HEALTH_LABEL[health]}
    </Dot>
  );
}

export function ProgressRule({ done, total, progress, large, label }: { done: number; total: number; progress: number; large?: boolean; label?: string }) {
  const width = progressWidth(progress);
  return (
    <div className="hq-prj-progress">
      <span
        className={cx("hq-prj-rule", large && "hq-prj-rule--lg")}
        role="meter"
        aria-label={label ?? "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={width}
        aria-valuetext={`${progressText(done, total)}, ${width}%`}
      >
        <span style={{ width: `${width}%` }} />
      </span>
      <span className="hq-prj-progress__text">
        {progressText(done, total)}
        {total > 0 ? ` · ${width}%` : ""}
      </span>
    </div>
  );
}

export function Section({ id, title, link, children, className }: { id: string; title: string; link?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={className}>
      <div className="hq-prj-section__head">
        <h2 id={id} className="hq-label">
          {title}
        </h2>
        {link}
      </div>
      {children}
    </section>
  );
}
