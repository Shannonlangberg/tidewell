import test from "node:test";
import assert from "node:assert/strict";
import { LIST_PAGE_SIZE, Q_MAX, defaultDirFor, parseTaskListQuery, plainQuery, taskOrdering } from "./rules.ts";

const OTHER = "22222222-2222-4222-8222-222222222222";
const read = (sp: Record<string, string | string[] | undefined>, canReadAll = true) => parseTaskListQuery(sp, { canReadAll });

test("defaults: My tasks, soonest due first, page 1", () => {
  const q = read({});
  assert.equal(q.view, "mine");
  assert.equal(q.sort, "due");
  assert.equal(q.dir, "asc");
  assert.equal(q.page, 1);
  assert.equal(q.q, "");
  assert.equal(q.filtered, false);
  assert.equal(LIST_PAGE_SIZE, 25);
});

test("each view starts in its own sort: today by priority, completed by completion, all by newest", () => {
  assert.equal(read({ view: "today" }).sort, "priority");
  assert.equal(read({ view: "today" }).dir, "desc");
  assert.equal(read({ view: "completed" }).sort, "completed");
  assert.equal(read({ view: "completed" }).dir, "desc");
  assert.equal(read({ view: "all" }).sort, "created");
  assert.equal(read({ view: "all" }).dir, "desc");
});

test("sort and direction are allowlisted", () => {
  assert.equal(read({ sort: "priority" }).sort, "priority");
  assert.equal(read({ sort: "priority" }).dir, "desc"); // most pressing first by default
  assert.equal(read({ sort: "priority", dir: "asc" }).dir, "asc");
  assert.equal(read({ sort: "title; drop table tasks" }).sort, "due");
  assert.equal(read({ sort: "due", dir: "sideways" }).dir, "asc");
  assert.equal(read({ sort: "created_at" }).sort, "due");
  assert.equal(defaultDirFor("due"), "asc");
  assert.equal(defaultDirFor("priority"), "desc");
  assert.equal(defaultDirFor("created"), "desc");
  assert.equal(defaultDirFor("completed"), "desc");
});

test("filters outside their allowlists are dropped, not echoed", () => {
  const q = read({ priority: "critical", status: "done", related: "everything", assignee: "<script>" });
  assert.equal(q.priority, null);
  assert.equal(q.status, null);
  assert.equal(q.related, null);
  assert.equal(q.assignee, null);
  assert.equal(q.filtered, false);
});

test("valid filters are kept and mark the list as filtered", () => {
  const q = read({ view: "all", priority: "high", status: "waiting", related: "none", assignee: OTHER.toUpperCase() });
  assert.equal(q.priority, "high");
  assert.equal(q.status, "waiting");
  assert.equal(q.related, "none");
  assert.equal(q.assignee, OTHER); // lower-cased
  assert.equal(q.filtered, true);
});

test("a filter the view does not offer does not count as applied", () => {
  assert.equal(read({ view: "mine", assignee: OTHER }).filtered, false);
  assert.equal(read({ view: "waiting", status: "waiting" }).filtered, false);
  assert.equal(read({ view: "mine", priority: "high" }).filtered, true);
});

test("the title search is trimmed, collapsed and bounded", () => {
  assert.equal(read({ q: "   hello    world  " }).q, "hello world");
  assert.equal(read({ q: "x".repeat(500) }).q.length, Q_MAX);
  assert.equal(read({ q: ["first", "second"] }).q, "first");
  assert.equal(read({ q: "100% _done_" }).q, "100% _done_"); // escaping happens at the query, not here
  assert.equal(read({ q: "a" }).filtered, true);
});

test("page is a bounded positive integer", () => {
  assert.equal(read({ page: "3" }).page, 3);
  assert.equal(read({ page: "0" }).page, 1);
  assert.equal(read({ page: "-4" }).page, 1);
  assert.equal(read({ page: "abc" }).page, 1);
  assert.equal(read({ page: "99999999" }).page, 10_000);
});

test("older is true only for 1", () => {
  assert.equal(read({ older: "1" }).older, true);
  assert.equal(read({ older: "true" }).older, false);
  assert.equal(read({}).older, false);
});

test("plainQuery is a view with nothing chosen", () => {
  const q = plainQuery("team");
  assert.equal(q.view, "team");
  assert.equal(q.filtered, false);
  assert.equal(q.q, "");
  assert.equal(q.sort, "due");
});

test("ordering: the id is always last, so pages never repeat or skip a row", () => {
  for (const sort of ["due", "priority", "created", "completed"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      const terms = taskOrdering(sort, dir);
      assert.equal(terms[terms.length - 1].column, "id", `${sort} ${dir}`);
      assert.ok(terms.every((t) => t.nullsFirst === false), "a missing date always sorts last");
      assert.equal(new Set(terms.map((t) => t.column)).size, terms.length);
    }
  }
});

test("ordering: priority descending puts urgent first (the enum's declared order)", () => {
  const terms = taskOrdering("priority", "desc");
  assert.deepEqual(terms[0], { column: "priority", ascending: false, nullsFirst: false });
  const asc = taskOrdering("priority", "asc");
  assert.equal(asc[0].ascending, true);
});

test("ordering: due follows the direction, then the most pressing priority", () => {
  const terms = taskOrdering("due", "asc");
  assert.deepEqual(terms[0], { column: "due_date", ascending: true, nullsFirst: false });
  assert.deepEqual(terms[1], { column: "priority", ascending: false, nullsFirst: false });
  assert.equal(taskOrdering("due", "desc")[0].ascending, false);
});

test("the linked-records filter is ignored for people who are not offered it", () => {
  assert.equal(parseTaskListQuery({ related: "contact" }, { canReadAll: true }).related, "contact"); // offered by default
  const q = parseTaskListQuery({ related: "contact" }, { canReadAll: false, canFilterRelated: false });
  assert.equal(q.related, null);
  assert.equal(q.filtered, false);
});

test("the Project filter: only with projects.read, a project id or 'none', anything else ignored, and it flows into the predicate", async () => {
  const { buildPredicate } = await import("./rules.ts");
  assert.equal(parseTaskListQuery({ project: OTHER }, { canReadAll: true }).project, null); // not offered by default
  const q = parseTaskListQuery({ project: OTHER.toUpperCase() }, { canReadAll: true, canFilterProject: true });
  assert.equal(q.project, OTHER);
  assert.equal(q.filtered, true);
  assert.equal(parseTaskListQuery({ project: "none" }, { canReadAll: true, canFilterProject: true }).project, "none");
  assert.equal(parseTaskListQuery({ project: "PRJ-0001" }, { canReadAll: true, canFilterProject: true }).project, null);
  assert.equal(plainQuery("mine").project, null);
  const p = buildPredicate(q, { meId: OTHER, today: "2026-10-20", now: new Date("2026-10-20T00:00:00Z") });
  assert.equal(p.project, OTHER);
});
