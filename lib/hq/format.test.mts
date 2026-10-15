// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  daysFromToday,
  daysSince,
  formatAud,
  formatDate,
  formatDateTime,
  initials,
  plural,
  refNumber,
  relativeDay,
  todayIn,
} from "./format.ts";

test("todayIn uses the requested timezone, not the machine's", () => {
  // 14:00 UTC on 14 Oct is already the early hours of 15 Oct in Adelaide (UTC+10:30 in October).
  const instant = new Date("2026-10-14T14:00:00Z");
  assert.equal(todayIn("Australia/Adelaide", instant), "2026-10-15");
  assert.equal(todayIn("UTC", instant), "2026-10-14");
});

test("formatDate shows a bare calendar date as written in any timezone", () => {
  assert.equal(formatDate("2026-10-15", "Australia/Adelaide"), "15 Oct 2026");
  assert.equal(formatDate("2026-10-15", "Pacific/Auckland"), "15 Oct 2026");
  assert.equal(formatDate("2026-10-15", "America/Los_Angeles"), "15 Oct 2026");
});

test("formatDate converts a timestamp into the requested timezone", () => {
  assert.equal(formatDate("2026-10-14T14:00:00Z", "Australia/Adelaide"), "15 Oct 2026");
  assert.equal(formatDate("2026-10-14T14:00:00Z", "UTC"), "14 Oct 2026");
});

test("formatDate tolerates empty and invalid input", () => {
  assert.equal(formatDate(null), "");
  assert.equal(formatDate(undefined), "");
  assert.equal(formatDate("not a date"), "");
});

test("formatDateTime reads naturally", () => {
  assert.equal(formatDateTime("2026-10-15T04:30:00Z", "Australia/Adelaide"), "Thu 15 Oct, 3:00 pm");
});

test("daysFromToday counts calendar days and signs them", () => {
  assert.equal(daysFromToday("2026-10-15", "2026-10-15"), 0);
  assert.equal(daysFromToday("2026-10-18", "2026-10-15"), 3);
  assert.equal(daysFromToday("2026-10-10", "2026-10-15"), -5);
  assert.equal(daysFromToday(null, "2026-10-15"), null);
});

test("daysFromToday is unaffected by month and daylight-saving boundaries", () => {
  assert.equal(daysFromToday("2026-11-01", "2026-10-31"), 1);
  assert.equal(daysFromToday("2027-04-06", "2027-04-04"), 2);
});

test("relativeDay words", () => {
  const today = "2026-10-15";
  assert.equal(relativeDay("2026-10-15", today), "Today");
  assert.equal(relativeDay("2026-10-16", today), "Tomorrow");
  assert.equal(relativeDay("2026-10-14", today), "Yesterday");
  assert.equal(relativeDay("2026-10-19", today), "in 4 days");
  assert.equal(relativeDay("2026-10-10", today), "5 days overdue");
  assert.equal(relativeDay(null, today), "");
});

test("daysSince counts whole calendar days in the given timezone", () => {
  const now = new Date("2026-10-15T01:00:00Z"); // 11:30 am in Adelaide on the 15th
  assert.equal(daysSince("2026-10-15T00:30:00Z", "Australia/Adelaide", now), 0);
  assert.equal(daysSince("2026-10-12T05:00:00Z", "Australia/Adelaide", now), 3);
  assert.equal(daysSince(null, "Australia/Adelaide", now), null);
});

test("formatAud shows whole dollars from cents", () => {
  assert.equal(formatAud(1250000), "$12,500");
  assert.equal(formatAud("46000"), "$460");
  assert.equal(formatAud(null), "");
  assert.equal(formatAud("x"), "");
});

test("refNumber pads", () => {
  assert.equal(refNumber(7), "REF-0007");
  assert.equal(refNumber(12345), "REF-12345");
  assert.equal(refNumber(null), "");
  assert.equal(refNumber(3, "OPP"), "OPP-0003");
});

test("initials and plural", () => {
  assert.equal(initials("Shannon Langberg"), "SL");
  assert.equal(initials("  Courtney  "), "C");
  assert.equal(initials(""), "");
  assert.equal(plural(1, "contact"), "1 contact");
  assert.equal(plural(3, "contact"), "3 contacts");
  assert.equal(plural(2, "company", "companies"), "2 companies");
});
