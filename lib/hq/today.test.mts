// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, expiryText, isPropertyManagerRole, lastSpokeText, overdueText, phoneHref, todayFigures, todayPlan } from "./today.ts";

// The live capability matrix (hq.role_capabilities), for the roles the tests use.
const CAPS = {
  director: ["contractors.read", "contractors.write", "growth.read", "growth.write", "tasks.read_all", "tasks.write", "people.read"],
  business_development_manager: ["contractors.read", "growth.read", "growth.write", "import.run", "people.read", "tasks.read_all", "tasks.write"],
  property_manager: ["contractors.read", "contractors.write", "growth.read", "people.read", "tasks.write"],
  junior_property_manager: ["contractors.read", "people.read", "tasks.write"],
  virtual_assistant: ["contractors.read", "contractors.write", "growth.read", "growth.write", "people.read", "tasks.write"],
  read_only: ["contractors.read", "growth.read", "people.read", "tasks.read_all"],
} as const;

test("a director sees both views, growth first", () => {
  const p = todayPlan("director", CAPS.director);
  assert.deepEqual(p.views, ["growth", "operations"]);
  assert.equal(p.canLogCalls, true);
  assert.equal(p.canCompleteTasks, true);
});

test("a property manager sees operations first", () => {
  assert.deepEqual(todayPlan("property_manager", CAPS.property_manager).views, ["operations", "growth"]);
  assert.equal(todayPlan("property_manager", CAPS.property_manager).canLogCalls, false);
});

test("a junior property manager has no growth view at all", () => {
  const p = todayPlan("junior_property_manager", CAPS.junior_property_manager);
  assert.deepEqual(p.views, ["operations"]);
  assert.equal(p.growth, false);
  assert.equal(p.contractors, true);
});

test("read only sees both views and can change nothing", () => {
  const p = todayPlan("read_only", CAPS.read_only);
  assert.deepEqual(p.views, ["growth", "operations"]);
  assert.equal(p.canLogCalls, false);
  assert.equal(p.canCompleteTasks, false);
  assert.equal(p.seesTeamTasks, true);
});

test("a person with nothing gets no views", () => {
  assert.deepEqual(todayPlan("virtual_assistant", ["people.read"]).views, []);
});

test("property manager roles", () => {
  assert.equal(isPropertyManagerRole("senior_property_manager"), true);
  assert.equal(isPropertyManagerRole("business_development_manager"), false);
});

test("day arithmetic and phrases", () => {
  assert.equal(daysUntil("2026-10-13", "2026-10-16"), -3);
  assert.equal(overdueText("2026-10-13", "2026-10-16"), "3 days overdue");
  assert.equal(overdueText("2026-10-15", "2026-10-16"), "1 day overdue");
  assert.equal(overdueText("2026-10-16", "2026-10-16"), null);
  assert.equal(lastSpokeText(null), null);
  assert.equal(lastSpokeText(0), "Last spoke today");
  assert.equal(lastSpokeText(45), "Last spoke 45 days ago");
  assert.equal(lastSpokeText(120), "Last spoke 3 months ago");
  assert.equal(expiryText("2026-10-10", "2026-10-16"), "Expired 6 days ago");
  assert.equal(expiryText("2026-10-16", "2026-10-16"), "Expires today");
  assert.equal(expiryText("2026-10-28", "2026-10-16"), "Expires in 12 days");
});

test("figures leave out zeros and stop at four", () => {
  assert.deepEqual(todayFigures({ call: 0, tasksOverdue: null }), []);
  const f = todayFigures({ call: 3, tasksOverdue: 1, tasksToday: 2, expiring: 1, referrals: 4 });
  assert.equal(f.length, 4);
  assert.equal(f[0].text, "3 follow-ups due");
  assert.equal(f[1].text, "1 task overdue");
});

test("phone links only for usable numbers", () => {
  assert.equal(phoneHref("0400 123 456", "tel"), "tel:0400123456");
  assert.equal(phoneHref("+61 8 8821 0000", "sms"), "sms:+61888210000");
  assert.equal(phoneHref("n/a", "tel"), null);
  assert.equal(phoneHref(null, "tel"), null);
});
