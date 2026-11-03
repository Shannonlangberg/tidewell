/*
 * "Your priorities" on the CEO Command Centre: the three to five most important leadership actions.
 *
 * There is ONE ranking in HQ: the command center's focus score (lib/hq/leadership/rules.ts scoreTask,
 * docs/hq-command-center.md). This file does not add another. It puts the other things that can need the
 * CEO (an overdue lead follow-up, a decision waiting on them, a website enquiry nobody has picked up) in the
 * SAME terms a task is scored in, then lets that score order everything:
 *
 *   lead follow-up      a task due on the lead's follow-up date, linked to a lead (business development);
 *                       priority normal (high when the lead has no owner, because nobody else will act)
 *   decision for you    a proposed decision with you as the decision maker; priority high (a pending
 *                       decision holds others up); no due date (HQ records no decide-by date)
 *   website enquiry     still New after a day: a task due the day after it arrived, linked to the pipeline,
 *                       priority high (a person asked us for something)
 *
 * The scoring function is passed in (the app passes scoreTask), so this file keeps NO value imports and the
 * unit tests run under Node's type stripping. Nothing here writes, changes a status or sends anything: each
 * priority links to its real record, where the existing actions are.
 */

import type { TaskPriority } from "../constants";
import type { LeaderTask } from "../leadership/types";
import type { Scored } from "../leadership/rules";

export type PriorityKind = "task" | "lead" | "decision" | "enquiry";
export const PRIORITY_KIND_LABEL: Record<PriorityKind, string> = { task: "Task", lead: "Lead follow-up", decision: "Decision", enquiry: "Website enquiry" };

export type Priority = {
  kind: PriorityKind;
  id: string;
  ref: string | null;
  title: string;
  detail: string | null;
  href: string;
  score: number;
  /** The reasons, as the command center says them ("Overdue by 3 days · High priority"). */
  why: string;
  weight: string;
};

export type LeadFollowUp = { id: string; ref: string; prospect: string; nextAction: string | null; due: string | null; ownerName: string | null; stage: string; missingOwner: boolean };
export type DecisionWaiting = { id: string; ref: string; title: string };
export type EnquiryWaiting = { id: string; ref: string; name: string; receivedOn: string; kind: string };

export const PRIORITY_MAX = 5;

/** A task-shaped record, for scoring only (never saved). */
export function asScorable(over: Partial<LeaderTask> & { id: string; title: string; priority: TaskPriority }): LeaderTask {
  return {
    status: "to_do",
    dueDate: null,
    plannedFor: null,
    assignedTo: null,
    assignedToName: null,
    createdBy: null,
    projectId: null,
    projectRef: null,
    projectName: null,
    projectPriority: null,
    milestoneId: null,
    milestoneName: null,
    milestoneDue: null,
    milestoneLaunchGate: false,
    parentId: null,
    isBlocked: false,
    openDependencyCount: 0,
    blockingCount: 0,
    subtaskOpen: 0,
    checklistTotal: 0,
    checklistDone: 0,
    blockedReason: null,
    waitingOn: null,
    waitingSince: null,
    expectedResponse: null,
    nextFollowUp: null,
    planningItemId: null,
    planningItemTitle: null,
    planningItemStatus: null,
    relationship: false,
    pipeline: false,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
    ...over,
  };
}

const addDay = (d: string) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export type PriorityInput = {
  /** The person's focus candidates: already filtered by the command center's own pickFocus. */
  tasks: ReadonlyArray<{ task: LeaderTask; href: string }>;
  leads: readonly LeadFollowUp[];
  decisions: readonly DecisionWaiting[];
  enquiries: readonly EnquiryWaiting[];
  hrefs: { lead: (id: string) => string; decision: (id: string) => string; enquiry: (id: string) => string };
};

export type Scorer = (t: LeaderTask, today: string) => Scored;
export type Explain = { why: (s: Scored) => string; weight: (s: Scored) => string };

/** Everything that can need the CEO, scored by the one score, highest first; ties keep the command center's order (earlier due first). */
export function rankPriorities(input: PriorityInput, today: string, score: Scorer, explain: Explain, max = PRIORITY_MAX): Priority[] {
  const all: Array<Priority & { due: string | null }> = [];
  for (const { task, href } of input.tasks) {
    const s = score(task, today);
    all.push({ kind: "task", id: task.id, ref: task.projectRef, title: task.title, detail: task.projectName ?? task.milestoneName, href, score: s.score, why: explain.why(s), weight: explain.weight(s), due: task.dueDate });
  }
  for (const l of input.leads) {
    const t = asScorable({ id: l.id, title: l.prospect, priority: l.missingOwner ? "high" : "normal", dueDate: l.due, pipeline: true });
    const s = score(t, today);
    const why = [explain.why(s), l.missingOwner ? "No owner" : null].filter(Boolean).join(" · ");
    all.push({
      kind: "lead",
      id: l.id,
      ref: l.ref,
      title: l.nextAction ? `${l.nextAction}: ${l.prospect}` : `Follow up ${l.prospect}`,
      detail: l.ownerName ? `${l.ownerName}'s lead` : "Nobody owns this lead",
      href: input.hrefs.lead(l.id),
      score: s.score,
      why,
      weight: explain.weight(s),
      due: l.due,
    });
  }
  for (const d of input.decisions) {
    const s = score(asScorable({ id: d.id, title: d.title, priority: "high" }), today);
    all.push({ kind: "decision", id: d.id, ref: d.ref, title: d.title, detail: "Proposed, with you as the decision maker", href: input.hrefs.decision(d.id), score: s.score, why: `Waiting on your decision · ${explain.why(s)}`, weight: explain.weight(s), due: null });
  }
  for (const e of input.enquiries) {
    const due = addDay(e.receivedOn);
    const s = score(asScorable({ id: e.id, title: e.name, priority: "high", dueDate: due, pipeline: true }), today);
    all.push({ kind: "enquiry", id: e.id, ref: e.ref, title: `Reply to ${e.name}`, detail: e.kind === "appraisal" ? "Asked for an appraisal on the website" : "Contacted us on the website", href: input.hrefs.enquiry(e.id), score: s.score, why: `Not picked up yet · ${explain.why(s)}`, weight: explain.weight(s), due });
  }
  return all
    .sort((a, b) => b.score - a.score || (a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1) || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, max))
    .map((p) => ({ kind: p.kind, id: p.id, ref: p.ref, title: p.title, detail: p.detail, href: p.href, score: p.score, why: p.why, weight: p.weight }));
}
