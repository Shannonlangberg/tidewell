import test from "node:test";
import assert from "node:assert/strict";
import { OPEN_TASK_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL } from "../constants.ts";
import { daysFromToday } from "../format.ts";
import { intParam, isUuid as formsIsUuid, strParam } from "../forms.ts";
import { PRIORITY_WORDS, STATUS_WORDS } from "./activity.ts";
import {
  PRIORITIES_DESC,
  TASK_VIEWS,
  allowedTransitions,
  dueBucket,
  isOpenStatus,
  isUuid,
  parseTaskListQuery,
} from "./rules.ts";

/*
 * rules.ts and activity.ts cannot import their neighbours (see the note at the top of
 * rules.ts), so a few tiny things are written out in them. These tests pin each copy to its
 * original, so a change to the original that is not made here fails the build.
 */

test("the status lists in rules.ts are the ones in constants.ts", () => {
  // Team, All and Delegated offer every status as a choice; the open views offer the open ones.
  assert.deepEqual([...TASK_VIEWS.all.statuses], [...TASK_STATUSES]);
  assert.deepEqual([...TASK_VIEWS.all.statusChoices], [...TASK_STATUSES]);
  assert.deepEqual([...TASK_VIEWS.mine.statuses], [...OPEN_TASK_STATUSES]);
  assert.deepEqual([...TASK_VIEWS.mine.statusChoices], [...OPEN_TASK_STATUSES]);
  for (const s of TASK_STATUSES) {
    assert.equal(isOpenStatus(s), (OPEN_TASK_STATUSES as readonly string[]).includes(s), s);
    assert.ok(allowedTransitions(s), `a transition list for ${s}`);
  }
});

test("the priority list in rules.ts is the enum order in constants.ts", () => {
  assert.deepEqual([...PRIORITIES_DESC].reverse(), [...TASK_PRIORITIES]);
});

test("isUuid agrees with forms.ts isUuid", () => {
  const samples = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaaa",
    "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz",
    "",
    " aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    null,
    undefined,
    42,
  ];
  for (const s of samples) assert.equal(isUuid(s), formsIsUuid(s), String(s));
});

test("the day count agrees with format.ts daysFromToday (through the due buckets)", () => {
  const today = "2026-10-15";
  for (const d of ["2026-10-10", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-29", "2026-10-30", "2027-01-01", null, "", "garbage"]) {
    const n = daysFromToday(d, today);
    const expected = n === null ? "none" : n < 0 ? "overdue" : n === 0 ? "today" : n <= 14 ? "upcoming" : "later";
    assert.equal(dueBucket(d, today), expected, String(d));
  }
});

test("the URL helpers behave like forms.ts strParam and intParam", () => {
  for (const v of ["  hello  ", "x".repeat(300), ["a", "b"], undefined, ""]) {
    const expected = strParam(v as string | string[] | undefined, 100).replace(/\s+/g, " ");
    assert.equal(parseTaskListQuery({ q: v as string | string[] | undefined }, { canReadAll: true }).q, expected);
  }
  for (const v of ["1", "7", "0", "-3", "abc", "99999999", undefined, ["4", "5"]]) {
    assert.equal(parseTaskListQuery({ page: v as string | string[] | undefined }, { canReadAll: true }).page, intParam(v as string | string[] | undefined, 1, 1, 10_000));
  }
});

test("the words in activity.ts are the labels in constants.ts", () => {
  assert.deepEqual(STATUS_WORDS, TASK_STATUS_LABEL);
  assert.deepEqual(PRIORITY_WORDS, TASK_PRIORITY_LABEL);
});
