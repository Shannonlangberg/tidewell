// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PERIOD, PERIODS, addDays, parsePeriod, periodStart, subtractDays } from "./periods.ts";

test("parsePeriod accepts the known periods and defaults otherwise", () => {
  for (const p of PERIODS) assert.equal(parsePeriod(p), p);
  assert.equal(parsePeriod(["90d", "30d"]), "90d");
  assert.equal(parsePeriod("forever"), DEFAULT_PERIOD);
  assert.equal(parsePeriod(undefined), DEFAULT_PERIOD);
  assert.equal(parsePeriod(null), DEFAULT_PERIOD);
  assert.equal(DEFAULT_PERIOD, "30d");
});

test("subtractDays crosses month and year ends", () => {
  assert.equal(subtractDays("2026-10-15", 30), "2026-09-15");
  assert.equal(subtractDays("2026-01-10", 30), "2025-12-11");
  assert.equal(subtractDays("2024-03-01", 1), "2024-02-29"); // leap year
  assert.throws(() => subtractDays("nope", 1), RangeError);
});

test("addDays moves forward and back across month and year ends", () => {
  assert.equal(addDays("2026-10-15", 7), "2026-10-22");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-10-15", 0), "2026-10-15");
  assert.throws(() => addDays("nope", 1), RangeError);
});

test("30 and 90 day windows match hq.growth_summary's own default (today minus 30)", () => {
  assert.equal(periodStart("30d", "2026-10-15"), "2026-09-15");
  assert.equal(periodStart("90d", "2026-10-15"), "2026-07-17");
});

test("the Australian financial year starts on 1 July", () => {
  assert.equal(periodStart("fy", "2026-10-15"), "2026-07-01");
  assert.equal(periodStart("fy", "2026-07-01"), "2026-07-01");
  assert.equal(periodStart("fy", "2026-06-30"), "2025-07-01");
  assert.equal(periodStart("fy", "2027-01-02"), "2026-07-01");
});

test("all time starts early enough to include everything", () => {
  assert.equal(periodStart("all", "2026-10-15"), "2000-01-01");
});
