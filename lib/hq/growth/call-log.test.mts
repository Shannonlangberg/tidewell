import test from "node:test";
import assert from "node:assert/strict";
import { planCallLog, type CallLogInput } from "./call-log.ts";

const TODAY = "2026-10-22";
const base: CallLogInput = { target: "contact", outcome: "spoke", summary: "Keen to meet", choice: "three_days", date: null, reason: null, callbackPromised: false, today: TODAY };

test("a call needs an outcome and a follow-up choice", () => {
  const r = planCallLog({ ...base, outcome: null, choice: null });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ["follow_up", "outcome"]);
});

test("the quick choices count from today", () => {
  for (const [choice, date] of [["tomorrow", "2026-10-23"], ["three_days", "2026-10-25"], ["next_week", "2026-10-29"]] as const) {
    const r = planCallLog({ ...base, choice });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.followUp, date);
  }
});

test("a picked date must be today or later, within two years", () => {
  assert.equal(planCallLog({ ...base, choice: "date", date: null }).ok, false);
  assert.equal(planCallLog({ ...base, choice: "date", date: "2026-10-21" }).ok, false);
  assert.equal(planCallLog({ ...base, choice: "date", date: "2029-01-01" }).ok, false);
  const r = planCallLog({ ...base, choice: "date", date: TODAY });
  assert.ok(r.ok && r.followUp === TODAY);
});

test("no further follow-up needs a reason, clears the follow-up and says so", () => {
  assert.equal(planCallLog({ ...base, choice: "none" }).ok, false);
  const r = planCallLog({ ...base, choice: "none", reason: "Retiring this year" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.clearFollowUp, true);
    assert.equal(r.followUp, null);
    assert.equal(r.summary, "Keen to meet No further follow-up: Retiring this year");
  }
});

test("an open lead cannot end with no follow-up", () => {
  const r = planCallLog({ ...base, target: "lead", choice: "none", reason: "x" });
  assert.equal(r.ok, false);
});

test("spoke needs what was said; other outcomes write their own line", () => {
  assert.equal(planCallLog({ ...base, summary: " " }).ok, false);
  const r = planCallLog({ ...base, outcome: "no_answer", summary: null });
  assert.ok(r.ok && r.summary === "No answer.");
  const v = planCallLog({ ...base, outcome: "left_message", summary: "Asked them to ring back" });
  assert.ok(v.ok && v.summary === "Left a message. Asked them to ring back");
});

test("a promised callback keeps its date, and needs one", () => {
  const r = planCallLog({ ...base, callbackPromised: true, choice: "tomorrow" });
  assert.ok(r.ok && r.callbackPromised && r.followUp === "2026-10-23");
  const bad = planCallLog({ ...base, callbackPromised: true, choice: "none", reason: "done" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.callback_promised);
});
