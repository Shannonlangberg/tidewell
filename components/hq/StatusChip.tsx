import {
  PRIORITY_LABEL,
  RELATIONSHIP_LABEL,
  STAGE_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  type OpportunityStage,
  type Priority,
  type RelationshipStatus,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/hq/constants";
import { cx } from "./cx";
import type { ReactNode } from "react";

/*
 * Status chips. A 4px-radius tag with a dot AND a text label: colour never carries
 * meaning on its own. Tones are the functional `--status-*` tokens (the one allowed
 * exception to the neutral palette), each text/background pair measured at 4.5:1 or more.
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";

export type StatusChipProps = {
  tone?: StatusTone;
  children: ReactNode;
  /** A category tag rather than a status: no dot. */
  plain?: boolean;
  className?: string;
  title?: string;
};

export function StatusChip({ tone = "neutral", plain, className, title, children }: StatusChipProps) {
  return (
    <span className={cx("hq-chip", tone !== "neutral" && `hq-chip--${tone}`, plain && "hq-chip--plain", className)} title={title}>
      {children}
    </span>
  );
}

// ── tone helpers: one place decides what each value looks like ──

export function toneForRelationship(status: RelationshipStatus): StatusTone {
  switch (status) {
    case "identified":
    case "inactive":
      return "neutral";
    case "contacted":
    case "meeting_booked":
    case "met":
      return "info";
    case "active_relationship":
    case "referring_partner":
      return "success";
  }
}

export function toneForStage(stage: OpportunityStage): StatusTone {
  switch (stage) {
    case "introduction_received":
    case "contacted":
    case "lost":
      return "neutral";
    case "qualified":
    case "appraisal_requested":
    case "appraisal_completed":
      return "info";
    case "proposal_sent":
      return "warning";
    case "management_signed":
      return "success";
  }
}

export function toneForTaskStatus(status: TaskStatus): StatusTone {
  switch (status) {
    case "to_do":
    case "cancelled":
      return "neutral";
    case "in_progress":
      return "info";
    case "waiting":
      return "warning";
    case "completed":
      return "success";
  }
}

/** Works for both priority scales: partners use high/medium/low, tasks use low/normal/high/urgent. */
export function toneForPriority(priority: Priority | TaskPriority): StatusTone {
  switch (priority) {
    case "urgent":
      return "error";
    case "high":
      return "warning";
    default:
      return "neutral";
  }
}

// ── convenience chips: tone and label together, from the shared label maps ──

export function RelationshipChip({ status, className }: { status: RelationshipStatus; className?: string }) {
  return (
    <StatusChip tone={toneForRelationship(status)} className={className}>
      {RELATIONSHIP_LABEL[status]}
    </StatusChip>
  );
}

export function StageChip({ stage, className }: { stage: OpportunityStage; className?: string }) {
  return (
    <StatusChip tone={toneForStage(stage)} className={className}>
      {STAGE_LABEL[stage]}
    </StatusChip>
  );
}

export function TaskStatusChip({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <StatusChip tone={toneForTaskStatus(status)} className={className}>
      {TASK_STATUS_LABEL[status]}
    </StatusChip>
  );
}

/** "High priority" style chip for either scale. */
export function PriorityChip({ priority, className }: { priority: Priority | TaskPriority; className?: string }) {
  const label = priority in TASK_PRIORITY_LABEL ? TASK_PRIORITY_LABEL[priority as TaskPriority] : PRIORITY_LABEL[priority as Priority];
  return (
    <StatusChip tone={toneForPriority(priority)} className={className}>
      {label} priority
    </StatusChip>
  );
}
