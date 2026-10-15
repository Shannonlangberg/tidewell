import test from "node:test";
import assert from "node:assert/strict";
import { blockedText, MOVE_TARGETS, parseApprovalPreview, parseWarnings, statusActions } from "./status.ts";

const director = { write: true, approve: true };
const pm = { write: true, approve: false };
const reader = { write: false, approve: false };

test("nobody can be moved to approved or preferred by a plain status move", () => {
  assert.ok(!MOVE_TARGETS.includes("approved") && !MOVE_TARGETS.includes("preferred") && !MOVE_TARGETS.includes("suspended"));
});

test("approve needs contractors.approve and a status that can be approved", () => {
  assert.equal(statusActions("vetting", director).approve, true);
  assert.equal(statusActions("vetting", pm).approve, false);
  assert.equal(statusActions("suspended", director).approve, false);
  assert.equal(statusActions("approved", director).approve, false);
  assert.equal(statusActions("approved", director).prefer, true);
  assert.equal(statusActions("preferred", director).removePreferred, true);
});

test("suspend needs only write; reinstate needs approve and a suspended contractor", () => {
  assert.equal(statusActions("approved", pm).suspend, true);
  assert.equal(statusActions("suspended", pm).suspend, false);
  assert.equal(statusActions("suspended", pm).reinstate, false);
  assert.equal(statusActions("suspended", director).reinstate, true);
  assert.equal(statusActions("approved", reader).suspend, false);
});

test("a suspended contractor has no other moves; a reader has none", () => {
  assert.deepEqual(statusActions("suspended", director).moves, []);
  assert.deepEqual(statusActions("vetting", reader).moves, []);
  assert.ok(!statusActions("vetting", pm).moves.includes("vetting"));
});

test("approval preview is read defensively", () => {
  const p = parseApprovalPreview({ status: "vetting", can_approve: false, blocked_by: ["checklist_incomplete"], missing_steps: ["abn", "insurance"], warnings: [{ code: "insurance_expired", message: "Insurance expired", expires_on: "2026-01-01", days_remaining: -5 }, { nope: 1 }] });
  assert.deepEqual(p?.missingSteps, ["abn", "insurance"]);
  assert.equal(p?.warnings.length, 1);
  assert.equal(p?.warnings[0].daysRemaining, -5);
  assert.equal(parseApprovalPreview(null), null);
  assert.equal(parseApprovalPreview({ status: 1 }), null);
  assert.deepEqual(parseWarnings("x"), []);
  assert.match(blockedText(["checklist_incomplete"]) ?? "", /not complete/);
  assert.equal(blockedText([]), null);
});
