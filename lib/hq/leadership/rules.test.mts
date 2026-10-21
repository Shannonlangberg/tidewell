import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  alsoDueToday,
  dayWords,
  groupByLane,
  laneMove,
  laneOf,
  laneWhy,
  launchReadiness,
  milestoneState,
  nextMonday,
  pickFocus,
  planWeek,
  planningAmount,
  planningIsLive,
  planningStatusLabel,
  scoreTask,
  stageOf,
  upcomingCommitments,
  waitsOf,
  weightWords,
  whyLine,
} from "./rules.ts";
import type { LaunchMilestone, LeaderTask } from "./types.ts";

const TODAY = "2026-10-21"; // a Wednesday
const ME = "me";

let n = 0;
function task(over: Partial<LeaderTask> = {}): LeaderTask {
  n += 1;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    title: `Task ${n}`,
    status: "to_do",
    priority: "normal",
    dueDate: null,
    plannedFor: null,
    assignedTo: ME,
    assignedToName: "Me",
    createdBy: ME,
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
    createdAt: `2026-10-01T00:00:${String(n % 60).padStart(2, "0")}Z`,
    updatedAt: "2026-10-01T00:00:00Z",
    completedAt: null,
    ...over,
  };
}

const ms = (over: Partial<LaunchMilestone> = {}): LaunchMilestone => ({ id: `m${++n}`, name: `Milestone ${n}`, dueDate: null, status: "open", sortOrder: 0, launchGate: false, completedAt: null, ...over });

// ── dates ──────────────────────────────────────────────────

test("dates: addDays, nextMonday and words", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(nextMonday("2026-10-21"), "2026-10-26"); // Wed -> next Mon
  assert.equal(nextMonday("2026-10-26"), "2026-11-02"); // Mon -> the Monday after
  assert.equal(nextMonday("2026-10-25"), "2026-10-26"); // Sun -> tomorrow
  assert.equal(dayWords(TODAY, TODAY), "today");
  assert.equal(dayWords("2026-10-22", TODAY), "tomorrow");
  assert.equal(dayWords("2026-10-27", TODAY), "Tue 27 Oct");
  assert.equal(dayWords("2027-01-04", TODAY), "Mon 4 Jan 2027");
});

// ── waiting ────────────────────────────────────────────────

test("waitsOf: every recorded reason, most specific first; nothing for a closed task", () => {
  const t = task({ status: "waiting", isBlocked: true, openDependencyCount: 2, planningItemId: "p", planningItemTitle: "Business funding", planningItemStatus: "anticipated", waitingOn: "Ailo", blockedReason: "needs a quote" });
  assert.deepEqual(waitsOf(t).map((w) => w.kind), ["dependency", "planning", "external", "held"]);
  assert.equal(waitsOf(t)[0].text, "Waits for 2 tasks to finish");
  assert.equal(waitsOf(task({ status: "waiting" }))[0].kind, "status");
  assert.deepEqual(waitsOf(task({ status: "completed", waitingOn: "x" })), []);
  // a planning item that has been received no longer holds anything up
  assert.deepEqual(waitsOf(task({ planningItemId: "p", planningItemTitle: "Funding", planningItemStatus: "received" })), []);
});

// ── lanes ──────────────────────────────────────────────────

