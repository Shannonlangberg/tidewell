import test from "node:test";
import assert from "node:assert/strict";
import { barStart, buildTimeline, monthStart, nextMonthStart, percentOf, type TimelineTaskInput } from "./timeline.ts";

const t = (p: Partial<TimelineTaskInput> & { id: string }): TimelineTaskInput => ({
  title: p.id,
  status: "to_do",
  dueDate: null,
  createdAt: "2026-10-01T03:00:00Z",
  milestoneId: null,
  after: [],
  ...p,
});

test("month helpers", () => {
  assert.equal(monthStart("2026-10-20"), "2026-10-01");
  assert.equal(nextMonthStart("2026-10-20"), "2026-11-01");
  assert.equal(nextMonthStart("2026-12-05"), "2027-01-01");
  assert.equal(percentOf("2026-10-01", "2026-10-01", "2026-11-01"), 0);
  assert.equal(percentOf("2026-11-01", "2026-10-01", "2026-11-01"), 100);
  assert.equal(percentOf("2027-01-01", "2026-10-01", "2026-11-01"), 100);
  assert.equal(percentOf("2026-10-16", "2026-10-01", "2026-10-31"), 50);
});

test("a bar starts at creation, or after its latest dependency, never after it is due", () => {
  assert.equal(barStart(t({ id: "a", dueDate: "2026-10-20" })), "2026-10-01");
  assert.equal(barStart(t({ id: "a", dueDate: "2026-10-20", after: [{ title: "x", dueDate: "2026-10-12" }, { title: "y", dueDate: "2026-10-15" }] })), "2026-10-15");
  assert.equal(barStart(t({ id: "a", dueDate: "2026-10-20", after: [{ title: "x", dueDate: "2026-11-30" }] })), "2026-10-20");
  assert.equal(barStart(t({ id: "a", dueDate: "2026-09-20" })), "2026-09-20");
  assert.equal(barStart(t({ id: "a" })), null);
});

test("the range covers everything and today, in whole months, at least three", () => {
  const m = buildTimeline({ projectStart: null, projectTarget: null, today: "2026-10-20", milestones: [], tasks: [] });
  assert.equal(m.from, "2026-10-01");
  assert.equal(m.to, "2027-01-01");
  assert.deepEqual(
    m.months.map((x) => x.label),
    ["Oct 2026", "Nov", "Dec"],
  );
  const widths = m.months.reduce((s, x) => s + x.width, 0);
  assert.ok(Math.abs(widths - 100) < 0.05, `months fill the range (${widths})`);
  assert.ok(m.todayLeft !== null && m.todayLeft > 0 && m.todayLeft < 34);

  const big = buildTimeline({
    projectStart: "2026-09-15",
    projectTarget: "2027-03-01",
    today: "2026-10-20",
    milestones: [{ id: "m", name: "Launch", dueDate: "2027-02-10", done: false }],
    tasks: [],
  });
  assert.equal(big.from, "2026-09-01");
  assert.equal(big.to, "2027-04-01");
  assert.equal(big.months.find((x) => x.key === "2027-01")?.label, "Jan 2027");
});

test("lanes by milestone, overdue in the error tone, after-labels, undated listed apart", () => {
  const m = buildTimeline({
    projectStart: "2026-10-01",
    projectTarget: "2026-12-20",
    today: "2026-10-20",
    milestones: [
      { id: "m1", name: "Licensing", dueDate: "2026-10-15", done: false },
      { id: "m2", name: "Launch", dueDate: "2026-12-15", done: false },
    ],
    tasks: [
      t({ id: "late", dueDate: "2026-10-10", milestoneId: "m1" }),
      t({ id: "done", dueDate: "2026-10-05", status: "completed", milestoneId: "m1" }),
      t({ id: "site", dueDate: "2026-12-01", milestoneId: "m2", after: [{ title: "late", dueDate: "2026-10-10" }] }),
      t({ id: "loose", dueDate: "2026-11-01" }),
      t({ id: "nodate", milestoneId: "m2" }),
    ],
  });
  assert.deepEqual(
    m.lanes.map((l) => [l.key, l.bars.map((b) => b.id)]),
    [
      ["m1", ["done", "late"]],
      ["m2", ["site"]],
      ["none", ["loose"]],
    ],
  );
  const late = m.lanes[0].bars.find((b) => b.id === "late")!;
  assert.equal(late.overdue, true);
  assert.equal(m.lanes[0].bars.find((b) => b.id === "done")!.overdue, false);
  assert.equal(m.lanes[0].marker?.overdue, true);
  assert.equal(m.lanes[1].marker?.overdue, false);
  const site = m.lanes[1].bars[0];
  assert.equal(site.afterLabel, "After late");
  assert.equal(site.start, "2026-10-10");
  assert.ok(site.left > late.left);
  assert.deepEqual(m.undated, [{ id: "nodate", title: "nodate" }]);
  for (const l of m.lanes) for (const b of l.bars) assert.ok(b.left >= 0 && b.left + b.width <= 100.5 && b.width >= m.minWidth, b.id);
});

test("the range always reaches today, so a finished project still shows where today falls", () => {
  const m = buildTimeline({ projectStart: "2026-01-01", projectTarget: "2026-02-01", today: "2026-10-20", milestones: [], tasks: [] });
  assert.equal(m.from, "2026-01-01");
  assert.equal(m.to, "2026-11-01");
  assert.ok(m.todayLeft !== null && m.todayLeft > 90);
});
