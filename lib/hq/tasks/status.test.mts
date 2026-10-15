import test from "node:test";
import assert from "node:assert/strict";
import { TASK_STATUSES } from "../constants.ts";
import { REOPEN_STATUS, allowedTransitions, canTransition, isClosed, isOpen, isTaskStatus, quickToggleTarget } from "./rules.ts";

test("open statuses move among themselves and can be completed or cancelled", () => {
  for (const from of ["to_do", "in_progress", "waiting"] as const) {
    assert.equal(canTransition(from, "completed"), true, `${from} -> completed`);
    assert.equal(canTransition(from, "cancelled"), true, `${from} -> cancelled`);
    assert.equal(canTransition(from, from), false, `${from} -> ${from}`);
  }
  assert.equal(canTransition("to_do", "waiting"), true);
  assert.equal(canTransition("waiting", "in_progress"), true);
});

test("a closed task can only be reopened, never moved straight to another closed state", () => {
  assert.deepEqual([...allowedTransitions("completed")], ["to_do", "in_progress"]);
  assert.deepEqual([...allowedTransitions("cancelled")], ["to_do"]);
  assert.equal(canTransition("completed", "cancelled"), false);
  assert.equal(canTransition("cancelled", "completed"), false);
  assert.equal(canTransition("completed", "waiting"), false);
});

test("every status has an entry and every target is a real status", () => {
  for (const from of TASK_STATUSES) {
    for (const to of allowedTransitions(from)) assert.ok(isTaskStatus(to));
  }
});

test("open and closed partition the statuses", () => {
  for (const s of TASK_STATUSES) assert.equal(isOpen(s), !isClosed(s));
  assert.equal(isOpen("waiting"), true);
  assert.equal(isClosed("completed"), true);
  assert.equal(isClosed("cancelled"), true);
});

test("the quick tick completes an open task and reopens a closed one", () => {
  assert.equal(quickToggleTarget("to_do"), "completed");
  assert.equal(quickToggleTarget("in_progress"), "completed");
  assert.equal(quickToggleTarget("waiting"), "completed");
  assert.equal(quickToggleTarget("completed"), REOPEN_STATUS);
  assert.equal(quickToggleTarget("cancelled"), REOPEN_STATUS);
  assert.equal(REOPEN_STATUS, "to_do");
});

test("isTaskStatus", () => {
  assert.equal(isTaskStatus("to_do"), true);
  assert.equal(isTaskStatus("done"), false);
  assert.equal(isTaskStatus(null), false);
});