test("laneOf: the documented order of rules", () => {
  assert.equal(laneOf(task({ status: "completed" }), TODAY), null);
  assert.equal(laneOf(task({ status: "waiting" }), TODAY), "waiting");
  assert.equal(laneOf(task({ status: "in_progress", isBlocked: true, openDependencyCount: 1 }), TODAY), "waiting", "a blocked task waits whatever its status");
  assert.equal(laneOf(task({ waitingOn: "Ailo" }), TODAY), "waiting", "recorded waiting on, even with status to_do");
  assert.equal(laneOf(task({ status: "in_progress" }), TODAY), "in_motion");
  assert.equal(laneOf(task({ dueDate: "2026-10-20", plannedFor: "2026-10-30" }), TODAY), "do_now", "overdue never hides behind a later plan");
  assert.equal(laneOf(task({ dueDate: "2026-10-22", plannedFor: "2026-10-26" }), TODAY), "coming_next", "the person's own plan wins over due soon");
  assert.equal(laneOf(task({ plannedFor: TODAY }), TODAY), "do_now");
  assert.equal(laneOf(task({ dueDate: "2026-10-23" }), TODAY), "do_now", "due within two days");
  assert.equal(laneOf(task({ dueDate: "2026-10-24" }), TODAY), "coming_next");
  assert.equal(laneOf(task({ priority: "urgent" }), TODAY), "do_now");
  assert.equal(laneOf(task({ priority: "high" }), TODAY), "coming_next", "high priority alone is important, not 'now'");
  assert.equal(laneOf(task(), TODAY), "coming_next");
});

test("laneWhy says the rule that placed it", () => {
  assert.equal(laneWhy(task({ dueDate: "2026-10-19" }), TODAY), "Overdue by 2 days");
  assert.equal(laneWhy(task({ plannedFor: "2026-10-26" }), TODAY), "Planned for Mon 26 Oct");
  assert.equal(laneWhy(task({ dueDate: "2026-10-22" }), TODAY), "Due tomorrow");
  assert.equal(laneWhy(task({ waitingOn: "Ailo to reply" }), TODAY), "Waiting on Ailo to reply");
  assert.equal(laneWhy(task(), TODAY), "No date yet");
});

test("groupByLane puts every open task in exactly one lane, best first", () => {
  const list = [task({ status: "in_progress" }), task({ status: "waiting" }), task({ dueDate: TODAY }), task(), task({ status: "cancelled" })];
  const g = groupByLane(list, TODAY);
  assert.equal(g.do_now.length + g.in_motion.length + g.waiting.length + g.coming_next.length, 4);
});

test("laneMove: what each move changes (never priority or due date)", () => {
  const t = task({ status: "waiting", waitingOn: "Ailo" });
  const now = laneMove(t, "do_now", TODAY);
  assert.ok(now.ok && now.patch.status === "to_do" && now.patch.planned_for === TODAY);
  const next = laneMove(task(), "coming_next", TODAY);
  assert.ok(next.ok && next.patch.planned_for === "2026-10-26");
  assert.equal(laneMove(task(), "coming_next", TODAY, { plannedFor: TODAY }).ok, false);
  assert.equal(laneMove(task(), "waiting", TODAY).ok, false, "waiting needs to say on what");
  const w = laneMove(task(), "waiting", TODAY, { waitingOn: " Accountant to reply " });
  assert.ok(w.ok && w.patch.waiting_on === "Accountant to reply" && w.patch.status === "waiting");
  const blocked = laneMove(task({ isBlocked: true, openDependencyCount: 1 }), "in_motion", TODAY);
  assert.ok(blocked.ok && blocked.note && /stays in Waiting/.test(blocked.note));
  for (const r of [now, next, w]) if (r.ok) assert.ok(!("priority" in r.patch) && !("due_date" in r.patch));
  assert.equal(laneMove(task({ status: "completed" }), "do_now", TODAY).ok, false);
});

// ── score ──────────────────────────────────────────────────

