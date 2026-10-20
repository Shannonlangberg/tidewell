import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormReader } from "../forms.ts";
import { CAPABILITIES } from "../constants.ts";
import {
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABEL,
  VERSION_STATUSES,
  addDays,
  excerpt,
  knowledgeRef,
  normaliseBody,
  parseKnowledgeListQuery,
  parseKnowledgeRef,
  readKnowledgeFields,
  reviewDateProblem,
  reviewState,
  statusLabel,
  versionLabel,
} from "./rules.ts";

/* The knowledge rules mirror migration 0138; the vocabulary is pinned to the migration's own text. */

const MIGRATION = readFileSync(new URL("../../../supabase/migrations/0138_hq_knowledge.sql", import.meta.url), "utf8");
const enumLabels = (name: string) => {
  const m = new RegExp(`create type hq\\.${name} as enum \\(([^;]+)\\);`).exec(MIGRATION);
  assert.ok(m, name);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

test("the categories and version statuses match the migration", () => {
  assert.deepEqual([...KNOWLEDGE_CATEGORIES], enumLabels("knowledge_category"));
  assert.deepEqual([...VERSION_STATUSES], enumLabels("knowledge_version_status"));
  for (const c of KNOWLEDGE_CATEGORIES) assert.ok(KNOWLEDGE_CATEGORY_LABEL[c]);
  assert.equal(KNOWLEDGE_CATEGORY_LABEL.brand_voice, "Brand, voice and vision");
});

test("the three capabilities are in the vocabulary", () => {
  for (const c of ["knowledge.read", "knowledge.write", "knowledge.approve"]) assert.ok((CAPABILITIES as readonly string[]).includes(c), c);
});

test("refs", () => {
  assert.equal(knowledgeRef(7), "KB-0007");
  assert.equal(knowledgeRef(123456), "KB-123456");
  assert.equal(parseKnowledgeRef("KB-0007"), 7);
  assert.equal(parseKnowledgeRef(" kb 12 "), 12);
  assert.equal(parseKnowledgeRef("KB0"), null);
  assert.equal(parseKnowledgeRef("plumber vetting"), null);
});

test("status words", () => {
  assert.equal(statusLabel({ approvedVersion: null, currentVersion: 1 }), "Draft");
  assert.equal(statusLabel({ approvedVersion: 2, currentVersion: 2 }), "Approved");
  assert.equal(statusLabel({ approvedVersion: 2, currentVersion: 3 }), "Approved, newer draft waiting");
  assert.equal(statusLabel({ approvedVersion: 2, currentVersion: 2, archived: true }), "Archived");
  assert.equal(versionLabel("superseded", true), "Previously approved");
  assert.equal(versionLabel("superseded", false), "Replaced by a later draft");
});

test("review dates on their boundary days", () => {
  const today = "2026-10-20";
  assert.equal(reviewDateProblem(today, today), null);
  assert.equal(reviewDateProblem("2026-10-19", today), "A review date is today or later.");
  assert.equal(reviewDateProblem(addDays(today, 1826), today), null);
  assert.equal(reviewDateProblem(addDays(today, 1827), today), "A review date can be at most five years ahead.");
  assert.equal(reviewDateProblem("2026-13-01", today), "Enter a valid date.");
  assert.equal(reviewState(null, today), null);
  assert.equal(reviewState("2026-10-19", today), "overdue");
  assert.equal(reviewState(today, today), "due_soon");
  assert.equal(reviewState(addDays(today, 30), today), "due_soon");
  assert.equal(reviewState(addDays(today, 31), today), null);
});

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const OWNER = "11111111-2222-4333-8444-555555555555";

test("the form: a good create", () => {
  const r = new FormReader(form({ title: "  Plumber  vetting ", category: "contractor_vetting", owner_id: OWNER.toUpperCase(), body: "\r\n# Steps\r\n1. Licence\r\n", review_due: "2026-12-01" }));
  const v = readKnowledgeFields(r, "2026-10-20", { noteRequired: false });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(v.title, "Plumber vetting");
  assert.equal(v.body, "# Steps\n1. Licence");
  assert.equal(v.ownerId, OWNER);
  assert.equal(v.changeNote, null);
});

test("the form: what is refused", () => {
  const r = new FormReader(form({ title: "", category: "nope", owner_id: "x", body: " ", review_due: "2026-01-01", summary: "s".repeat(501) }));
  readKnowledgeFields(r, "2026-10-20", { noteRequired: true });
  assert.deepEqual(Object.keys(r.errors).sort(), ["body", "category", "change_note", "owner_id", "review_due", "summary", "title"]);
  const long = new FormReader(form({ title: "t", category: "general", owner_id: OWNER, body: "b".repeat(50_001) }));
  readKnowledgeFields(long, "2026-10-20", { noteRequired: false });
  assert.ok(long.errors.body);
});

test("the form: an unchanged review date that has passed is kept", () => {
  const r = new FormReader(form({ title: "t", category: "general", owner_id: OWNER, body: "b", review_due: "2026-01-01", change_note: "x" }));
  readKnowledgeFields(r, "2026-10-20", { noteRequired: true, currentReview: "2026-01-01" });
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test("the list's URL is checked", () => {
  const q = parseKnowledgeListQuery({ q: " plumber\u0000 ", category: "brand_voice", status: "waiting", review: "due", owner: OWNER, page: "3" });
  assert.deepEqual(q, { q: "plumber", category: "brand_voice", status: "waiting", reviewDue: true, owner: OWNER, page: 3, filtered: true, moreActive: true });
  const bad = parseKnowledgeListQuery({ category: "x", status: "y", owner: "z", page: "-4" });
  assert.deepEqual([bad.category, bad.status, bad.owner, bad.page, bad.filtered], [null, null, null, 1, false]);
});

test("body normalising and excerpts", () => {
  assert.equal(normaliseBody("\n\n a\r\nb\u0007 \n"), "a\nb");
  assert.equal(excerpt("# Steps\n- [ ] Check the **licence** and [insurance](https://x.test)", "licence"), "Steps Check the licence and insurance");
  const long = `${"word ".repeat(60)}needle ${"tail ".repeat(60)}`;
  const e = excerpt(long, "needle", 80);
  assert.ok(e.startsWith("…") && e.includes("needle") && e.endsWith("…"));
});
