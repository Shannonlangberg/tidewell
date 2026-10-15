/*
 * A task's activity timeline, built from what the person is allowed to read.
 *
 *  - EVERYONE who can see the task can read the task row, so everyone gets: when it was
 *    created and by whom, when it was completed and by whom, and the last time it changed
 *    (with the status it has now). That is all the row can honestly tell us: it does not
 *    remember earlier statuses, so no status history is invented from it.
 *  - People holding audit.read also get the matching rows of hq.audit_events for this task:
 *    every status change, reassignment, priority, due date and title change, with who did it.
 *    When the audit log has the creation, it replaces the row-derived "Created" so it is not
 *    listed twice.
 *
 * Pure and dependency-light (type imports only plus the label maps), so `node --test` runs it.
 * It returns plain data; the component chooses icons and formats the times in the viewer's zone.
 */

import type { TaskPriority, TaskStatus } from "../constants";

// The words people read for each status and priority. They are written out here (rather than
// imported from lib/hq/constants.ts) because this file is unit-tested under Node and cannot import
// its neighbours; activity.test.mts checks them against constants.ts so they cannot drift.
export const STATUS_WORDS: Record<TaskStatus, string> = {
  to_do: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const PRIORITY_WORDS: Record<TaskPriority, string> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };

export type ActivityKind =
  | "created"
  | "status"
  | "completed"
  | "reopened"
  | "cancelled"
  | "reassigned"
  | "priority"
  | "due"
  | "title"
  | "description"
  | "linked"
  | "archived"
  | "restored"
  | "updated";

export type ActivityEvent = {
  /** Stable key for React. */
  key: string;
  /** ISO timestamp. */
  at: string;
  kind: ActivityKind;
  title: string;
  /** A second line of plain text, or null. */
  detail: string | null;
  /** Who did it, or null when unknown. */
  actor: string | null;
};

/** The task fields the row-derived events need. */
export type ActivityTask = {
  id: string;
  status: TaskStatus;
  createdAt: string;
  createdBy: string | null;
  completedAt: string | null;
  completedBy: string | null;
  updatedAt: string;
};

/** One row of hq.audit_events, as selected. */
export type AuditRow = {
  id: number | string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  changes: unknown;
};

export type NameOf = (staffId: string | null | undefined) => string | null;

type Change = { from?: unknown; to?: unknown };

