import test from "node:test";
import assert from "node:assert/strict";
import { VETTING_STEPS, VETTING_STEP_LABEL } from "../constants.ts";
import { FormReader } from "../forms.ts";
import {
  CHECKLIST_STEPS,
  MANUAL_VETTING_STEPS,
  VETTING_STEP_HINT,
  VETTING_STEP_STATUSES,
  VETTING_STEP_STATUS_LABEL,
  readVettingStepForm,
  vettingDoneCount,
  vettingProgressLabel,
} from "./vetting-steps.ts";

const ID = "6f0f4a9e-0d0e-4a6e-8a30-1f0b0c1d2e3f";

function read(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const f = new FormReader(fd);
  return { f, value: readVettingStepForm(f) };
}

test("the step list is pinned to constants.ts, in order, and has nine steps", () => {
  assert.deepEqual([...CHECKLIST_STEPS], [...VETTING_STEPS]);
  assert.equal(CHECKLIST_STEPS.length, 9);
  for (const s of VETTING_STEPS) {
    assert.ok(VETTING_STEP_LABEL[s]);
    assert.ok(VETTING_STEP_HINT[s]);
  }
});

test("review_and_approve is never a manual step", () => {
  assert.equal(MANUAL_VETTING_STEPS.length, 8);
  assert.ok(!(MANUAL_VETTING_STEPS as readonly string[]).includes("review_and_approve"));
  const r = read({ contractor_id: ID, step: "review_and_approve", status: "done" });
  assert.equal(r.value, null);
  assert.ok(r.f.errors.step);
});

test("every status has a label", () => {
  for (const s of VETTING_STEP_STATUSES) assert.ok(VETTING_STEP_STATUS_LABEL[s]);
});

test("a done step reads without a note", () => {
  const r = read({ contractor_id: ID, step: "abn", status: "done", note: "" });
  assert.deepEqual(r.value, { contractorId: ID, step: "abn", status: "done", note: null });
});

test("not applicable needs a note", () => {
  const bad = read({ contractor_id: ID, step: "licence", status: "not_applicable", note: "   " });
  assert.equal(bad.value, null);
  assert.match(bad.f.errors.note ?? "", /why/i);
  const ok = read({ contractor_id: ID, step: "licence", status: "not_applicable", note: "No licence needed for this trade." });
  assert.equal(ok.value?.status, "not_applicable");
  assert.equal(ok.value?.note, "No licence needed for this trade.");
});

test("a bad contractor id, step or status is refused", () => {
  assert.equal(read({ contractor_id: "nope", step: "abn", status: "done" }).value, null);
  assert.equal(read({ contractor_id: ID, step: "bogus", status: "done" }).value, null);
  assert.equal(read({ contractor_id: ID, step: "abn", status: "approved" }).value, null);
  assert.equal(read({ contractor_id: ID, step: "abn" }).value, null);
});

test("an over-long note is refused", () => {
  const r = read({ contractor_id: ID, step: "abn", status: "in_progress", note: "x".repeat(1001) });
  assert.equal(r.value, null);
  assert.ok(r.f.errors.note);
});

test("progress counts done and not applicable, out of nine", () => {
  const rows = [{ status: "done" }, { status: "not_applicable" }, { status: "in_progress" }, { status: "not_started" }];
  assert.equal(vettingDoneCount(rows), 2);
  assert.equal(vettingProgressLabel(rows), "2 of 9");
  assert.equal(vettingProgressLabel([]), "0 of 9");
});
