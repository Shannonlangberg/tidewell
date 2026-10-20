// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "../../constants.ts";
import * as P from "../../projects/rules.ts";
import { MAX_BULK_ENTRIES, MAX_TOOL_INPUT_ELEMENTS } from "../limits.ts";
import * as S from "./project-schemas.ts";
import { createTaskShape, listTasksShape, updateTaskShape } from "./schemas.ts";

test("the project vocabulary and bounds match lib/hq/projects/rules.ts and lib/hq/constants.ts", () => {
  assert.deepEqual([...S.PROJECT_STATUS_VALUES], [...P.PROJECT_STATUSES]);
  assert.deepEqual([...S.NEW_PROJECT_STATUS_VALUES], [...P.OPEN_PROJECT_STATUSES]);
  assert.deepEqual([...S.PROJECT_HEALTH_VALUES].sort(), [...P.PROJECT_HEALTHS].sort());
  assert.deepEqual([...S.TASK_PRIORITY_VALUES_P], [...TASK_PRIORITIES]);
  assert.deepEqual([...S.TASK_STATUS_VALUES_P], [...TASK_STATUSES]);
  assert.equal(S.NAME_MAX, P.NAME_MAX);
  assert.equal(S.PROJECT_DESCRIPTION_MAX, P.PROJECT_DESCRIPTION_MAX);
  assert.equal(S.NOTES_MAX, P.NOTES_MAX);
  assert.equal(S.MILESTONE_DESCRIPTION_MAX, P.MILESTONE_DESCRIPTION_MAX);
  assert.equal(S.CHECKLIST_TEXT_MAX, P.CHECKLIST_TEXT_MAX);
  assert.equal(S.CHECKLIST_MAX, P.CHECKLIST_MAX_ITEMS);
  assert.equal(S.COMMENT_MAX, P.COMMENT_MAX);
  assert.equal(S.BULK_MAX, MAX_BULK_ENTRIES);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every field of every project tool says what it is", () => {
  assert.equal(shapes.length, 18);
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
  for (const [name, shape] of [["listTasksShape", listTasksShape], ["createTaskShape", createTaskShape], ["updateTaskShape", updateTaskShape]] as const) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

const KEY = "6b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
const bulk = z.object(S.bulkCreateTasksShape);
const plan = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ ref: `t${i + 1}`, title: `Step ${i + 1}`, ...extra }));

test("bulk create: 1 and 50 entries pass, 0 and 51 are refused, the key is 8 to 80 safe characters", () => {
  assert.equal(bulk.safeParse({ tasks: plan(1), idempotency_key: KEY }).success, true);
  assert.equal(bulk.safeParse({ tasks: plan(50), idempotency_key: KEY }).success, true);
  const none = bulk.safeParse({ tasks: [], idempotency_key: KEY });
  assert.equal(none.success, false);
  const many = bulk.safeParse({ tasks: plan(51), idempotency_key: KEY });
  assert.equal(many.success, false);
  assert.match(JSON.stringify(many.error?.issues), /At most 50 tasks in one call/);
  assert.equal(bulk.safeParse({ tasks: plan(1) }).success, false, "the key is required");
  assert.equal(bulk.safeParse({ tasks: plan(1), idempotency_key: "short" }).success, false);
  assert.equal(bulk.safeParse({ tasks: plan(1), idempotency_key: "x".repeat(81) }).success, false);
  assert.equal(bulk.safeParse({ tasks: plan(1), idempotency_key: "has spaces in it" }).success, false);
});

