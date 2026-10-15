import test from "node:test";
import assert from "node:assert/strict";
import { TASK_PRIORITIES } from "../constants.ts";
import { PRIORITIES_DESC, PRIORITY_RANK, comparePriorityDesc, priorityRank } from "./rules.ts";

test("ranks follow the enum's declared order: low < normal < high < urgent", () => {
  // Postgres sorts an enum by declaration order, so this list IS the database's sort order.
  assert.deepEqual([...TASK_PRIORITIES], ["low", "normal", "high", "urgent"]);
  const ranks = TASK_PRIORITIES.map((p) => PRIORITY_RANK[p]);
  assert.deepEqual(ranks, [0, 1, 2, 3]);
});

test("most pressing first: urgent, high, normal, low (not alphabetical)", () => {
  const shuffled = ["low", "urgent", "normal", "high", "normal", "urgent"];
  assert.deepEqual([...shuffled].sort(comparePriorityDesc), ["urgent", "urgent", "high", "normal", "normal", "low"]);
  // Alphabetical would be a different order entirely.
  assert.notDeepEqual([...shuffled].sort(comparePriorityDesc), [...shuffled].sort());
  assert.deepEqual([...PRIORITIES_DESC], ["urgent", "high", "normal", "low"]);
});

test("an unknown priority ranks below every real one", () => {
  assert.equal(priorityRank("whenever"), -1);
  assert.equal(priorityRank(null), -1);
  assert.equal(priorityRank(undefined), -1);
  assert.deepEqual(["whenever", "low"].sort(comparePriorityDesc), ["low", "whenever"]);
});
