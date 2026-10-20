/*
 * Plain-data shapes for the project screens. Types only (importable from Client Components).
 */

import type { TaskPriority, TaskStatus } from "../constants";

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";
export type ProjectHealth = "on_track" | "at_risk" | "off_track" | "done" | "on_hold";
export type MilestoneStatus = "open" | "done";

export type Result<T> = { ok: true; data: T } | { ok: false };

/** One row of hq.project_overview, as the screens use it. Counts are the tasks this person can see. */
export type ProjectSummary = {
  id: string;
  ref: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: TaskPriority;
  health: ProjectHealth;
  ownerId: string | null;
  ownerName: string | null;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  notes: string | null;
  /** Optimistic concurrency for edits (hq.projects.version). */
  version: number;
  /** Top-level tasks completed (progress numerator). */
  doneCount: number;
  /** Top-level, non-cancelled tasks (the progress denominator). */
  totalCount: number;
  /** 0..100, floored by the database */
  progress: number;
  /** Every visible live task, any level, any status. */
  taskCount: number;
  openCount: number;
  overdueCount: number;
  blockedCount: number;
  /** Days the most overdue task is past due (0 when none). */
  maxOverdueDays: number;
  milestoneCount: number;
  milestonesDone: number;
  overdueMilestoneCount: number;
  nextMilestoneName: string | null;
  nextMilestoneDue: string | null;
  /** The database's plain-language reasons for the health. */
  healthReasons: string[];
  daysToTarget: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Milestone = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  status: MilestoneStatus;
  sortOrder: number;
  completedAt: string | null;
};

/** A task as the project views and the task page draw it (from hq.task_overview). */
export type ProjectTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdBy: string | null;
  projectId: string | null;
  projectRef: string | null;
  projectName: string | null;
  milestoneId: string | null;
  milestoneName: string | null;
  parentId: string | null;
  parentTitle: string | null;
  sortOrder: number;
  blocked: boolean;
  blockedReason: string | null;
  subtaskCount: number;
  subtaskOpen: number;
  checklistTotal: number;
  checklistDone: number;
  /** Tasks this one waits on (visible to this person). */
  dependsOnCount: number;
  /** Tasks waiting on this one. */
  blockingCount: number;
  createdAt: string;
  completedAt: string | null;
};

export type ProjectLink = {
  id: string;
  kind: "contact" | "organisation" | "contractor" | "opportunity";
  targetId: string;
  /** null when this person cannot read that record */
  label: string | null;
};

export type ProjectDocument = { id: string; title: string; url: string; addedByName: string | null; createdAt: string };

export type ActivityEntry = { id: string; at: string; actorName: string | null; kind: string; summary: string };

export type Dependency = { taskId: string; title: string; status: TaskStatus; dueDate: string | null; projectName: string | null };

export type ChecklistItem = { id: string; text: string; done: boolean; sortOrder: number; doneByName: string | null; doneAt: string | null };

export type TaskComment = { id: string; authorId: string | null; authorName: string | null; body: string; createdAt: string; editedAt: string | null };

export type FocusItem = {
  taskId: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  why: string;
};

/** What an inline project control's Server Action tells it. */
export type ProjectActionResult = { ok: boolean; message: string };