function isChangeMap(value: unknown): value is Record<string, Change> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** "2026-10-16" as "16 Oct 2026". A calendar date is read as written, in no timezone. */
function niceDate(value: unknown): string | null {
  const s = asString(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : DAY_FORMAT.format(d);
}

function statusLabel(value: unknown): string {
  const s = asString(value);
  return s && s in STATUS_WORDS ? STATUS_WORDS[s as TaskStatus] : "Unknown";
}

function priorityLabel(value: unknown): string {
  const s = asString(value);
  return s && s in PRIORITY_WORDS ? PRIORITY_WORDS[s as TaskPriority] : "Unknown";
}

const RELATED_KEYS = ["related_contact_id", "related_organisation_id", "related_referral_id", "related_opportunity_id"] as const;
const RELATED_NOUN: Record<(typeof RELATED_KEYS)[number], string> = {
  related_contact_id: "contact",
  related_organisation_id: "organisation",
  related_referral_id: "referral",
  related_opportunity_id: "opportunity",
};

/** The events for one audit row (one UPDATE can change several fields). */
function eventsFromAudit(row: AuditRow, nameOf: NameOf): ActivityEvent[] {
  const actor = row.actor_name ?? nameOf(row.actor_id);
  const base = { at: row.at, actor };
  const key = `audit-${row.id}`;
  const out: ActivityEvent[] = [];

  if (row.action === "create") {
    return [{ ...base, key, kind: "created", title: "Task created", detail: null }];
  }
  if (row.action === "archive") {
    return [{ ...base, key, kind: "archived", title: "Task archived", detail: null }];
  }
  if (row.action === "restore") {
    return [{ ...base, key, kind: "restored", title: "Task restored", detail: null }];
  }
  if (!isChangeMap(row.changes)) {
    return [{ ...base, key, kind: "updated", title: "Task updated", detail: null }];
  }

  const c = row.changes;
  let n = 0;
  const push = (kind: ActivityKind, title: string, detail: string | null) => {
    out.push({ ...base, key: `${key}-${n++}`, kind, title, detail });
  };

  if (c.status) {
    const to = asString(c.status.to);
    const detail = `${statusLabel(c.status.from)} to ${statusLabel(c.status.to)}`;
    if (to === "completed") push("completed", "Marked complete", detail);
    else if (to === "cancelled") push("cancelled", "Cancelled", detail);
    else if (asString(c.status.from) === "completed" || asString(c.status.from) === "cancelled") push("reopened", "Reopened", detail);
    else push("status", "Status changed", detail);
  }
  if (c.assigned_to) {
    const from = asString(c.assigned_to.from);
    const to = asString(c.assigned_to.to);
    const fromName = from ? (nameOf(from) ?? "someone") : "no one";
    const toName = to ? (nameOf(to) ?? "someone") : "no one";
    push("reassigned", to ? "Reassigned" : "Unassigned", `${fromName} to ${toName}`);
  }
  if (c.priority) push("priority", "Priority changed", `${priorityLabel(c.priority.from)} to ${priorityLabel(c.priority.to)}`);
  if (c.due_date) {
    const from = niceDate(c.due_date.from);
    const to = niceDate(c.due_date.to);
    push("due", to ? "Due date changed" : "Due date removed", `${from ?? "No date"} to ${to ?? "no date"}`);
  }
  if (c.title) push("title", "Title changed", `${asString(c.title.from) ?? ""} to ${asString(c.title.to) ?? ""}`.trim());
  if (c.description) push("description", "Description updated", null);
  for (const k of RELATED_KEYS) {
    const change = c[k];
    if (!change) continue;
    const linked = asString(change.to) !== null;
    push("linked", linked ? `Linked to a ${RELATED_NOUN[k]}` : `Unlinked from a ${RELATED_NOUN[k]}`, null);
  }

  // completed_at / completed_by follow the status, and deleted_at is the archive: neither is news on its own.
  return out.length > 0 ? out : [{ ...base, key, kind: "updated", title: "Task updated", detail: null }];
}

/**
 * Newest first. `audit` is null when the person cannot read the audit log (or it failed to
 * load): the timeline then comes from the task row alone.
 */
export function buildActivity(input: { task: ActivityTask; audit: readonly AuditRow[] | null; nameOf: NameOf }): ActivityEvent[] {
  const { task, audit, nameOf } = input;
  const events: ActivityEvent[] = [];

  const auditHasCreate = !!audit && audit.some((r) => r.action === "create");
  if (audit) for (const row of audit) events.push(...eventsFromAudit(row, nameOf));

  if (!auditHasCreate) {
    events.push({ key: "row-created", at: task.createdAt, kind: "created", title: "Task created", detail: null, actor: nameOf(task.createdBy) });
  }

  if (!audit) {
    if (task.completedAt) {
      events.push({
        key: "row-completed",
        at: task.completedAt,
        kind: "completed",
        title: "Marked complete",
        detail: null,
        actor: nameOf(task.completedBy),
      });
    }
    // The last change, when it was not simply the completion (whose own line already says so).
    const updated = Date.parse(task.updatedAt);
    const reference = Date.parse(task.completedAt ?? task.createdAt);
    if (Number.isFinite(updated) && Math.abs(updated - reference) > 2000 && updated > Date.parse(task.createdAt) + 2000) {
      events.push({
        key: "row-updated",
        at: task.updatedAt,
        kind: "updated",
        title: "Last updated",
        detail: `Status is ${statusLabel(task.status)}`,
        actor: null,
      });
    }
  }

  // Array.prototype.sort is stable, so events with the same time keep the order they were added in.
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The staff ids an audit trail mentions (reassignments), so the page can look their names up in one query. */
export function staffIdsInAudit(audit: readonly AuditRow[] | null): string[] {
  const ids = new Set<string>();
  for (const row of audit ?? []) {
    if (row.actor_id) ids.add(row.actor_id);
    if (!isChangeMap(row.changes)) continue;
    const a = row.changes.assigned_to;
    if (!a) continue;
    for (const v of [a.from, a.to]) {
      const s = asString(v);
      if (s) ids.add(s);
    }
  }
  return [...ids];
}
