// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TIME_START,
  DEFAULT_GROWTH_PERIOD,
  GROWTH_PERIODS,
  financialYearLabel,
  financialYearStart,
  growthPeriodStart,
  growthPeriodTitle,
  monthStart,
  parseGrowthPeriod,
  shiftDays,
} from "./periods.ts";

test("parseGrowthPeriod accepts the four periods and defaults otherwise", () => {
  for (const p of GROWTH_PERIODS) assert.equal(parseGrowthPeriod(p), p);
  assert.equal(parseGrowthPeriod(["fy", "all"]), "fy");
  assert.equal(parseGrowthPeriod("forever"), DEFAULT_GROWTH_PERIOD);
  assert.equal(parseGrowthPeriod("90d"), DEFAULT_GROWTH_PERIOD);
  assert.equal(parseGrowthPeriod(undefined), DEFAULT_GROWTH_PERIOD);
  assert.equal(parseGrowthPeriod(42), DEFAULT_GROWTH_PERIOD);
  assert.equal(DEFAULT_GROWTH_PERIOD, "30d");
});

test("the Australian financial year runs 1 July to 30 June", () => {
  assert.equal(financialYearStart("2026-10-15"), "2026-07-01");
  assert.equal(financialYearStart("2026-07-01"), "2026-07-01"); // the first day belongs to the new year
  assert.equal(financialYearStart("2026-06-30"), "2025-07-01"); // the last day belongs to the old one
  assert.equal(financialYearStart("2027-01-01"), "2026-07-01");
  assert.equal(financialYearStart("2026-12-31"), "2026-07-01");
  assert.equal(financialYearStart("2026-01-01"), "2025-07-01");
});

test("the financial year label crosses the century correctly", () => {
  assert.equal(financialYearLabel("2026-10-15"), "2026–27");
  assert.equal(financialYearLabel("2027-03-01"), "2026–27");
  assert.equal(financialYearLabel("2099-08-01"), "2099–00");
  assert.equal(financialYearLabel("2030-06-30"), "2029–30");
});

test("month start is the first of the month", () => {
  assert.equal(monthStart("2026-10-15"), "2026-10-01");
  assert.equal(monthStart("2026-10-01"), "2026-10-01");
  assert.equal(monthStart("2024-02-29"), "2024-02-01");
});

test("shiftDays crosses month, year and leap-day boundaries", () => {
  assert.equal(shiftDays("2026-10-15", -30), "2026-09-15");
  assert.equal(shiftDays("2026-01-10", -30), "2025-12-11");
  assert.equal(shiftDays("2024-03-01", -1), "2024-02-29");
  assert.equal(shiftDays("2026-12-31", 1), "2027-01-01");
  assert.throws(() => shiftDays("nope", 1), RangeError);
  assert.throws(() => shiftDays("2026-02-30", 1), RangeError);
});

test("each period starts where it says, and 30 days matches the database default", () => {
  const today = "2026-10-15";
  assert.equal(growthPeriodStart("month", today), "2026-10-01");
  assert.equal(growthPeriodStart("30d", today), "2026-09-15");
  assert.equal(growthPeriodStart("fy", today), "2026-07-01");
  assert.equal(growthPeriodStart("all", today), ALL_TIME_START);
  // The first day of a new financial year and a new month
  assert.equal(growthPeriodStart("fy", "2026-07-01"), "2026-07-01");
  assert.equal(growthPeriodStart("month", "2026-11-01"), "2026-11-01");
  // Early July: this financial year has barely begun, and last year's is not included
  assert.equal(growthPeriodStart("fy", "2026-07-03"), "2026-07-01");
});

test("the financial year title names the year", () => {
  assert.equal(growthPeriodTitle("fy", "2026-10-15"), "This financial year (2026–27)");
  assert.equal(growthPeriodTitle("month", "2026-10-15"), "This month");
  assert.equal(growthPeriodTitle("all", "2026-10-15"), "All time");
});
