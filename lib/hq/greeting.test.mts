// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { greetingFor, hourIn, longDateIn, shortDay, welcomeTitle } from "./greeting.ts";

// 22:30 UTC on 14 Oct 2026. Adelaide is UTC+10:30 in October (daylight saving), so it is 09:00 on 15 Oct there.
const MORNING_IN_ADELAIDE = new Date("2026-10-14T22:30:00Z");

test("the greeting follows the person's timezone, not the server's", () => {
  assert.equal(greetingFor("Australia/Adelaide", MORNING_IN_ADELAIDE), "Good morning");
  // The same instant is 15:30 in Los Angeles (PDT, UTC-7) and 23:30 in London (BST, UTC+1).
  assert.equal(greetingFor("America/Los_Angeles", MORNING_IN_ADELAIDE), "Good afternoon"); // 15:30
  assert.equal(greetingFor("Europe/London", MORNING_IN_ADELAIDE), "Good evening"); // 23:30
});

test("morning, afternoon and evening boundaries (Adelaide local time)", () => {
  // Adelaide is UTC+10:30 on 15 Oct, so local 11:59 is 01:29Z.
  assert.equal(greetingFor("Australia/Adelaide", new Date("2026-10-15T01:29:00Z")), "Good morning");
  assert.equal(greetingFor("Australia/Adelaide", new Date("2026-10-15T01:30:00Z")), "Good afternoon"); // 12:00
  assert.equal(greetingFor("Australia/Adelaide", new Date("2026-10-15T06:29:00Z")), "Good afternoon"); // 16:59
  assert.equal(greetingFor("Australia/Adelaide", new Date("2026-10-15T06:30:00Z")), "Good evening"); // 17:00
  assert.equal(greetingFor("Australia/Adelaide", new Date("2026-10-14T13:30:00Z")), "Good morning"); // 00:00 local
});

test("midnight reads as hour 0, never 24", () => {
  assert.equal(hourIn("Australia/Adelaide", new Date("2026-10-14T13:30:00Z")), 0);
});

test("an unknown timezone falls back instead of throwing", () => {
  assert.doesNotThrow(() => greetingFor("Not/AZone", MORNING_IN_ADELAIDE));
  assert.equal(greetingFor("Not/AZone", MORNING_IN_ADELAIDE), "Good morning"); // Adelaide's 09:00
});

test("welcomeTitle ends with a full stop and handles a missing name", () => {
  assert.equal(welcomeTitle("Shannon", "Australia/Adelaide", MORNING_IN_ADELAIDE), "Good morning, Shannon.");
  assert.equal(welcomeTitle("  ", "Australia/Adelaide", MORNING_IN_ADELAIDE), "Good morning.");
});

test("longDateIn is the date in the person's timezone", () => {
  assert.equal(longDateIn("Australia/Adelaide", MORNING_IN_ADELAIDE), "Thursday 15 October");
  assert.equal(longDateIn("America/Los_Angeles", MORNING_IN_ADELAIDE), "Wednesday 14 October");
});

test("shortDay formats a bare date without moving it", () => {
  assert.equal(shortDay("2026-10-23"), "Fri 23 Oct");
  assert.equal(shortDay("2026-01-01"), "Thu 1 Jan");
  assert.equal(shortDay("2026-10-23T00:00:00+00:00"), "Fri 23 Oct");
  assert.equal(shortDay(null), "");
  assert.equal(shortDay("not a date"), "");
});
