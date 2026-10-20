import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, OPEN_TASK_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "../constants.ts";
import { daysFromToday, initials } from "../format.ts";
import { FormReader } from "../forms.ts";
import { PRIORITY_RANK, allowedTransitions } from "../tasks/rules.ts";
import {
  BOARD_COLUMNS,
  TASK_PRIORITY_WORD,
  TASK_STATUS_WORD,
  boardColumns,
  canMove,
  checklistText,
  compareTasks,
  daysBetween,
  dueWords,
  filterProjectTasks,
  groupTasks,
  asSentence,
  healthLines,
  initialsOf,
  isOpenTask,
  moveItem,
  moveRefusal,
  moveTargets,
  nestRows,
  parseProjectListQuery,
  parseProjectViewQuery,
  progressText,
  progressWidth,
  projectRef,
  readChecklist,
  readDocumentFields,
  readMilestoneFields,
  readProjectFields,
  safeDocumentUrl,
  type HealthInput,
} from "./rules.ts";
import type { Milestone, ProjectTask } from "./types.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

let seq = 0;
function task(p: Partial<ProjectTask> = {}): ProjectTask {
  seq += 1;
  return {
    id: p.id ?? `t${String(seq).padStart(3, "0")}`,
    title: p.title ?? `Task ${seq}`,
    status: p.status ?? "to_do",
    priority: p.priority ?? "normal",
    dueDate: p.dueDate ?? null,
    assignedTo: p.assignedTo ?? null,
    assignedToName: null,
    createdBy: null,
    projectId: "p",
    projectRef: "PRJ-0001",
    projectName: "P",
    milestoneId: p.milestoneId ?? null,
    milestoneName: null,
    parentId: p.parentId ?? null,
    parentTitle: null,
    sortOrder: p.sortOrder ?? 0,
    blocked: p.blocked ?? false,
    blockedReason: null,
    subtaskCount: 0,
    subtaskOpen: 0,
    checklistTotal: 0,
    checklistDone: 0,
    dependsOnCount: 0,
    blockingCount: 0,
    createdAt: p.createdAt ?? `2026-10-${String(1 + (seq % 20)).padStart(2, "0")}T00:00:00Z`,
    completedAt: null,
  };
}

const ms = (id: string, sortOrder: number, dueDate: string | null = null): Milestone => ({ id, projectId: "p", name: `M ${id}`, description: null, dueDate, status: "open", sortOrder, completedAt: null });

// ── pinned copies ────────────────────────────────────────────

test("the copies in rules.ts match their originals", () => {
  assert.deepEqual(TASK_STATUS_WORD, TASK_STATUS_LABEL);
  assert.deepEqual(TASK_PRIORITY_WORD, TASK_PRIORITY_LABEL);
  for (const s of TASK_STATUSES) {
    assert.equal(isOpenTask(s), (OPEN_TASK_STATUSES as readonly string[]).includes(s), s);
    assert.deepEqual(moveTargets(s), allowedTransitions(s).filter((x) => x !== s), s);
  }
  for (const p of TASK_PRIORITIES) assert.ok(p in PRIORITY_RANK);
  for (const d of ["2026-10-20", "2026-01-01", "2027-03-05", null]) assert.equal(daysBetween("2026-10-20", d), daysFromToday(d, "2026-10-20"));
  for (const n of ["Jane Citizen", "  ana  maria  de silva ", "X", ""]) assert.equal(initialsOf(n), initials(n));
  for (const c of ["projects.read", "projects.write"]) assert.ok((CAPABILITIES as readonly string[]).includes(c), c);
});

test("refs are PRJ-0001", () => {
  assert.equal(projectRef(1), "PRJ-0001");
  assert.equal(projectRef(12345), "PRJ-12345");
  assert.equal(projectRef(null), "");
});

// ── queries ──────────────────────────────────────────────────

test("the projects list query: open by default, anything unknown ignored", () => {
  assert.deepEqual(parseProjectListQuery({}), { q: "", status: "open", owner: null, health: null, filtered: false });
  const q = parseProjectListQuery({ status: "on_hold", owner: "ME", health: "at_risk", q: "  launch   plan " });
  assert.equal(q.status, "on_hold");
  assert.equal(q.owner, "me");
  assert.equal(q.health, "at_risk");
  assert.equal(q.q, "launch plan");
  assert.equal(q.filtered, true);
  assert.equal(parseProjectListQuery({ status: "bogus", owner: "x", health: "great" }).filtered, false);
  assert.equal(parseProjectListQuery({ status: "all" }).status, "all");
  assert.equal(parseProjectListQuery({ owner: A.toUpperCase() }).owner, A);
});

