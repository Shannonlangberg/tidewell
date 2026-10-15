// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { classifyReferralError, logTag } from "./errors.ts";

const e = (code: string, message: string) => ({ code, message });

test("permission errors are told apart from the one rule about leaving signed", () => {
  assert.equal(classifyReferralError(e("42501", "permission denied")), "permission");
  assert.equal(
    classifyReferralError(e("42501", "only a director or administrator can move an opportunity out of management_signed")),
    "leave_signed_forbidden",
  );
});

test("unique violations: a repeated management reference, a repeated claim, a clash over credit", () => {
  assert.equal(
    classifyReferralError(e("23505", 'duplicate key value violates unique constraint "opportunities_management_reference_uq"')),
    "duplicate_reference",
  );
  assert.equal(classifyReferralError(e("23505", "that partner already has a referral on this opportunity")), "duplicate_claim");
  assert.equal(
    classifyReferralError(e("23505", 'duplicate key value violates unique constraint "referrals_one_attributed_uq"')),
    "attribution_conflict",
  );
  assert.equal(classifyReferralError(e("23505", "something else")), "other");
});

test("not found: an opportunity, or a partner that no longer exists", () => {
  assert.equal(classifyReferralError(e("P0002", "opportunity not found")), "not_found");
  assert.equal(classifyReferralError(e("P0002", "referring contact not found")), "partner_not_found");
  assert.equal(classifyReferralError(e("P0002", "receiving organisation not found")), "partner_not_found");
  assert.equal(classifyReferralError(e("PGRST116", "The result contains 0 rows")), "not_found");
});

test("archiving the credited source is its own case", () => {
  assert.equal(
    classifyReferralError(e("23514", "this referral is the attributed source; move attribution to another referral first")),
    "attributed_source",
  );
  assert.equal(classifyReferralError(e("23514", "opportunity abc has received referrals but none is attributed; move attribution first")), "attribution_conflict");
  assert.equal(classifyReferralError(e("23514", 'new row violates check constraint "referrals_sent_shape"')), "invalid");
});

test("invalid-parameter errors from the RPCs map to the field the person can fix", () => {
  assert.equal(classifyReferralError(e("22023", "a prospect name is required for a new opportunity")), "prospect_required");
  assert.equal(classifyReferralError(e("22023", "the assignee must be an active member of staff")), "assignee_inactive");
  assert.equal(classifyReferralError(e("22023", "a lost opportunity needs a reason")), "lost_reason_required");
  assert.equal(classifyReferralError(e("22023", "a received referral needs a referring contact or organisation")), "partner_required");
  assert.equal(classifyReferralError(e("22023", "a sent referral needs a receiving contact or organisation")), "partner_required");
  assert.equal(classifyReferralError(e("22023", "the referring contact does not belong to the referring organisation")), "partner_mismatch");
  assert.equal(
    classifyReferralError(e("22023", "the estimated value belongs to the opportunity; it cannot be set by an additional referral")),
    "value_on_claim",
  );
  assert.equal(classifyReferralError(e("22023", "that is not a received referral for this opportunity")), "not_a_claim");
  assert.equal(classifyReferralError(e("22023", "something unforeseen")), "invalid");
});

test("anything unrecognised is 'other', and a missing error does not throw", () => {
  assert.equal(classifyReferralError(e("XX000", "boom")), "other");
  assert.equal(classifyReferralError(null), "other");
  assert.equal(classifyReferralError(undefined), "other");
  assert.equal(classifyReferralError({}), "other");
  assert.equal(classifyReferralError(e("22P02", "invalid input syntax for type uuid")), "invalid");
});

test("what is logged is a code and a constraint name, never the message or the values in it", () => {
  const dupe = e("23505", 'duplicate key value violates unique constraint "opportunities_management_reference_uq" Key (management_reference)=(PM-1234) already exists.');
  assert.equal(logTag(dupe), "23505 opportunities_management_reference_uq");
  assert.doesNotMatch(logTag(dupe), /PM-1234/);
  assert.equal(logTag(e("22023", "a prospect name is required for a new opportunity")), "22023");
  assert.equal(logTag(null), "unknown");
  assert.equal(logTag({ message: "no code" }), "unknown");
});
