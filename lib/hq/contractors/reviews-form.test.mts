import test from "node:test";
import assert from "node:assert/strict";
import { FormReader } from "../forms.ts";
import { RATING_FIELDS, RATING_LABEL, TENANT_FEEDBACK_LABEL, describeRatings, ratingSummary, readReviewForm } from "./reviews-form.ts";

const CID = "6f0f4a9e-0d0e-4a6e-8a30-1f0b0c1d2e3f";
const reader = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new FormReader(fd);
};

test("ratings are optional individually but something must be given", () => {
  const empty = reader({ contractor_id: CID });
  assert.equal(readReviewForm(empty), null);
  assert.match(empty.errors.notes ?? "", /at least one rating/i);

  const noteOnly = readReviewForm(reader({ contractor_id: CID, notes: "Turned up on time." }));
  assert.equal(noteOnly?.notes, "Turned up on time.");
  assert.ok(RATING_FIELDS.every((k) => noteOnly?.ratings[k] === null));

  const oneRating = readReviewForm(reader({ contractor_id: CID, work_quality: "4" }));
  assert.equal(oneRating?.ratings.work_quality, 4);
  assert.equal(oneRating?.ratings.communication, null);
});

test("a rating outside 1 to 5 is refused", () => {
  for (const v of ["0", "6", "-1", "4.5", "five"]) {
    const r = reader({ contractor_id: CID, response_time: v, notes: "x" });
    assert.equal(readReviewForm(r), null, v);
    assert.ok(r.errors.response_time);
  }
});

test("tenant feedback, rework, job date and reference", () => {
  const v = readReviewForm(
    reader({ contractor_id: CID, communication: "5", tenant_feedback: "negative", rework_required: "yes", job_date: "2026-09-30", job_reference: " WO-123 " }),
  );
  assert.equal(v?.tenantFeedback, "negative");
  assert.equal(v?.reworkRequired, true);
  assert.equal(v?.jobDate, "2026-09-30");
  assert.equal(v?.jobReference, "WO-123");
  assert.equal(readReviewForm(reader({ contractor_id: CID, communication: "5", rework_required: "no" }))?.reworkRequired, false);
  assert.equal(readReviewForm(reader({ contractor_id: CID, communication: "5" }))?.reworkRequired, null, "unknown is not no");
  assert.equal(readReviewForm(reader({ contractor_id: CID, communication: "5", tenant_feedback: "great" })), null);
  assert.equal(readReviewForm(reader({ contractor_id: CID, communication: "5", job_date: "yesterday" })), null);
});

test("a missing or malformed contractor id is refused", () => {
  assert.equal(readReviewForm(reader({ communication: "5" })), null);
  assert.equal(readReviewForm(reader({ contractor_id: "abc", communication: "5" })), null);
});

test("the summary is never a number below the threshold", () => {
  assert.deepEqual(ratingSummary(null, 1, 3), { enough: false, text: "Not enough feedback yet (1 of 3)" });
  assert.deepEqual(ratingSummary(null, 0, 3), { enough: false, text: "Not enough feedback yet (0 of 3)" });
  // Even if a rating were somehow passed below the threshold, it is not shown.
  assert.equal(ratingSummary(4.5, 2, 3).enough, false);
  assert.deepEqual(ratingSummary(4.25, 3, 3), { enough: true, text: "4.3 out of 5" });
  assert.deepEqual(ratingSummary(5, 10, 3), { enough: true, text: "5.0 out of 5" });
});

test("ratings are described without the blanks", () => {
  assert.equal(describeRatings({ response_time: null, communication: 5, work_quality: 4, invoice_accuracy: null }), "Communication 5, Quality of work 4");
  assert.equal(describeRatings({}), "");
  for (const k of RATING_FIELDS) assert.ok(RATING_LABEL[k]);
  assert.equal(Object.keys(TENANT_FEEDBACK_LABEL).length, 4);
});