test("the view query: overview by default; list filters", () => {
  const d = parseProjectViewQuery({});
  assert.equal(d.view, "overview");
  assert.equal(d.group, "milestone");
  assert.equal(d.status, "open");
  assert.equal(d.filtered, false);
  assert.equal(parseProjectViewQuery({ view: "board" }).view, "board");
  assert.equal(parseProjectViewQuery({ view: "gantt" }).view, "overview");
  const l = parseProjectViewQuery({ view: "list", group: "status", status: "waiting", assignee: "none", priority: "urgent", blocked: "1" });
  assert.deepEqual([l.group, l.status, l.assignee, l.priority, l.blockedOnly, l.filtered], ["status", "waiting", "none", "urgent", true, true]);
  assert.equal(parseProjectViewQuery({ assignee: "robert'); drop" }).assignee, null);
});

test("filterProjectTasks applies status, assignee, priority and blocked", () => {
  const ts = [
    task({ status: "to_do", assignedTo: ME, priority: "urgent", blocked: true }),
    task({ status: "completed", assignedTo: ME }),
    task({ status: "waiting", assignedTo: A }),
    task({ status: "in_progress" }),
  ];
  const base = { status: "open" as const, assignee: null, priority: null, blockedOnly: false };
  assert.equal(filterProjectTasks(ts, base, ME).length, 3);
  assert.equal(filterProjectTasks(ts, { ...base, status: "all" }, ME).length, 4);
  assert.equal(filterProjectTasks(ts, { ...base, status: "completed" }, ME).length, 1);
  assert.equal(filterProjectTasks(ts, { ...base, assignee: "me" }, ME).length, 1);
  assert.equal(filterProjectTasks(ts, { ...base, assignee: "none" }, ME).length, 1);
  assert.equal(filterProjectTasks(ts, { ...base, assignee: A }, ME).length, 1);
  assert.equal(filterProjectTasks(ts, { ...base, priority: "urgent" }, ME).length, 1);
  assert.equal(filterProjectTasks(ts, { ...base, blockedOnly: true }, ME).length, 1);
});

// ── forms ────────────────────────────────────────────────────

test("project form: name required, defaults, target not before start", () => {
  let r = new FormReader(form({}));
  readProjectFields(r);
  assert.ok(r.errors.name);

  r = new FormReader(form({ name: "Launch Planted Property", owner_id: A.toUpperCase(), start_date: "2026-11-01", target_date: "2027-02-01" }));
  const v = readProjectFields(r);
  assert.equal(r.ok, true);
  assert.equal(v.status, "planning");
  assert.equal(v.priority, "normal");
  assert.equal(v.ownerId, A);

  r = new FormReader(form({ name: "X", start_date: "2026-11-01", target_date: "2026-10-31" }));
  readProjectFields(r);
  assert.ok(r.errors.target_date);

  r = new FormReader(form({ name: "X", status: "archived", priority: "critical", start_date: "2026-02-30" }));
  readProjectFields(r);
  assert.ok(r.errors.status && r.errors.priority && r.errors.start_date);

  r = new FormReader(form({ name: "x".repeat(201) }));
  readProjectFields(r);
  assert.ok(r.errors.name);
});

test("milestone form", () => {
  const r = new FormReader(form({ name: "Licensing", due_date: "2026-12-01" }));
  assert.deepEqual(readMilestoneFields(r), { name: "Licensing", description: null, dueDate: "2026-12-01" });
  const bad = new FormReader(form({ name: "" }));
  readMilestoneFields(bad);
  assert.ok(bad.errors.name);
});

test("document links: https only, no credentials, at most 500 characters", () => {
  assert.equal(safeDocumentUrl("https://docs.example.com/a?b=1"), "https://docs.example.com/a?b=1");
  for (const bad of ["http://example.com", "javascript:alert(1)", "https://localhost", "https://user:pw@example.com", "ftp://x.y", "", `https://e.com/${"a".repeat(500)}`, "example.com"]) {
    assert.equal(safeDocumentUrl(bad), null, bad);
  }
  const f = form({ title: "Licence course", url: "http://insecure.example.com" });
  const r = new FormReader(f);
  readDocumentFields(r, f);
  assert.ok(r.errors.url);
});

