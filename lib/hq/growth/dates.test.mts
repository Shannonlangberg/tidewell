import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  agoLabel,
  checkFollowUpDate,
  checkOccurredAt,
  contactRecency,
  daysAgo,
  daysBetween,
  followUpState,
  isCalendarDate,
  lastContactedLabel,
  nowLocalInput,
  overdueLabel,
  taskNeedsDate,
  todayInZone,
  zonedLocalToDate,
} from "./dates.ts";

const ADL = "Australia/Adelaide";

test("todayInZone and nowLocalInput use the person's time zone, not the server's", () => {
  // 2026-10-14 15:00 UTC is 01:30 on the 15th in Adelaide (UTC+10:30 in October).
  const now = new Date("2026-10-14T15:00:00Z");
  assert.equal(todayInZone(ADL, now), "2026-10-15");
  assert.equal(todayInZone("UTC", now), "2026-10-14");
  assert.equal(nowLocalInput(ADL, now), "2026-10-15T01:30");
  assert.equal(nowLocalInput("America/New_York", now), "2026-10-14T11:00");
});

test("zonedLocalToDate converts local wall-clock time to the right instant", () => {
  // Summer time in Adelaide (from the first Sunday of October): UTC+10:30.
  assert.equal(zonedLocalToDate("2026-10-15T09:40", ADL)?.toISOString(), "2026-10-14T23:10:00.000Z");
  // Winter time: UTC+9:30.
  assert.equal(zonedLocalToDate("2026-07-15T09:40", ADL)?.toISOString(), "2026-07-15T00:10:00.000Z");
  assert.equal(zonedLocalToDate("2026-07-15T09:40", "UTC")?.toISOString(), "2026-07-15T09:40:00.000Z");
});

test("zonedLocalToDate round-trips through nowLocalInput across the daylight-saving change", () => {
  // Clocks go forward at 2:00 am on Sunday 4 October 2026 and back at 3:00 am on Sunday 5 April 2026.
  for (const local of ["2026-10-03T23:59", "2026-10-04T03:00", "2026-04-05T01:59", "2026-04-05T03:30", "2026-12-31T23:59", "2026-01-01T00:00"]) {
    const d = zonedLocalToDate(local, ADL);
    assert.ok(d, local);
    assert.equal(nowLocalInput(ADL, d), local);
  }
});

test("zonedLocalToDate rejects things that are not a date and time", () => {
  for (const bad of ["", "2026-10-15", "2026-10-15 09:40", "2026-02-31T10:00", "2026-10-15T25:00", "2026-13-01T10:00", "tomorrow"]) {
    assert.equal(zonedLocalToDate(bad, ADL), null, bad);
  }
});

test("calendar date arithmetic", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-2-9"), false);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-15", "2026-10-20"), 5);
  assert.equal(daysBetween("2026-10-20", "2026-10-15"), -5);
});

test("follow-up date: optional, real, today or later, within two years", () => {
  const today = "2026-10-15";
  assert.deepEqual(checkFollowUpDate("", today), { ok: true, value: null });
  assert.deepEqual(checkFollowUpDate(null, today), { ok: true, value: null });
  assert.deepEqual(checkFollowUpDate("2026-10-15", today), { ok: true, value: "2026-10-15" });
  assert.deepEqual(checkFollowUpDate("2026-10-20", today), { ok: true, value: "2026-10-20" });
  assert.deepEqual(checkFollowUpDate("2026-10-14", today), { ok: false, message: "The follow-up date can't be in the past." });
  assert.deepEqual(checkFollowUpDate("2026-02-30", today), { ok: false, message: "Enter a valid date." });
  assert.deepEqual(checkFollowUpDate("soon", today), { ok: false, message: "Enter a valid date." });
  assert.equal(checkFollowUpDate(addDays(today, 730), today).ok, true);
  assert.equal(checkFollowUpDate(addDays(today, 731), today).ok, false);
});

test("a follow-up task needs a follow-up date", () => {
  assert.equal(taskNeedsDate(true, null), true);
  assert.equal(taskNeedsDate(true, "2026-10-20"), false);
  assert.equal(taskNeedsDate(false, null), false);
});

