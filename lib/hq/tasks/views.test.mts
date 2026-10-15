import test from "node:test";
import assert from "node:assert/strict";
import { OPEN_TASK_STATUSES, TASK_STATUSES } from "../constants.ts";
import { TASK_VIEWS, TASK_VIEW_KEYS, buildPredicate, parseTaskListQuery, plainQuery, resolveView, viewOffered, viewsFor, type PredicateContext } from "./rules.ts";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ctx: PredicateContext = { meId: ME, today: "2026-10-15", now: new Date("2026-10-15T01:00:00Z") };

test("the tabs offered depend on tasks.read_all, in a fixed order", () => {
  assert.deepEqual(
    viewsFor(true).map((v) => v.key),
    ["mine", "today", "overdue", "upcoming", "waiting", "team", "completed", "all"],
  );
  assert.deepEqual(
    viewsFor(false).map((v) => v.key),
    ["mine", "today", "overdue", "upcoming", "waiting", "delegated", "completed"],
  );
});

test("Team and All are never offered without tasks.read_all; Assigned by me only without it", () => {
  assert.equal(viewOffered(TASK_VIEWS.team, false), false);
  assert.equal(viewOffered(TASK_VIEWS.all, false), false);
  assert.equal(viewOffered(TASK_VIEWS.delegated, true), false);
  assert.equal(viewOffered(TASK_VIEWS.delegated, false), true);
  assert.equal(viewOffered(TASK_VIEWS.mine, false), true);
});

test("a forged ?view= falls back to My tasks", () => {
  assert.equal(resolveView("team", false), "mine");
  assert.equal(resolveView("all", false), "mine");
  assert.equal(resolveView("team", true), "team");
  assert.equal(resolveView("nonsense", true), "mine");
  assert.equal(resolveView(undefined, true), "mine");
  assert.equal(resolveView(["team", "all"], true), "team");
  assert.equal(resolveView("", true), "mine");
  assert.equal(resolveView("__proto__", true), "mine");
  assert.equal(parseTaskListQuery({ view: "team" }, { canReadAll: false }).view, "mine");
});

test("every view key has a definition", () => {
  for (const k of TASK_VIEW_KEYS) assert.equal(TASK_VIEWS[k].key, k);
});

test("My tasks: open tasks assigned to me", () => {
  const p = buildPredicate(plainQuery("mine"), ctx);
  assert.deepEqual(p.statuses, [...OPEN_TASK_STATUSES]);
  assert.deepEqual(p.assignee, { kind: "is", id: ME });
  assert.equal(p.due, null);
  assert.equal(p.createdBy, null);
  assert.equal(p.completedSince, null);
});

test("Due today, Overdue and Upcoming apply the right date window to open tasks assigned to me", () => {
  const today = buildPredicate(plainQuery("today"), ctx);
  assert.deepEqual(today.due, { eq: "2026-10-15" });
  assert.deepEqual(today.statuses, [...OPEN_TASK_STATUSES]);
  assert.deepEqual(today.assignee, { kind: "is", id: ME });

  const overdue = buildPredicate(plainQuery("overdue"), ctx);
  assert.deepEqual(overdue.due, { lt: "2026-10-15" });
  assert.deepEqual(overdue.statuses, [...OPEN_TASK_STATUSES]); // a completed task is never overdue

  const upcoming = buildPredicate(plainQuery("upcoming"), ctx);
  assert.deepEqual(upcoming.due, { gt: "2026-10-15", lte: "2026-10-29" });
});