test("scoreTask: points and reasons, explainable", () => {
  const s = scoreTask(task({ dueDate: "2026-10-18", priority: "high", blockingCount: 4 }), TODAY);
  assert.equal(s.score, 46 + 18 + 18 + 0);
  assert.deepEqual(s.factors.map((f) => f.key), ["overdue", "priority", "unblocks"]);
  assert.equal(whyLine(s), "Overdue by 3 days · High priority · Unblocks 4 tasks");
  assert.equal(weightWords(s), "Important and due now");
  const later = scoreTask(task({ priority: "high" }), TODAY);
  assert.equal(weightWords(later), "Important, not pressing");
  assert.equal(weightWords(scoreTask(task({ dueDate: TODAY }), TODAY)), "Due now");
  assert.equal(weightWords(scoreTask(task({ priority: "low" }), TODAY)), "Next up");
  assert.equal(scoreTask(task({ priority: "low" }), TODAY).score, 0);
  const gate = scoreTask(task({ milestoneName: "Licensed", milestoneDue: "2026-10-30", milestoneLaunchGate: true }), TODAY);
  assert.ok(gate.factors.some((f) => f.key === "launch") && gate.factors.some((f) => f.key === "milestone"));
  assert.equal(scoreTask(task({ blockingCount: 9 }), TODAY).factors.find((f) => f.key === "unblocks")?.points, 18, "unblocks is capped");
  const grow = scoreTask(task({ relationship: true, pipeline: true }), TODAY);
  assert.deepEqual(grow.factors.map((f) => f.key).sort(), ["pipeline", "priority", "relationship"]);
});

test("scoreTask is deterministic and reads only: same input, same output, task untouched", () => {
  const t = task({ dueDate: "2026-10-22", priority: "urgent" });
  const copy = JSON.stringify(t);
  assert.deepEqual(scoreTask(t, TODAY), scoreTask(t, TODAY));
  assert.equal(JSON.stringify(t), copy);
});

// ── focus ──────────────────────────────────────────────────

test("pickFocus: at most three of MY movable tasks, waiting and parents excluded", () => {
  const overdue = task({ title: "overdue", dueDate: "2026-10-15" });
  const urgent = task({ title: "urgent", priority: "urgent" });
  const tomorrow = task({ title: "tomorrow", dueDate: "2026-10-22" });
  const plain = task({ title: "plain" });
  const waiting = task({ title: "waiting", status: "waiting", priority: "urgent", dueDate: "2026-10-10" });
  const parent = task({ title: "parent", subtaskOpen: 2, priority: "urgent" });
  const theirs = task({ title: "theirs", assignedTo: "other", priority: "urgent" });
  const f = pickFocus([plain, waiting, parent, theirs, tomorrow, urgent, overdue], TODAY, ME);
  assert.deepEqual(f.map((x) => x.task.title), ["overdue", "tomorrow", "urgent"], "a normal task due tomorrow (28+6) edges an undated urgent one (30)");
  assert.equal(pickFocus([], TODAY, ME).length, 0);
  const later = task({ title: "later", dueDate: "2026-10-22", priority: "high", plannedFor: "2026-10-26" });
  const lateLater = task({ title: "late but planned later", dueDate: "2026-10-01", plannedFor: "2026-10-26" });
  assert.deepEqual(pickFocus([later, lateLater], TODAY, ME).map((x) => x.task.title), ["late but planned later"], "planned for a later day is not today's focus, unless overdue");
  const also = alsoDueToday([overdue, task({ title: "today", dueDate: TODAY }), tomorrow], TODAY, ME, new Set([overdue.id]));
  assert.deepEqual(also.map((t) => t.title), ["today"]);
});

// ── launch ─────────────────────────────────────────────────

test("launchReadiness: requirements met apart from tasks done", () => {
  const a = ms({ name: "Registered", launchGate: true, status: "done", dueDate: "2026-10-01" });
  const b = ms({ name: "Licensed", launchGate: true, dueDate: "2026-11-15" });
  const c = ms({ name: "Brand assets", dueDate: "2026-11-01" });
  const tasks = [task({ milestoneId: c.id, title: "logo files" }), task({ milestoneId: b.id, title: "lodge application", status: "waiting", waitingOn: "funding" })];
  const r = launchReadiness([b, c, a], tasks, { done: 30, total: 40 }, TODAY);
  assert.equal(r.gatesDone, 1);
  assert.equal(r.gatesTotal, 2);
  assert.equal(r.tasksDone, 30);
  assert.equal(r.nextMilestone?.name, "Brand assets", "the first open milestone that has a task that can move");
  assert.equal(r.nextAction?.title, "logo files");
  assert.deepEqual(r.openGates.map((m) => m.name), ["Licensed"]);
  const none = launchReadiness([c], [], { done: 0, total: 0 }, TODAY);
  assert.equal(none.gatesTotal, 0, "no requirement marked: no readiness figure");
  assert.equal(milestoneState(ms({ dueDate: "2026-10-01" }), TODAY), "overdue");
});

