import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SPAN_DAYS, addDays, daysBetween, financialYearStart, isDate, parsePeriodParams, quarterStart, resolvePeriod, weekStart } from "./periods.ts";

test("dates: validity, quarters, financial years, weeks", () => {
  assert.equal(isDate("2026-02-29"), false);
  assert.equal(isDate("2028-02-29"), true);
  assert.equal(isDate("2026-1-01"), false);
  assert.equal(quarterStart("2026-11-03"), "2026-10-01");
  assert.equal(quarterStart("2026-03-31"), "2026-01-01");
  assert.equal(financialYearStart("2026-11-03"), "2026-07-01");
  assert.equal(financialYearStart("2026-06-30"), "2025-07-01");
  assert.equal(weekStart("2026-11-03"), "2026-11-02"); // a Tuesday -> Monday
  assert.equal(weekStart("2026-11-08"), "2026-11-02"); // a Sunday belongs to the week before
  assert.equal(daysBetween("2026-11-01", "2026-11-03"), 2);
});

test("this month so far is compared with the same days of last month, never all of it", () => {
  const p = resolvePeriod("month", "2026-11-03");
  assert.deepEqual([p.from, p.to, p.days, p.complete], ["2026-11-01", "2026-11-03", 3, false]);
  assert.equal(p.title, "November 2026 so far");
  assert.deepEqual([p.previous?.from, p.previous?.to], ["2026-10-01", "2026-10-03"]);
  assert.equal(p.previous?.title, "the same 3 days of October");
});

test("the 31st compared with a 30-day month stops at the month's end", () => {
  const p = resolvePeriod("month", "2026-12-31");
  assert.equal(p.complete, true);
  assert.equal(p.title, "December 2026");
  assert.deepEqual([p.previous?.from, p.previous?.to, p.previous?.title], ["2026-11-01", "2026-11-30", "November"]);
  const m = resolvePeriod("month", "2026-03-31");
  assert.deepEqual([m.previous?.from, m.previous?.to], ["2026-02-01", "2026-02-28"]);
});

test("quarter and financial year to date compare like with like", () => {
  const q = resolvePeriod("quarter", "2026-11-03");
  assert.deepEqual([q.from, q.to, q.days], ["2026-10-01", "2026-11-03", 34]);
  assert.deepEqual([q.previous?.from, q.previous?.to], ["2026-07-01", "2026-08-03"]);
  const fy = resolvePeriod("fy", "2026-11-03");
  assert.equal(fy.from, "2026-07-01");
  assert.equal(fy.title, "Financial year 2026-27 so far");
  assert.deepEqual([fy.previous?.from, fy.previous?.to], ["2025-07-01", "2025-11-03"]);
});

test("last 30 days is rolling: 30 days, against the 30 before", () => {
  const p = resolvePeriod("30d", "2026-11-03");
  assert.deepEqual([p.from, p.to, p.days], ["2026-10-05", "2026-11-03", 30]);
  assert.deepEqual([p.previous?.from, p.previous?.to], ["2026-09-05", "2026-10-04"]);
  assert.equal(daysBetween(p.previous!.from, p.previous!.to) + 1, 30);
});

test("custom ranges are ordered, clipped to today and to three years, and say so", () => {
  const p = resolvePeriod("custom", "2026-11-03", { from: "2026-09-30", to: "2026-07-01" });
  assert.deepEqual([p.from, p.to, p.days, p.complete], ["2026-07-01", "2026-09-30", 92, true]);
  assert.deepEqual([p.previous?.from, p.previous?.to], ["2026-03-31", "2026-06-30"]);
  const future = resolvePeriod("custom", "2026-11-03", { from: "2026-10-01", to: "2027-01-01" });
  assert.equal(future.to, "2026-11-03");
  assert.match(future.adjusted ?? "", /ends today/);
  const long = resolvePeriod("custom", "2026-11-03", { from: "2010-01-01", to: "2026-11-03" });
  assert.equal(daysBetween(long.from, long.to), MAX_SPAN_DAYS);
  const bad = resolvePeriod("custom", "2026-11-03", { from: "nope", to: null });
  assert.equal(bad.key, "month");
  assert.ok(bad.adjusted);
  const later = resolvePeriod("custom", "2026-11-03", { from: "2027-01-01", to: "2027-02-01" });
  assert.equal(later.key, "month");
});

test("URL parameters fall back to this month", () => {
  assert.deepEqual(parsePeriodParams({}), { key: "month", from: null, to: null });
  assert.deepEqual(parsePeriodParams({ period: "fy" }), { key: "fy", from: null, to: null });
  assert.deepEqual(parsePeriodParams({ period: "custom", from: "2026-07-01", to: "2026-13-01" }), { key: "custom", from: "2026-07-01", to: null });
  assert.equal(parsePeriodParams({ period: "decade" }).key, "month");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
