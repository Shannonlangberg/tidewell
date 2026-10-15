import test from "node:test";
import assert from "node:assert/strict";
import { todayIn } from "../format.ts";
import {
  UPCOMING_DAYS,
  addDays,
  completedCutoff,
  dueBucket,
  isCalendarDate,
  isOverdue,
  isPastDate,
  overdueLabel,
  upcomingRange,
} from "./rules.ts";

const ADL = "Australia/Adelaide";

test("addDays is calendar arithmetic across month, year and leap boundaries", () => {
  assert.equal(addDays("2026-10-15", 1), "2026-10-16");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2028-02-29", 1), "2028-03-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-10-15", 0), "2026-10-15");
  assert.equal(addDays("2026-10-15", 14), "2026-10-29");
});

test("addDays is not moved by daylight saving (Adelaide DST starts 4 Oct 2026 and ends 4 Apr 2027)", () => {
  assert.equal(addDays("2026-10-03", 1), "2026-10-04");
  assert.equal(addDays("2026-10-04", 1), "2026-10-05");
  assert.equal(addDays("2027-04-03", 1), "2027-04-04");
  assert.equal(addDays("2027-04-04", 1), "2027-04-05");
  assert.equal(addDays("2026-10-01", 7), "2026-10-08");
});

test("addDays refuses something that is not a calendar date", () => {
  assert.throws(() => addDays("2026-02-30", 1));
  assert.throws(() => addDays("tomorrow", 1));
});

test("isCalendarDate accepts only real dates in YYYY-MM-DD", () => {
  assert.equal(isCalendarDate("2026-10-15"), true);
  assert.equal(isCalendarDate("2028-02-29"), true);
  assert.equal(isCalendarDate("2027-02-29"), false);
  assert.equal(isCalendarDate("2026-1-5"), false);
  assert.equal(isCalendarDate("2026-10-15T00:00:00Z"), false);
  assert.equal(isCalendarDate(""), false);
  assert.equal(isCalendarDate(null), false);
});

test("dueBucket: overdue, today, upcoming (next 14 days), later, none", () => {
  const today = "2026-10-15";
  assert.equal(dueBucket("2026-10-14", today), "overdue");
  assert.equal(dueBucket("2026-01-01", today), "overdue");
  assert.equal(dueBucket("2026-10-15", today), "today");
  assert.equal(dueBucket("2026-10-16", today), "upcoming");
  assert.equal(dueBucket("2026-10-29", today), "upcoming"); // today + 14 is the last upcoming day
  assert.equal(dueBucket("2026-10-30", today), "later");
  assert.equal(dueBucket(null, today), "none");
  assert.equal(dueBucket(undefined, today), "none");
  assert.equal(UPCOMING_DAYS, 14);
});

test("the same due date lands in different buckets in different timezones", () => {
  // 20:00 UTC on 14 Oct 2026 is already the morning of the 15th in Australia and still the afternoon of the 14th in Los Angeles.
  const now = new Date("2026-10-14T20:00:00Z");
  const due = "2026-10-15";
  assert.equal(todayIn(ADL, now), "2026-10-15");
  assert.equal(dueBucket(due, todayIn(ADL, now)), "today");
  assert.equal(todayIn("Australia/Perth", now), "2026-10-15");
  assert.equal(todayIn("UTC", now), "2026-10-14");
  assert.equal(dueBucket(due, todayIn("UTC", now)), "upcoming");
  assert.equal(todayIn("America/Los_Angeles", now), "2026-10-14");
  assert.equal(dueBucket(due, todayIn("America/Los_Angeles", now)), "upcoming");
});

test("month boundary: a task due on the 30th is overdue in Adelaide but due today in UTC", () => {
  // 15:00 UTC on 30 Sep is 00:30 on 1 Oct in Adelaide (UTC+9:30 until DST starts on the 4th).
  const now = new Date("2026-09-30T15:00:00Z");
  assert.equal(todayIn(ADL, now), "2026-10-01");
  assert.equal(dueBucket("2026-09-30", todayIn(ADL, now)), "overdue");
  assert.equal(todayIn("UTC", now), "2026-09-30");
  assert.equal(dueBucket("2026-09-30", todayIn("UTC", now)), "today");
});

