import test from "node:test";
import assert from "node:assert/strict";
import { classifyDbError, logTag } from "./db-errors.ts";
import { retainedValues } from "./retain.ts";

test("classifyDbError maps codes to kinds", () => {
  assert.equal(classifyDbError({ code: "42501" }), "permission");
  assert.equal(classifyDbError({ code: "P0002" }), "not_found");
  assert.equal(classifyDbError({ code: "PGRST116" }), "not_found");
  assert.equal(classifyDbError({ code: "23503" }), "foreign_key");
  for (const code of ["22023", "22P02", "23514", "23502"]) assert.equal(classifyDbError({ code }), "invalid", code);
  assert.equal(classifyDbError({ code: "PGRST103" }), "range");
  assert.equal(classifyDbError({ code: "XX000" }), "other");
  assert.equal(classifyDbError(null), "other");
  assert.equal(classifyDbError(undefined), "other");
});

test("logTag logs the code (and a task constraint name) but never the message body", () => {
  assert.equal(logTag({ code: "42501", message: 'new row violates row-level security policy for table "tasks" Title: Sam Sample' }), "42501");
  assert.equal(logTag({ code: "23514", message: 'new row for relation "tasks" violates check constraint "tasks_title_not_blank"' }), "23514 tasks_title_not_blank");
  assert.equal(logTag(null), "unknown");
  assert.ok(!logTag({ code: "23505", message: "duplicate key value (jane@example.com)" }).includes("jane"));
});

test("retainedValues echoes text fields, never files or Next's bookkeeping fields", () => {
  const f = new FormData();
  f.set("title", "Call Sam");
  f.set("$ACTION_ID_abc", "1");
  f.set("$ACTION_REF_1", "x");
  f.set("file", new File(["secret"], "x.txt"));
  f.set("description", "d".repeat(6000));
  const out = retainedValues(f);
  assert.equal(out.title, "Call Sam");
  assert.equal("$ACTION_ID_abc" in out, false);
  assert.equal("$ACTION_REF_1" in out, false);
  assert.equal("file" in out, false);
  assert.equal(out.description.length, 5000);
});