test("bulk create entries: the contract's fields, with their bounds", () => {
  const full = {
    ref: "licence",
    title: "Enrol in the licensing course",
    description: "Cert IV",
    assignee: "me",
    priority: "high",
    status: "to_do",
    due_date: "2026-11-01",
    project: "PRJ-0001",
    milestone: "Licensed",
    parent_ref: "t1",
    depends_on: ["t2", KEY],
    checklist: ["Pick a provider", "Pay"],
    contact: "Tim Hosking",
    organisation: "eXp Realty",
    contractor: "Moonta Plumbing",
  };
  assert.equal(bulk.safeParse({ tasks: [full], idempotency_key: KEY, atomic: true, project: "Launch" }).success, true);
  assert.equal(bulk.safeParse({ tasks: [{ ...full, title: "" }], idempotency_key: KEY }).success, false);
  assert.equal(bulk.safeParse({ tasks: [{ ...full, due_date: "1/11/2026" }], idempotency_key: KEY }).success, false);
  assert.equal(bulk.safeParse({ tasks: [{ ...full, status: "completed" }], idempotency_key: KEY }).success, false, "a new task starts open");
  assert.equal(bulk.safeParse({ tasks: [{ ...full, ref: "has space" }], idempotency_key: KEY }).success, false);
  assert.equal(bulk.safeParse({ tasks: [{ ...full, depends_on: plan(11).map((p) => p.ref) }], idempotency_key: KEY }).success, false);
  assert.equal(bulk.safeParse({ tasks: [{ ...full, checklist: plan(13).map((p) => p.title) }], idempotency_key: KEY }).success, false);
});

test("the biggest bulk call the schema allows fits the server's argument-element ceiling", () => {
  const entry = { ref: "r", title: "t", description: "d", assignee: "me", priority: "low", status: "to_do", due_date: "2026-11-01", project: "p", milestone: "m", parent_ref: "x", depends_on: Array(S.BULK_DEPENDS_MAX).fill("a"), checklist: Array(S.BULK_CHECKLIST_MAX).fill("c"), contact: "c", organisation: "o", contractor: "c" };
  const args = { tasks: Array(S.BULK_MAX).fill(entry), project: "p", idempotency_key: KEY, atomic: false };
  assert.equal(bulk.safeParse(args).success, true);
  let count = 0;
  const walk = (v: unknown) => {
    const children = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
    for (const x of children) {
      count += 1;
      walk(x);
    }
  };
  walk(args);
  assert.ok(count <= MAX_TOOL_INPUT_ELEMENTS, `${count} elements`);
});

test("bulk update, checklist, dependencies and projects are checked before anything runs", () => {
  const upd = z.object(S.bulkUpdateTasksShape);
  assert.equal(upd.safeParse({ updates: [{ task: KEY, status: "completed" }], idempotency_key: KEY }).success, true);
  assert.equal(upd.safeParse({ updates: [{ task: KEY, due_date: "none", project: "none" }], idempotency_key: KEY }).success, true);
  assert.equal(upd.safeParse({ updates: [], idempotency_key: KEY }).success, false);
  assert.equal(upd.safeParse({ updates: Array(51).fill({ task: KEY }), idempotency_key: KEY }).success, false);
  const chk = z.object(S.setTaskChecklistShape);
  assert.equal(chk.safeParse({ task: KEY, items: ["a", { text: "b", done: true }] }).success, true);
  assert.equal(chk.safeParse({ task: KEY, items: [] }).success, true, "an empty list clears it");
  assert.equal(chk.safeParse({ task: KEY, items: ["x".repeat(301)] }).success, false);
  const proj = z.object(S.createProjectShape);
  assert.equal(proj.safeParse({ name: "Launch Planted Property", milestones: [{ name: "Licensed", due_date: "2026-12-01" }] }).success, true);
  assert.equal(proj.safeParse({ name: "Launch", status: "completed" }).success, false, "a new project is not created completed");
  assert.equal(proj.safeParse({ name: "" }).success, false);
  assert.equal(z.object(S.updateProjectShape).safeParse({ project: "PRJ-0001", status: "cancelled", target_date: "none" }).success, true);
  assert.equal(z.object(S.founderPrioritiesShape).safeParse({ limit: 11 }).success, false);
  assert.equal(z.object(listTasksShape).safeParse({ project: "PRJ-0001", blocked: true }).success, true);
});
