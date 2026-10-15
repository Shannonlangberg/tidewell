/*
 * Plain-data shapes for the task screens. Types only (importable from Client Components).
 */

import type { TaskPriority, TaskStatus } from "../constants";

/**
 * A record a task is linked to. `label` is null when the person cannot read that record (a
 * junior property manager has no growth.read): the link is real but its name is not theirs to
 * see, so the screen says "linked" without naming it and does not offer a link they cannot open.
 */
export type RelatedRef = { id: string; label: string | null };

export type TaskRelated = {
  contact: RelatedRef | null;
  organisation: RelatedRef | null;
  referral: RelatedRef | null;
  opportunity: RelatedRef | null;
  /** Phase 2: the contractor the task is about. Named only for people with contractors.read. */
  contractor: RelatedRef | null;
};

export type TaskListItem = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** YYYY-MM-DD, or null */
  dueDate: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  completedAt: string | null;
  createdAt: string;
  related: TaskRelated;
};

export type TaskDetail = TaskListItem & {
  description: string | null;
  createdBy: string | null;
  createdByName: string | null;
  completedBy: string | null;
  completedByName: string | null;
  updatedAt: string;
  source: string;
};

export type TaskPage = { rows: TaskListItem[]; total: number; page: number };

export type Result<T> = { ok: true; data: T } | { ok: false };

/** What a task Server Action tells the button that called it. */
export type TaskActionResult = { ok: boolean; message: string };
