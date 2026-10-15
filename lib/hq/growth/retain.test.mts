import test from "node:test";
import assert from "node:assert/strict";
import { retainedList, retainedText, retainedValues } from "./retain.ts";

test("retainedValues keeps text, collects repeats into arrays and drops bookkeeping and files", () => {
  const f = new FormData();
  f.append("full_name", "Alex Sample");
  f.append("categories", "lawyer");
  f.append("categories", "conveyancer");
  f.append("$ACTION_ID_abc", "x");
  f.append("attachment", new Blob(["hello"]), "a.txt");
  const v = retainedValues(f);
  assert.deepEqual(v, { full_name: "Alex Sample", categories: ["lawyer", "conveyancer"] });
  assert.equal(retainedText(v, "full_name"), "Alex Sample");
  assert.equal(retainedText(v, "missing", "x"), "x");
  assert.deepEqual(retainedList(v, "categories"), ["lawyer", "conveyancer"]);
  assert.deepEqual(retainedList(v, "full_name"), ["Alex Sample"]);
  assert.deepEqual(retainedList(undefined, "categories", ["a"]), ["a"]);
});

test("retainedValues bounds a very long value", () => {
  const f = new FormData();
  f.append("notes", "x".repeat(20000));
  assert.equal((retainedValues(f).notes as string).length, 5000);
});
