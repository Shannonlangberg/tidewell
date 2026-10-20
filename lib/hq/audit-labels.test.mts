// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ACTION_LABEL, ENTITY_LABEL, actionLabel, entityLabel } from "./audit-labels.ts";

// Every migration, read as text: the labels must cover whatever the database can write.
const dir = new URL("../../supabase/migrations/", import.meta.url);
const sql = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(new URL(f, dir), "utf8"))
  .join("\n");

const all = (re: RegExp, group = 1) => [...sql.matchAll(re)].map((m) => m[group]);

const ENTITIES = new Set([...all(/audit_row\('([a-z_]+)'\)/g), ...all(/audit_write\(\s*'[a-z_]+',\s*'([a-z_]+)'/g)]);

const ACTIONS = new Set([
  ...all(/audit_write\(\s*'([a-z_]+)'/g),
  ...all(/audit_context\('([a-z_]+)'/g),
  // audit_context(case ... then 'x' ... end, ...)
  ...all(/audit_context\(case([^;]*?)end/g).flatMap((body) => [...body.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1])),
  // the trigger's own actions: the `v_action := case ... end;` block of every audit_row() version
  ...all(/v_action := case([\s\S]*?)end;/g).flatMap((body) => [...body.matchAll(/then '([a-z_]+)'/g)].map((m) => m[1])),
]);
ACTIONS.delete("skip"); // an instruction to write nothing, never stored

test("the migrations were found and parsed", () => {
  assert.ok(ENTITIES.has("contact") && ENTITIES.has("ai_request") && ENTITIES.has("trade"), [...ENTITIES].join(","));
  assert.ok(ACTIONS.has("create") && ACTIONS.has("status_change") && ACTIONS.has("ai_finish") && ACTIONS.has("prefer"), [...ACTIONS].join(","));
});

test("every entity type the database writes has a label", () => {
  const missing = [...ENTITIES].filter((e) => !Object.hasOwn(ENTITY_LABEL, e));
  assert.deepEqual(missing, []);
});

test("every action the database writes has a label", () => {
  const missing = [...ACTIONS].filter((a) => !Object.hasOwn(ACTION_LABEL, a));
  assert.deepEqual(missing, []);
});

test("labels read as plain words", () => {
  assert.equal(entityLabel("contractor_document"), "Contractor document");
  assert.equal(entityLabel("ai_request"), "Connected app call");
  assert.equal(actionLabel("stage_change"), "Stage changed");
  assert.equal(actionLabel("ai_begin"), "Call started");
  for (const label of [...Object.values(ENTITY_LABEL), ...Object.values(ACTION_LABEL)]) assert.doesNotMatch(label, /_/);
});

test("an unknown value is made readable, never shown raw, and inherited keys are not labels", () => {
  assert.equal(entityLabel("new_kind_of_thing"), "New kind of thing");
  assert.equal(actionLabel("do_something"), "Do something");
  assert.equal(entityLabel("constructor"), "Constructor");
  assert.equal(actionLabel(""), "Unknown");
});
