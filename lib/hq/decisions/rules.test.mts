import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormReader } from "../forms.ts";
import { CAPABILITIES } from "../constants.ts";
import {
  DECISION_CATEGORIES,
  DECISION_CATEGORY_LABEL,
  DECISION_STATUSES,
  DECISION_STATUS_LABEL,
  addDays,
  decisionDateProblem,
  decisionRef,
  decisionStatusTone,
  editableStatuses,
  historyValue,
  isClosedStatus,
  maxDecisionDate,
  parseDecisionListQuery,
  parseDecisionRef,
  readDecisionFields,
  searchWords,
  statusChangeProblem,
} from "./rules.ts";

/*
 * The decision rules mirror migration 0125. These tests pin the vocabulary to the migration's own
 * enum text, so a value added in one place and not the other fails here.
 */

const migration = readFileSync(new URL("../../../supabase/migrations/0125_hq_decisions.sql", import.meta.url), "utf8");
function enumValues(name: string): string[] {
  const m = new RegExp(`create type hq\\.${name} as enum \\(([^)]*)\\)`, "s").exec(migration);
  assert.ok(m, `enum ${name} is in the migration`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

test("categories and statuses match the database enums, in order, each with a label", () => {
  assert.deepEqual([...DECISION_CATEGORIES], enumValues("decision_category"));
  assert.deepEqual([...DECISION_STATUSES], enumValues("decision_status"));
  for (const c of DECISION_CATEGORIES) assert.ok(DECISION_CATEGORY_LABEL[c]);
  for (const s of DECISION_STATUSES) assert.ok(DECISION_STATUS_LABEL[s]);
});

test("the two capabilities exist in the app's list and in the migration's matrix", () => {
  assert.ok((CAPABILITIES as readonly string[]).includes("decisions.read"));
  assert.ok((CAPABILITIES as readonly string[]).includes("decisions.write"));
  assert.match(migration, /\('read_only', 'decisions\.read'\)/);
  assert.doesNotMatch(migration, /\('read_only', 'decisions\.write'\)/);
});

test("refs: DEC-0001 formatting never truncates, and parsing accepts the ways people type it", () => {
  assert.equal(decisionRef(1), "DEC-0001");
  assert.equal(decisionRef(42), "DEC-0042");
  assert.equal(decisionRef(123456), "DEC-123456");
  assert.equal(decisionRef(null), "");
  assert.equal(parseDecisionRef("DEC-0001"), 1);
  assert.equal(parseDecisionRef(" dec 12 "), 12);
  assert.equal(parseDecisionRef("DEC7"), 7);
  assert.equal(parseDecisionRef("decision 3"), 3);
  assert.equal(parseDecisionRef("DEC-0000"), null);
  assert.equal(parseDecisionRef("REF-0001"), null);
  assert.equal(parseDecisionRef("pricing"), null);
  assert.equal(parseDecisionRef(""), null);
});

test("dates: at most 7 days ahead, never before 1990", () => {
  assert.equal(addDays("2026-10-20", 7), "2026-10-27");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(maxDecisionDate("2026-10-20"), "2026-10-27");
  assert.equal(decisionDateProblem("2026-10-27", "2026-10-20"), null);
  assert.match(decisionDateProblem("2026-10-28", "2026-10-20") ?? "", /at most 7 days ahead/);
  assert.match(decisionDateProblem("1989-12-31", "2026-10-20") ?? "", /too far in the past/);
  assert.equal(decisionDateProblem("1990-01-01", "2026-10-20"), null);
  assert.equal(decisionDateProblem("20-10-2026", "2026-10-20"), "Enter a valid date.");
});

test("status rules: open moves freely; reverse and supersede need a note; supersede needs a target, not itself; closed stays closed", () => {
  const base = { note: null, supersededBy: null };
  assert.equal(statusChangeProblem({ ...base, from: "proposed", to: "decided" }), null);
  assert.equal(statusChangeProblem({ ...base, from: "in_effect", to: "proposed" }), null);
  assert.equal(statusChangeProblem({ ...base, from: "decided", to: "decided" }), null);
  assert.match(statusChangeProblem({ ...base, from: "decided", to: "reversed" }) ?? "", /note is required to reverse/);
  assert.equal(statusChangeProblem({ from: "decided", to: "reversed", note: "Changed our minds", supersededBy: null }), null);
  assert.match(statusChangeProblem({ ...base, from: "decided", to: "superseded" }) ?? "", /which decision replaces/);
  assert.match(statusChangeProblem({ from: "decided", to: "superseded", note: "x", supersededBy: "A", selfId: "a" }) ?? "", /cannot supersede itself/);
  assert.match(statusChangeProblem({ from: "decided", to: "superseded", note: " ", supersededBy: "b", selfId: "a" }) ?? "", /note is required to supersede/);
  assert.equal(statusChangeProblem({ from: "decided", to: "superseded", note: "Pricing changed", supersededBy: "b", selfId: "a" }), null);
  assert.match(statusChangeProblem({ ...base, from: "superseded", to: "decided" }) ?? "", /can no longer change/);
  assert.match(statusChangeProblem({ from: "reversed", to: "superseded", note: "x", supersededBy: "b" }) ?? "", /can no longer change/);
  assert.match(statusChangeProblem({ from: "superseded", to: "superseded", note: "x", supersededBy: "c" }) ?? "", /can no longer change/);
  assert.ok(isClosedStatus("superseded") && isClosedStatus("reversed") && !isClosedStatus("in_effect"));
  assert.deepEqual(editableStatuses("decided"), ["proposed", "decided", "in_effect"]);
  assert.deepEqual(editableStatuses("reversed"), []);
  assert.equal(decisionStatusTone("reversed"), "warning");
});

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const MAKER = "6b0c1f9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";

test("form: a valid decision reads cleanly", () => {
  const r = new FormReader(form({ title: "  Lead with long-term management ", category: "strategy", decision_date: "2026-10-20", status: "decided", decision_maker_id: MAKER.toUpperCase(), rationale: "Focus for year one." }));
  const v = readDecisionFields(r, "2026-10-20", { statusRequired: true });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(v.title, "Lead with long-term management");
  assert.equal(v.decisionMakerId, MAKER);
  assert.equal(v.description, null);
  assert.equal(v.rationale, "Focus for year one.");
});

test("form: boundaries and required fields", () => {
  const r = new FormReader(form({ title: "x".repeat(201), category: "astrology", decision_date: "2026-10-28", status: "superseded", decision_maker_id: "nobody", description: "d".repeat(5001), note: "n".repeat(1001) }));
  readDecisionFields(r, "2026-10-20", { statusRequired: true });
  assert.deepEqual(Object.keys(r.errors).sort(), ["category", "decision_date", "decision_maker_id", "description", "note", "status", "title"]);
  assert.match(r.errors.decision_date, /7 days ahead/);
  const ok = new FormReader(form({ title: "x".repeat(200), category: "other", decision_date: "2026-10-27", decision_maker_id: MAKER, description: "d".repeat(5000) }));
  readDecisionFields(ok, "2026-10-20", { statusRequired: false });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  const missing = new FormReader(form({}));
  readDecisionFields(missing, "2026-10-20", { statusRequired: true });
  assert.deepEqual(Object.keys(missing.errors).sort(), ["category", "decision_date", "decision_maker_id", "status", "title"]);
});

test("list query: every filter is checked; bad values are dropped; dates are put in order", () => {
  const q = parseDecisionListQuery({ q: "  pricing\u0000 model ", category: "finance", status: "in_effect", maker: MAKER.toUpperCase(), from: "2026-10-31", to: "2026-10-01", page: "3" });
  assert.deepEqual(q, { q: "pricing model", category: "finance", status: "in_effect", maker: MAKER, from: "2026-10-01", to: "2026-10-31", page: 3, filtered: true, moreActive: true });
  const bad = parseDecisionListQuery({ category: "x", status: "done", maker: "1 or 1=1", from: "2026-02-30", page: "-4" });
  assert.deepEqual(bad, { q: "", category: null, status: null, maker: null, from: null, to: null, page: 1, filtered: false, moreActive: false });
  const searchOnly = parseDecisionListQuery({ q: "growth" });
  assert.equal(searchOnly.filtered, true);
  assert.equal(searchOnly.moreActive, false);
  assert.equal(searchWords("50% (fees), \"rent\""), "50 fees rent");
});

test("history values read as words", () => {
  const names = (id: string) => (id === MAKER ? "Dana Director" : null);
  assert.equal(historyValue("status", "in_effect", names), "In effect");
  assert.equal(historyValue("category", "legal_compliance", names), "Legal and compliance");
  assert.equal(historyValue("decision_maker_id", MAKER, names), "Dana Director");
  assert.equal(historyValue("decision_maker_id", "someone-else", names), "a colleague");
  assert.equal(historyValue("rationale", null, names), "(none)");
});