test("an interaction may be back-dated but never future-dated", () => {
  const now = new Date("2026-10-15T01:00:00Z");
  assert.deepEqual(checkOccurredAt(new Date("2026-10-14T01:00:00Z"), now), { ok: true });
  assert.deepEqual(checkOccurredAt(new Date("2026-10-15T01:00:30Z"), now), { ok: true }); // clock drift
  assert.equal(checkOccurredAt(new Date("2026-10-15T01:05:00Z"), now).ok, false);
  assert.equal(checkOccurredAt(new Date("1999-12-31T00:00:00Z"), now).ok, false);
  assert.equal(checkOccurredAt(null, now).ok, false);
});

test("follow-up state and wording", () => {
  const today = "2026-10-15";
  assert.deepEqual(followUpState(null, today), { kind: "none" });
  assert.deepEqual(followUpState("", today), { kind: "none" });
  assert.deepEqual(followUpState("2026-10-12", today), { kind: "overdue", days: 3 });
  assert.deepEqual(followUpState("2026-10-15", today), { kind: "today" });
  assert.deepEqual(followUpState("2026-10-20", today), { kind: "upcoming", days: 5 });
  assert.equal(overdueLabel(1), "1 day overdue");
  assert.equal(overdueLabel(3), "3 days overdue");
});

test("agoLabel counts calendar days in the person's time zone", () => {
  const now = new Date("2026-10-15T02:00:00Z"); // 12:30 pm on 15 Oct in Adelaide
  assert.equal(agoLabel(null, ADL, now), null);
  assert.equal(agoLabel("not a date", ADL, now), null);
  assert.equal(agoLabel("2026-10-15T00:05:00Z", ADL, now), "Today");
  // 23:00 UTC on the 13th is 9:30 am on the 14th in Adelaide: yesterday.
  assert.equal(agoLabel("2026-10-13T23:00:00Z", ADL, now), "Yesterday");
  assert.equal(agoLabel("2026-10-10T02:00:00Z", ADL, now), "5 days ago");
  assert.equal(agoLabel("2026-09-24T02:00:00Z", ADL, now), "3 weeks ago");
  assert.equal(agoLabel("2026-06-15T02:00:00Z", ADL, now), "4 months ago");
  assert.equal(agoLabel("2024-10-14T02:00:00Z", ADL, now), "2 years ago");
  assert.equal(daysAgo("2026-10-10T02:00:00Z", ADL, now), 5);
  assert.equal(daysAgo(null, ADL, now), null);
});

import { formatDay } from "./dates.ts";

test("formatDay shows weekday, day and month, and the year only when it is not this year", () => {
  assert.equal(formatDay("2026-10-20", "2026-10-15"), "Tue 20 Oct");
  assert.equal(formatDay("2027-01-04", "2026-10-15"), "Mon 4 Jan 2027");
  assert.equal(formatDay("2026-10-20T00:00:00Z", "2026-10-15"), "Tue 20 Oct");
  assert.equal(formatDay(null, "2026-10-15"), "");
  assert.equal(formatDay("soon", "2026-10-15"), "");
});

test("lastContactedLabel: Never for no contact, then the agoLabel steps", () => {
  assert.equal(lastContactedLabel(null), "Never");
  assert.equal(lastContactedLabel(undefined), "Never");
  assert.equal(lastContactedLabel(Number.NaN), "Never");
  assert.equal(lastContactedLabel(0), "Today");
  assert.equal(lastContactedLabel(-2), "Today", "a clock a little ahead never reads as the future");
  assert.equal(lastContactedLabel(1), "Yesterday");
  assert.equal(lastContactedLabel(3), "3 days ago");
  assert.equal(lastContactedLabel(13), "13 days ago");
  assert.equal(lastContactedLabel(14), "2 weeks ago");
  assert.equal(lastContactedLabel(59), "8 weeks ago");
  assert.equal(lastContactedLabel(60), "2 months ago");
  assert.equal(lastContactedLabel(364), "12 months ago");
  assert.equal(lastContactedLabel(365), "1 year ago");
  assert.equal(lastContactedLabel(800), "2 years ago");
});

test("contactRecency: never, quiet after 30 days, otherwise recent", () => {
  assert.equal(contactRecency(null), "never");
  assert.equal(contactRecency(0), "recent");
  assert.equal(contactRecency(30), "recent", "30 days is still within the month");
  assert.equal(contactRecency(31), "quiet");
  assert.equal(contactRecency(10, 7), "quiet", "the threshold can be changed");
});