test("year boundary: New Year's Eve evening UTC is already the new year in Adelaide", () => {
  const now = new Date("2026-12-31T14:00:00Z"); // +10:30 in summer: 00:30 on 1 Jan
  assert.equal(todayIn(ADL, now), "2027-01-01");
  assert.equal(dueBucket("2026-12-31", todayIn(ADL, now)), "overdue");
  assert.equal(dueBucket("2027-01-01", todayIn(ADL, now)), "today");
});

test("daylight saving day in Adelaide: today flips at local midnight, not at the clock change", () => {
  // 4 Oct 2026: clocks go from 02:00 +09:30 to 03:00 +10:30. Local midnight starting the 5th is 13:30 UTC on the 4th.
  assert.equal(todayIn(ADL, new Date("2026-10-03T16:29:00Z")), "2026-10-04"); // 01:59 before the change
  assert.equal(todayIn(ADL, new Date("2026-10-03T16:30:00Z")), "2026-10-04"); // 03:00 after the change
  assert.equal(todayIn(ADL, new Date("2026-10-04T13:29:00Z")), "2026-10-04"); // 23:59
  assert.equal(todayIn(ADL, new Date("2026-10-04T13:30:00Z")), "2026-10-05"); // 00:00 the next day
  // Autumn change: 4 Apr 2027 clocks go back from 03:00 +10:30 to 02:00 +09:30; midnight starting the 5th is 14:30 UTC.
  assert.equal(todayIn(ADL, new Date("2027-04-04T14:29:00Z")), "2027-04-04");
  assert.equal(todayIn(ADL, new Date("2027-04-04T14:30:00Z")), "2027-04-05");
});

test("isOverdue: only open tasks before today", () => {
  const today = "2026-10-15";
  assert.equal(isOverdue("to_do", "2026-10-14", today), true);
  assert.equal(isOverdue("in_progress", "2026-10-14", today), true);
  assert.equal(isOverdue("waiting", "2026-10-14", today), true);
  assert.equal(isOverdue("completed", "2026-10-14", today), false);
  assert.equal(isOverdue("cancelled", "2026-10-14", today), false);
  assert.equal(isOverdue("to_do", "2026-10-15", today), false);
  assert.equal(isOverdue("to_do", "2026-10-16", today), false);
  assert.equal(isOverdue("to_do", null, today), false);
});

test("isPastDate warns on a date that has passed, never on today or later", () => {
  assert.equal(isPastDate("2026-10-14", "2026-10-15"), true);
  assert.equal(isPastDate("2026-10-15", "2026-10-15"), false);
  assert.equal(isPastDate("2026-10-16", "2026-10-15"), false);
  assert.equal(isPastDate(null, "2026-10-15"), false);
  assert.equal(isPastDate("", "2026-10-15"), false);
});

test("overdueLabel", () => {
  assert.equal(overdueLabel("2026-10-14", "2026-10-15"), "1 day overdue");
  assert.equal(overdueLabel("2026-10-10", "2026-10-15"), "5 days overdue");
  assert.equal(overdueLabel("2026-10-15", "2026-10-15"), "");
  assert.equal(overdueLabel("2026-10-20", "2026-10-15"), "");
  assert.equal(overdueLabel(null, "2026-10-15"), "");
});

test("upcomingRange runs from tomorrow to today + 14, across a month and a year", () => {
  assert.deepEqual(upcomingRange("2026-10-15"), { from: "2026-10-16", to: "2026-10-29" });
  assert.deepEqual(upcomingRange("2026-10-25"), { from: "2026-10-26", to: "2026-11-08" });
  assert.deepEqual(upcomingRange("2026-12-25"), { from: "2026-12-26", to: "2027-01-08" });
  assert.deepEqual(upcomingRange("2028-02-20"), { from: "2028-02-21", to: "2028-03-05" });
});

test("completedCutoff is 30 days before now, as an instant", () => {
  assert.equal(completedCutoff(new Date("2026-10-15T00:00:00Z")), "2026-09-15T00:00:00.000Z");
  assert.equal(completedCutoff(new Date("2026-10-15T00:00:00Z"), 7), "2026-10-08T00:00:00.000Z");
});
