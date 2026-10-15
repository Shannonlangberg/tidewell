// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { checkPartner, checkPastOrToday, followUpTitle, safeReturnPath } from "./rules.ts";

const TODAY = "2026-10-15";
const ORG_A = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001";
const ORG_B = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0002";
const CONTACT = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0003";

test("a referral or signing date must have happened already", () => {
  assert.deepEqual(checkPastOrToday("2026-10-15", TODAY, "The referral date"), { ok: true, value: "2026-10-15" });
  assert.deepEqual(checkPastOrToday("2026-10-01", TODAY, "The referral date"), { ok: true, value: "2026-10-01" });
  assert.deepEqual(checkPastOrToday("2026-10-16", TODAY, "The referral date"), { ok: false, message: "The referral date can't be in the future." });
  assert.deepEqual(checkPastOrToday("2030-01-01", TODAY, "The signed date"), { ok: false, message: "The signed date can't be in the future." });
});

test("a missing, malformed or absurd date is refused with a plain message", () => {
  assert.deepEqual(checkPastOrToday("", TODAY, "The signed date"), { ok: false, message: "The signed date is required." });
  assert.deepEqual(checkPastOrToday(null, TODAY, "The signed date"), { ok: false, message: "The signed date is required." });
  assert.deepEqual(checkPastOrToday("15/10/2026", TODAY, "The signed date"), { ok: false, message: "Enter a valid date." });
  assert.deepEqual(checkPastOrToday("2026-02-30", TODAY, "The signed date"), { ok: false, message: "Enter a valid date." });
  assert.deepEqual(checkPastOrToday("1999-12-31", TODAY, "The signed date"), { ok: false, message: "That date is too far in the past." });
});

test("'today' is the person's today, so the evening of the 14th in Adelaide is not the 15th", () => {
  // The caller works out today in the person's timezone; this rule compares against whatever it is given.
  assert.equal(checkPastOrToday("2026-10-15", "2026-10-14", "The date").ok, false);
  assert.equal(checkPastOrToday("2026-10-14", "2026-10-14", "The date").ok, true);
});

test("a partner is a contact, an organisation, or both", () => {
  assert.deepEqual(checkPartner({ contactId: null, organisationId: ORG_A, contactOrganisationId: null }), { ok: true, partner: { contactId: null, organisationId: ORG_A } });
  assert.deepEqual(checkPartner({ contactId: CONTACT, organisationId: null, contactOrganisationId: ORG_A }), { ok: true, partner: { contactId: CONTACT, organisationId: null } });
  assert.deepEqual(checkPartner({ contactId: CONTACT, organisationId: ORG_A, contactOrganisationId: ORG_A }), { ok: true, partner: { contactId: CONTACT, organisationId: ORG_A } });
  // An independent contact (no organisation) may be paired with any organisation: nothing contradicts it
  assert.equal(checkPartner({ contactId: CONTACT, organisationId: ORG_A, contactOrganisationId: null }).ok, true);
});

test("no partner, or a contact from a different organisation, is refused on the right field", () => {
  const none = checkPartner({ contactId: null, organisationId: null, contactOrganisationId: null });
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.field, "partner_organisation");
  const mismatch = checkPartner({ contactId: CONTACT, organisationId: ORG_B, contactOrganisationId: ORG_A });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.field, "partner_contact");
    assert.match(mismatch.message, /different organisation/);
  }
});

test("a person is only ever sent back to the pipeline or the referral pages", () => {
  const fallback = "/hq/growth/referrals";
  const id = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001";
  assert.equal(safeReturnPath("/hq/growth/pipeline", fallback), "/hq/growth/pipeline");
  assert.equal(safeReturnPath("/hq/growth/pipeline?assigned=me&hide_lost=1", fallback), "/hq/growth/pipeline?assigned=me&hide_lost=1");
  assert.equal(safeReturnPath("/hq/growth/referrals", fallback), "/hq/growth/referrals");
  assert.equal(safeReturnPath(`/hq/growth/referrals/${id}`, fallback), `/hq/growth/referrals/${id}`);
  assert.equal(safeReturnPath("/hq/growth/referrals?direction=sent&page=2", fallback), "/hq/growth/referrals?direction=sent&page=2");
});

test("a return path that leads anywhere else is replaced", () => {
  const fallback = "/hq/growth/referrals";
  const id = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001";
  for (const bad of [
    "https://evil.example/hq/growth/pipeline",
    "//evil.example",
    "/\\evil.example",
    "/hq/growth/pipeline/../../../app",
    "/hq/growth/pipeline#frag",
    "/hq/growth/referrals/not-a-uuid",
    `/hq/growth/referrals/${id}/edit`,
    "/hq/growth/contacts",
    "/hq",
    "/hq/growth/pipeline?x=<script>",
    "/hq/growth/pipeline?x=1\nSet-Cookie: a=b",
    "javascript:alert(1)",
    "",
    "/hq/growth/pipeline?" + "a".repeat(400),
  ]) {
    assert.equal(safeReturnPath(bad, fallback), fallback, bad);
  }
  assert.equal(safeReturnPath(undefined, fallback), fallback);
  assert.equal(safeReturnPath(null, fallback), fallback);
  assert.equal(safeReturnPath(42, fallback), fallback);
});

test("the follow-up task title names the reference and never the prospect", () => {
  assert.equal(followUpTitle("REF-0012"), "Follow up on REF-0012");
});
