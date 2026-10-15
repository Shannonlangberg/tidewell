import test from "node:test";
import assert from "node:assert/strict";
import { buildActivity, staffIdsInAudit, type ActivityTask, type AuditRow, type NameOf } from "./activity.ts";

const SHANNON = "11111111-1111-4111-8111-111111111111";
const COURTNEY = "22222222-2222-4222-8222-222222222222";
const NAMES: Record<string, string> = { [SHANNON]: "Shannon Langberg", [COURTNEY]: "Courtney Reid" };
const nameOf: NameOf = (id) => (id ? (NAMES[id] ?? null) : null);

const task: ActivityTask = {
  id: "t1",
  status: "to_do",
  createdAt: "2026-10-10T01:00:00.000Z",
  createdBy: SHANNON,
  completedAt: null,
  completedBy: null,
  updatedAt: "2026-10-10T01:00:00.000Z",
};

test("without audit access: just the task row, with no invented history", () => {
  const events = buildActivity({ task, audit: null, nameOf });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "created");
  assert.equal(events[0].actor, "Shannon Langberg");
  assert.equal(events[0].at, task.createdAt);
});

test("without audit access: completion and the last change are shown, newest first", () => {
  const done: ActivityTask = {
    ...task,
    status: "completed",
    completedAt: "2026-10-12T03:00:00.000Z",
    completedBy: COURTNEY,
    updatedAt: "2026-10-12T03:00:00.000Z",
  };
  const events = buildActivity({ task: done, audit: null, nameOf });
  assert.deepEqual(events.map((e) => e.kind), ["completed", "created"]);
  assert.equal(events[0].actor, "Courtney Reid");

  const edited: ActivityTask = { ...task, status: "waiting", updatedAt: "2026-10-11T05:00:00.000Z" };
  const e2 = buildActivity({ task: edited, audit: null, nameOf });
  assert.deepEqual(e2.map((e) => e.kind), ["updated", "created"]);
  assert.equal(e2[0].detail, "Status is Waiting");
});

test("without audit access: a task never touched has no 'last updated' line", () => {
  assert.equal(buildActivity({ task, audit: null, nameOf }).some((e) => e.kind === "updated"), false);
});

const audit = (rows: Partial<AuditRow>[]): AuditRow[] =>
  rows.map((r, i) => ({ id: i + 1, at: "2026-10-10T01:00:00.000Z", actor_id: SHANNON, actor_name: "Shannon Langberg", action: "update", changes: {}, ...r }));

test("with audit access: a status change to completed reads as 'Marked complete', and the completion stamps are not separate news", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([
      {
        id: 2,
        at: "2026-10-12T03:00:00.000Z",
        actor_id: COURTNEY,
        actor_name: "Courtney Reid",
        changes: {
          status: { from: "to_do", to: "completed" },
          completed_at: { from: null, to: "2026-10-12T03:00:00+00:00" },
          completed_by: { from: null, to: COURTNEY },
        },
      },
      { id: 1, action: "create", changes: { title: { to: "x" } } },
    ]),
  });
  assert.deepEqual(events.map((e) => [e.kind, e.title]), [["completed", "Marked complete"], ["created", "Task created"]]);
  assert.equal(events[0].detail, "To do to Completed");
  assert.equal(events[0].actor, "Courtney Reid");
});

test("with audit access: the audited creation replaces the row-derived one (no duplicate)", () => {
  const events = buildActivity({ task, nameOf, audit: audit([{ id: 1, action: "create" }]) });
  assert.equal(events.filter((e) => e.kind === "created").length, 1);
});

test("with audit access but no audited creation, the row still supplies 'created'", () => {
  const events = buildActivity({ task, nameOf, audit: audit([{ id: 5, at: "2026-10-11T00:00:00.000Z", changes: { priority: { from: "normal", to: "urgent" } } }]) });
  assert.deepEqual(events.map((e) => e.kind), ["priority", "created"]);
  assert.equal(events[0].detail, "Normal to Urgent");
});