test("checklist posts keep their order, drop blanks, and bound length", () => {
  const ok = readChecklist(form({ item: ["Book exam", "  ", "Pay  fee"], done: ["2"] }));
  assert.deepEqual(ok, { items: [{ text: "Book exam", done: false }, { text: "Pay fee", done: true }], error: null });
  assert.ok(readChecklist(form({ item: ["x".repeat(301)] })).error);
  assert.ok(readChecklist(form({ item: Array.from({ length: 51 }, (_, i) => `i${i}`) })).error);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

// ── ordering and grouping ────────────────────────────────────

test("tasks order by sort order, then due (none last), then priority, then age", () => {
  const a = task({ sortOrder: 1 });
  const b = task({ sortOrder: 0, dueDate: null });
  const c = task({ sortOrder: 0, dueDate: "2026-11-01" });
  const d = task({ sortOrder: 0, dueDate: "2026-11-01", priority: "urgent" });
  assert.deepEqual([a, b, c, d].sort(compareTasks).map((t) => t.id), [d.id, c.id, b.id, a.id]);
});

test("subtasks follow their parent, one level, and orphans stand alone", () => {
  const parent = task({ sortOrder: 1 });
  const child = task({ parentId: parent.id, sortOrder: 0 });
  const other = task({ sortOrder: 2 });
  const orphan = task({ parentId: "missing", sortOrder: 0 });
  const rows = nestRows([child, other, parent, orphan]);
  assert.deepEqual(
    rows.map((r) => [r.task.id, r.depth]),
    [
      [orphan.id, 0],
      [parent.id, 0],
      [child.id, 1],
      [other.id, 0],
    ],
  );
});

test("grouping by milestone keeps milestone order, empty milestones, and a No milestone group", () => {
  const m1 = ms("m1", 1);
  const m2 = ms("m2", 0);
  const parent = task({ milestoneId: "m1" });
  const child = task({ parentId: parent.id, milestoneId: null });
  const loose = task({});
  const groups = groupTasks([parent, child, loose], [m1, m2], "milestone");
  assert.deepEqual(
    groups.map((g) => [g.key, g.rows.length]),
    [
      ["m2", 0],
      ["m1", 2],
      ["none", 1],
    ],
  );
  assert.equal(groupTasks([loose], [], "milestone")[0].label, "Tasks");
});

test("grouping by status drops empty statuses", () => {
  const groups = groupTasks([task({ status: "waiting" }), task({ status: "to_do" })], [], "status");
  assert.deepEqual(
    groups.map((g) => g.key),
    ["to_do", "waiting"],
  );
});

// ── the board ────────────────────────────────────────────────

test("board columns and moves follow the task transitions", () => {
  assert.deepEqual([...BOARD_COLUMNS], ["to_do", "in_progress", "waiting", "completed"]);
  const cols = boardColumns([task({ status: "waiting" }), task({ status: "cancelled" }), task({ status: "to_do" })]);
  assert.deepEqual(
    cols.map((c) => c.tasks.length),
    [1, 0, 1, 0],
  );
  assert.equal(canMove("to_do", "completed"), true);
  assert.equal(canMove("completed", "waiting"), false);
  assert.equal(canMove("to_do", "to_do"), false);
  assert.equal(moveRefusal("completed", "waiting"), "A completed task can only be reopened: move it to To do or In progress.");
});

// ── health and progress ──────────────────────────────────────

const H: HealthInput = { health: "on_track", reasons: ["No overdue work and the target date is comfortable"], blockedCount: 0, totalCount: 5 };

test("health lines tidy the database's reasons into sentences and add the plain extras", () => {
  assert.deepEqual(healthLines(H), ["No overdue work and the target date is comfortable."]);
  assert.equal(asSentence("  a task is 9 days overdue "), "A task is 9 days overdue.");
  assert.equal(asSentence("Done!"), "Done!");
  assert.equal(asSentence(""), "");
  assert.deepEqual(healthLines({ ...H, health: "off_track", reasons: ["A task is 9 days overdue", "A milestone is past its due date"], blockedCount: 2 }), [
    "A task is 9 days overdue.",
    "A milestone is past its due date.",
    "2 tasks are waiting on other tasks.",
  ]);
  assert.deepEqual(healthLines({ ...H, totalCount: 0 }), ["No tasks yet: add the first few steps and progress will show here."]);
  assert.deepEqual(healthLines({ ...H, health: "done", reasons: ["The project is completed"], blockedCount: 3 }), ["The project is completed."]);
  assert.deepEqual(healthLines({ ...H, blockedCount: 1 }), ["No overdue work and the target date is comfortable.", "1 task is waiting on another task."]);
});

test("progress text and width", () => {
  assert.equal(progressText(3, 12), "3 of 12 done");
  assert.equal(progressText(0, 0), "No tasks yet");
  assert.equal(progressWidth(33.4), 33);
  assert.equal(progressWidth(140), 100);
  assert.equal(progressWidth(Number.NaN), 0);
});

test("due words and checklist text", () => {
  assert.equal(dueWords("2026-10-20", "to_do", "2026-10-20"), "Due today");
  assert.equal(dueWords("2026-10-21", "to_do", "2026-10-20"), "Due tomorrow");
  assert.equal(dueWords("2026-10-19", "waiting", "2026-10-20"), "1 day overdue");
  assert.equal(dueWords("2026-10-10", "completed", "2026-10-20"), "");
  assert.equal(dueWords("2026-12-25", "to_do", "2026-10-20"), "");
  assert.equal(dueWords(null, "to_do", "2026-10-20"), "");
  assert.equal(checklistText(2, 5), "2/5");
  assert.equal(checklistText(0, 0), "");
});
