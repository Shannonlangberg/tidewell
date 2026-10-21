/*
 * Plain-data shapes for the command center (types only: importable from Client Components and the
 * unit tests).
 */

import type { TaskPriority, TaskStatus } from "../constants";

export type Lane = "do_now" | "in_motion" | "waiting" | "coming_next";

export type PlanningKind = "funding" | "dependency" | "context";
export type PlanningStatus = "anticipated" | "confirmed" | "received" | "current" | "closed";

/** One task as the command center reads it (hq.task_overview). Counts are what this person can see. */
export type LeaderTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  /** The person's own working plan (not the due date). */
  plannedFor: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  createdBy: string | null;
  projectId: string | null;
  projectRef: string | null;
  projectName: string | null;
  projectPriority: TaskPriority | null;
  milestoneId: string | null;
  milestoneName: string | null;
  milestoneDue: string | null;
  milestoneLaunchGate: boolean;
  parentId: string | null;
  isBlocked: boolean;
  openDependencyCount: number;
  /** Open tasks waiting on this one. */
  blockingCount: number;
  subtaskOpen: number;
  checklistTotal: number;
  checklistDone: number;
  blockedReason: string | null;
  waitingOn: string | null;
  waitingSince: string | null;
  expectedResponse: string | null;
  nextFollowUp: string | null;
  planningItemId: string | null;
  planningItemTitle: string | null;
  planningItemStatus: PlanningStatus | null;
  /** Linked to a contact, organisation or referral. */
  relationship: boolean;
  /** Linked to a lead (opportunity). */
  pipeline: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type LaunchMilestone = {
  id: string;
  name: string;
  dueDate: string | null;
  status: "open" | "done";
  sortOrder: number;
  launchGate: boolean;
  completedAt: string | null;
};

export type PlanningItem = {
  id: string;
  ref: string;
  kind: PlanningKind;
  title: string;
  detail: string | null;
  /** A PLANNING figure (anticipated), never a balance. Funding only. */
  amountAnticipated: number | null;
  /** The founder's own words for timing ("within a month"). */
  expectedText: string | null;
  /** A real date, only when known. */
  expectedBy: string | null;
  status: PlanningStatus;
  version: number;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
};

/** What an inline command-center control's Server Action tells it. */
export type LeaderActionResult = { ok: boolean; message: string };
