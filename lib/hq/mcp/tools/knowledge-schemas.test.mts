// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { KNOWLEDGE_CATEGORIES, STATUS_FILTERS, BODY_MAX } from "../../knowledge/rules.ts";
import { EDIT_OPS } from "../../knowledge/edits.ts";
import * as S from "./knowledge-schemas.ts";

test("the knowledge vocabulary matches lib/hq/knowledge", () => {
  assert.deepEqual([...S.KNOWLEDGE_CATEGORY_VALUES], [...KNOWLEDGE_CATEGORIES]);
  assert.deepEqual([...S.KNOWLEDGE_STATUS_FILTER_VALUES], [...STATUS_FILTERS]);
  assert.deepEqual([...S.KNOWLEDGE_EDIT_OP_VALUES], [...EDIT_OPS]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every knowledge tool field is described", () => {
  assert.equal(shapes.length, 12);
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

test("a change note is required for every change to a document", () => {
  const upd = z.object(S.updateKnowledgeShape);
  assert.equal(upd.safeParse({ document: "KB-0001", body: "x" }).success, false);
  assert.equal(upd.safeParse({ document: "KB-0001", body: "x", change_note: "Fixed a step" }).success, true);
  assert.equal(upd.safeParse({ document: "KB-0001", change_note: "x", edit: { op: "replace_text", old_text: "a", new_text: "b" } }).success, true);
  assert.equal(upd.safeParse({ document: "KB-0001", change_note: "x", edit: { op: "delete_everything" } }).success, false);
});

test("bodies up to the 50,000-character cap are accepted, not more", () => {
  const create = z.object(S.createKnowledgeShape);
  const ok = { title: "t", category: "general", body: "b".repeat(BODY_MAX) };
  assert.equal(create.safeParse(ok).success, true);
  assert.equal(create.safeParse({ ...ok, body: "b".repeat(BODY_MAX + 1) }).success, false);
  assert.equal(create.safeParse({ ...ok, category: "secret" }).success, false);
});

test("approving and discarding name the exact version", () => {
  assert.equal(z.object(S.approveKnowledgeShape).safeParse({ document: "KB-0001" }).success, false);
  assert.equal(z.object(S.approveKnowledgeShape).safeParse({ document: "KB-0001", version: 3 }).success, true);
  assert.equal(z.object(S.archiveKnowledgeShape).safeParse({ document: "KB-0001" }).success, false, "archiving needs a reason");
});