test("upcomingCommitments: open milestones and top-level tasks due within the window, soonest first", () => {
  const list = upcomingCommitments(
    [ms({ name: "M late", dueDate: "2026-10-10" }), ms({ name: "M far", dueDate: "2027-01-01" }), ms({ name: "M done", dueDate: "2026-10-25", status: "done" })],
    [task({ title: "T soon", dueDate: "2026-10-23" }), task({ title: "T sub", dueDate: "2026-10-23", parentId: "x" }), task({ title: "T closed", dueDate: "2026-10-23", status: "completed" })],
    TODAY,
  );
  assert.deepEqual(list.map((x) => x.title), ["M late", "T soon"]);
  assert.equal(list[0].overdue, true);
});

// ── week plan ──────────────────────────────────────────────

test("planWeek: a proposal of planned days only, respecting due dates and capacity", () => {
  const dueTue = task({ title: "due Tue", dueDate: "2026-10-27" });
  const dueThisWeek = task({ title: "due Fri this week", dueDate: "2026-10-23" });
  const waiting = task({ title: "waiting", status: "waiting", waitingOn: "Ailo", nextFollowUp: "2026-10-28" });
  const many = Array.from({ length: 25 }, (_, i) => task({ title: `plain ${i}` }));
  const p = planWeek([dueTue, dueThisWeek, waiting, ...many], TODAY, ME, { perDay: 4 });
  assert.equal(p.weekStart, "2026-10-26");
  assert.deepEqual(p.days, ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
  assert.equal(p.entries.length, 20, "five days of four");
  assert.equal(p.overflow.length, 6);
  const tue = p.entries.find((e) => e.title === "due Tue");
  assert.ok(tue && tue.plannedFor <= "2026-10-27");
  assert.deepEqual(p.dueBefore.map((t) => t.title), ["due Fri this week"]);
  assert.equal(p.waiting.length, 1);
  assert.equal(p.waiting[0].followUpInWeek, true);
  for (const d of p.days) assert.ok(p.entries.filter((e) => e.plannedFor === d).length <= 4);
});

// ── stages and planning ────────────────────────────────────

test("stageOf: Connect, Cultivate, Champion from relationship_status", () => {
  assert.equal(stageOf("identified"), "connect");
  assert.equal(stageOf("meeting_booked"), "connect");
  assert.equal(stageOf("met"), "cultivate");
  assert.equal(stageOf("active_relationship"), "cultivate");
  assert.equal(stageOf("referring_partner"), "champion");
  assert.equal(stageOf("inactive"), null);
  assert.equal(stageOf(null), null);
});

test("planning items are said as planning, never as money held", () => {
  assert.equal(planningStatusLabel("funding", "anticipated"), "Anticipated, not confirmed");
  assert.equal(planningStatusLabel("funding", "confirmed"), "Confirmed, not yet received");
  assert.equal(planningStatusLabel("context", "current"), "Current");
  assert.equal(planningAmount(25000), "about $25,000");
  assert.equal(planningAmount(null), null);
  assert.equal(planningIsLive({ kind: "funding", status: "anticipated" }), true);
  assert.equal(planningIsLive({ kind: "funding", status: "received" }), false);
  assert.equal(planningIsLive({ kind: "context", status: "current" }), false);
});