test("Waiting lists only waiting tasks, and its status filter cannot widen it", () => {
  assert.deepEqual(buildPredicate(plainQuery("waiting"), ctx).statuses, ["waiting"]);
  const q = parseTaskListQuery({ view: "waiting", status: "completed" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(q, ctx).statuses, ["waiting"]);
});

test("Team tasks: open tasks that are not mine (including unassigned)", () => {
  const p = buildPredicate(plainQuery("team"), ctx);
  assert.deepEqual(p.assignee, { kind: "not", id: ME });
  assert.deepEqual(p.statuses, [...OPEN_TASK_STATUSES]);
});

test("Assigned by me: tasks I created that are not mine", () => {
  const p = buildPredicate(plainQuery("delegated"), ctx);
  assert.equal(p.createdBy, ME);
  assert.deepEqual(p.assignee, { kind: "not", id: ME });
});

test("Completed: completed tasks assigned to me from the last 30 days, or all with show older", () => {
  const p = buildPredicate(plainQuery("completed"), ctx);
  assert.deepEqual(p.statuses, ["completed"]);
  assert.deepEqual(p.assignee, { kind: "is", id: ME });
  assert.equal(p.completedSince, "2026-09-15T01:00:00.000Z");
  const older = parseTaskListQuery({ view: "completed", older: "1" }, { canReadAll: false });
  assert.equal(buildPredicate(older, ctx).completedSince, null);
  // older only matters in the Completed view
  const other = parseTaskListQuery({ view: "mine", older: "1" }, { canReadAll: false });
  assert.equal(buildPredicate(other, ctx).completedSince, null);
});

test("All tasks: every status, any assignee", () => {
  const p = buildPredicate(plainQuery("all"), ctx);
  assert.deepEqual(p.statuses, [...TASK_STATUSES]);
  assert.deepEqual(p.assignee, { kind: "any" });
});

test("the status filter narrows within what the view allows and nothing else", () => {
  const waiting = parseTaskListQuery({ view: "mine", status: "waiting" }, { canReadAll: false });
  assert.deepEqual(buildPredicate(waiting, ctx).statuses, ["waiting"]);
  const closed = parseTaskListQuery({ view: "mine", status: "completed" }, { canReadAll: false });
  assert.deepEqual(buildPredicate(closed, ctx).statuses, [...OPEN_TASK_STATUSES]); // not an option in My tasks
  const team = parseTaskListQuery({ view: "team", status: "completed" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(team, ctx).statuses, ["completed"]);
});

test("the assignee filter only applies where the view offers it", () => {
  const mine = parseTaskListQuery({ view: "mine", assignee: OTHER }, { canReadAll: true });
  assert.deepEqual(buildPredicate(mine, ctx).assignee, { kind: "is", id: ME }); // forged, ignored
  const team = parseTaskListQuery({ view: "team", assignee: OTHER }, { canReadAll: true });
  assert.deepEqual(buildPredicate(team, ctx).assignee, { kind: "is", id: OTHER });
  const teamMe = parseTaskListQuery({ view: "team", assignee: "me" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(teamMe, ctx).assignee, { kind: "not", id: ME });
  const teamNone = parseTaskListQuery({ view: "team", assignee: "none" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(teamNone, ctx).assignee, { kind: "none" });
  const all = parseTaskListQuery({ view: "all", assignee: "me" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(all, ctx).assignee, { kind: "is", id: ME });
  const allBad = parseTaskListQuery({ view: "all", assignee: "not-a-uuid" }, { canReadAll: true });
  assert.deepEqual(buildPredicate(allBad, ctx).assignee, { kind: "any" });
});

test("the assignee id is compared in lower case", () => {
  const upper = ME.toUpperCase();
  const p = buildPredicate(plainQuery("mine"), { ...ctx, meId: upper });
  assert.deepEqual(p.assignee, { kind: "is", id: ME });
});

test("priority, related and title filters pass through; empty ones are null", () => {
  const q = parseTaskListQuery({ view: "all", priority: "urgent", related: "contact", q: "  call   back " }, { canReadAll: true });
  const p = buildPredicate(q, ctx);
  assert.equal(p.priority, "urgent");
  assert.equal(p.related, "contact");
  assert.equal(p.title, "call back");
  const none = buildPredicate(plainQuery("all"), ctx);
  assert.equal(none.priority, null);
  assert.equal(none.related, null);
  assert.equal(none.title, null);
});