test("reopen and cancel are named as such", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([
      { id: 3, at: "2026-10-13T00:00:00.000Z", changes: { status: { from: "completed", to: "to_do" } } },
      { id: 2, at: "2026-10-12T00:00:00.000Z", changes: { status: { from: "waiting", to: "cancelled" } } },
      { id: 1, at: "2026-10-11T00:00:00.000Z", changes: { status: { from: "to_do", to: "in_progress" } } },
    ]),
  });
  assert.deepEqual(events.slice(0, 3).map((e) => e.kind), ["reopened", "cancelled", "status"]);
});

test("reassignment names both people, or 'no one'", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([
      { id: 2, at: "2026-10-12T00:00:00.000Z", changes: { assigned_to: { from: SHANNON, to: COURTNEY } } },
      { id: 1, at: "2026-10-11T00:00:00.000Z", changes: { assigned_to: { from: COURTNEY, to: null } } },
    ]),
  });
  assert.equal(events[0].title, "Reassigned");
  assert.equal(events[0].detail, "Shannon Langberg to Courtney Reid");
  assert.equal(events[1].title, "Unassigned");
  assert.equal(events[1].detail, "Courtney Reid to no one");
});

test("an unknown person reads 'someone', never a raw id", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([{ id: 2, at: "2026-10-12T00:00:00.000Z", changes: { assigned_to: { from: "99999999-9999-4999-8999-999999999999", to: COURTNEY } } }]),
  });
  assert.equal(events[0].detail, "someone to Courtney Reid");
});

test("one update that changes several fields yields one line each; the description text is never shown", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([
      {
        id: 2,
        at: "2026-10-12T00:00:00.000Z",
        changes: {
          title: { from: "Old", to: "New" },
          description: { from: "secret old text", to: "secret new text" },
          due_date: { from: null, to: "2026-10-20" },
          related_contact_id: { from: null, to: "c1" },
        },
      },
    ]),
  });
  const kinds = events.filter((e) => e.kind !== "created").map((e) => e.kind);
  assert.deepEqual(kinds, ["due", "title", "description", "linked"]);
  assert.equal(events.find((e) => e.kind === "description")?.detail, null);
  assert.equal(JSON.stringify(events).includes("secret"), false);
  assert.equal(events.find((e) => e.kind === "due")?.detail, "No date to 20 Oct 2026");
});

test("archive, restore and an update with nothing recognisable", () => {
  const events = buildActivity({
    task,
    nameOf,
    audit: audit([
      { id: 3, at: "2026-10-14T00:00:00.000Z", action: "restore", changes: { deleted_at: { from: "x", to: null } } },
      { id: 2, at: "2026-10-13T00:00:00.000Z", action: "archive", changes: { deleted_at: { from: null, to: "x" } } },
      { id: 1, at: "2026-10-12T00:00:00.000Z", changes: { source: { from: "manual", to: "interaction" } } },
    ]),
  });
  assert.deepEqual(events.slice(0, 3).map((e) => e.kind), ["restored", "archived", "updated"]);
});

test("malformed audit data does not throw", () => {
  const events = buildActivity({ task, nameOf, audit: audit([{ id: 1, changes: null }, { id: 2, changes: "oops" }, { id: 3, changes: [] }, { id: 4, changes: { status: {} } }]) });
  assert.ok(events.length >= 4);
  assert.ok(events.every((e) => typeof e.title === "string"));
});

test("staffIdsInAudit lists actors and reassignment targets once", () => {
  const ids = staffIdsInAudit(
    audit([
      { id: 1, actor_id: SHANNON, changes: { assigned_to: { from: SHANNON, to: COURTNEY } } },
      { id: 2, actor_id: COURTNEY, changes: {} },
    ]),
  );
  assert.deepEqual(ids.sort(), [COURTNEY, SHANNON].sort());
  assert.deepEqual(staffIdsInAudit(null), []);
});
