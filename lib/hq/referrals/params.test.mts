// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { OPPORTUNITY_STAGES, PARTNER_CATEGORIES } from "../constants.ts";
import {
  PARTNER_SORT_COLUMNS,
  REFERRAL_SORT_COLUMNS,
  boundedInt,
  cleanSearch,
  first,
  orIlike,
  pageRange,
  parseAssigned,
  parseCalendarDate,
  parseNewReferralParams,
  parsePartnerParams,
  parsePipelineParams,
  parseReferralListParams,
  parseSort,
  parseUuid,
  refNumberFromSearch,
} from "./params.ts";

const A = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001";
const B = "3F7F0D1E-1C5A-4A52-9A52-8A3B0F4A0002";

test("first takes the first value and never throws", () => {
  assert.equal(first("a"), "a");
  assert.equal(first(["x", "y"]), "x");
  assert.equal(first(undefined), "");
  assert.equal(first([]), "");
});

test("uuids and dates are checked for shape and for being real", () => {
  assert.equal(parseUuid(A), A);
  assert.equal(parseUuid(B), B.toLowerCase());
  assert.equal(parseUuid(" " + A + " "), A);
  assert.equal(parseUuid("not-a-uuid"), null);
  assert.equal(parseUuid(`${A}' or 1=1`), null);
  assert.equal(parseCalendarDate("2026-10-15"), "2026-10-15");
  assert.equal(parseCalendarDate("2024-02-29"), "2024-02-29");
  assert.equal(parseCalendarDate("2026-02-30"), null);
  assert.equal(parseCalendarDate("15/10/2026"), null);
  assert.equal(parseCalendarDate(""), null);
});

test("boundedInt refuses half-numbers", () => {
  assert.equal(boundedInt("3", 1, 1, 10), 3);
  assert.equal(boundedInt("0", 1, 1, 10), 1);
  assert.equal(boundedInt("999", 1, 1, 10), 10);
  assert.equal(boundedInt("2abc", 1, 1, 10), 1);
  assert.equal(boundedInt("1e3", 1, 1, 10), 1);
  assert.equal(boundedInt("-4", 1, 1, 10), 1);
  assert.equal(boundedInt("", 7, 1, 10), 7);
});

test("search text is reduced to what appears in names, so it cannot add an or-condition", () => {
  assert.equal(cleanSearch("  Pat   Prospect "), "Pat Prospect");
  assert.equal(cleanSearch("O'Brien & Sons"), "O'Brien & Sons");
  assert.equal(cleanSearch("a@b.com"), "a@b.com");
  assert.equal(cleanSearch("x),or(id.not.is.null"), "x or id.not.is.null");
  assert.equal(cleanSearch("50%_off"), "50 off");
  assert.equal(cleanSearch("(),\"*\\"), "");
  assert.equal(cleanSearch(null), "");
  assert.equal(cleanSearch("a".repeat(500)).length, 100);
  assert.equal(cleanSearch("Zoë Müller"), "Zoë Müller");
});

test("the or-filter carries only the cleaned term, and only the caller's columns", () => {
  assert.equal(orIlike(["prospect_name", "ref_label"], "Pat"), 'prospect_name.ilike."*Pat*",ref_label.ilike."*Pat*"');
  assert.equal(orIlike(["prospect_name"], "x),or(id.eq.1"), 'prospect_name.ilike."*x or id.eq.1*"');
  assert.equal(orIlike(["prospect_name"], "(),"), null);
  assert.equal(orIlike(["prospect_name"], ""), null);
});

test("a reference can be searched as REF-0017, ref17 or 17", () => {
  assert.equal(refNumberFromSearch("REF-0017"), 17);
  assert.equal(refNumberFromSearch("ref 17"), 17);
  assert.equal(refNumberFromSearch("ref17"), 17);
  assert.equal(refNumberFromSearch("17"), 17);
  assert.equal(refNumberFromSearch(" 0042 "), 42);
  assert.equal(refNumberFromSearch("Pat"), null);
  assert.equal(refNumberFromSearch("REF-"), null);
  assert.equal(refNumberFromSearch("12 Smith St"), null);
  assert.equal(refNumberFromSearch("1234567890"), null); // longer than a reference can be
});

test("a sort key must be on the allowlist; each key has its own natural direction", () => {
  const keys = ["a", "b"] as const;
  assert.deepEqual(parseSort("b", "desc", keys, "a"), { sort: "b", dir: "desc" });
  assert.deepEqual(parseSort("b", "", keys, "a", { b: "desc" }), { sort: "b", dir: "desc" });
  assert.deepEqual(parseSort("b", "sideways", keys, "a", { b: "desc" }), { sort: "b", dir: "desc" });
  assert.deepEqual(parseSort("b", "asc", keys, "a", { b: "desc" }), { sort: "b", dir: "asc" });
  assert.deepEqual(parseSort("drop table", "desc", keys, "a", { a: "desc" }), { sort: "a", dir: "desc" });
  assert.deepEqual(parseSort("", "", keys, "a"), { sort: "a", dir: "asc" });
});

test("page ranges are zero-based and inclusive", () => {
  assert.deepEqual(pageRange(1, 25), { from: 0, to: 24 });
  assert.deepEqual(pageRange(3, 25), { from: 50, to: 74 });
  assert.deepEqual(pageRange(0, 25), { from: 0, to: 24 });
});

test("the assigned filter accepts me, none or a staff id", () => {
  assert.deepEqual(parseAssigned("me"), { kind: "me" });
  assert.deepEqual(parseAssigned("none"), { kind: "none" });
  assert.deepEqual(parseAssigned(B), { kind: "staff", id: B.toLowerCase() });
  assert.equal(parseAssigned("everyone"), null);
  assert.equal(parseAssigned(""), null);
});

test("the register starts at the newest referral first, with no filters", () => {
  const q = parseReferralListParams({});
  assert.equal(q.sort, "date");
  assert.equal(q.dir, "desc");
  assert.equal(q.page, 1);
  assert.equal(q.filtered, false);
  assert.equal(q.direction, null);
  assert.equal(q.stage, null);
  assert.equal(q.signedOnly, false);
});

test("the register reads each filter and flags that some are on", () => {
  const q = parseReferralListParams({
    q: "  REF-0012  ",
    direction: "sent",
    stage: "qualified",
    partner: A,
    assigned: "me",
    signed: "1",
    from: "2026-07-01",
    to: "2026-10-15",
    sort: "partner",
    dir: "asc",
    page: "3",
  });
  assert.equal(q.q, "REF-0012");
  assert.equal(q.direction, "sent");
  assert.equal(q.stage, "qualified");
  assert.equal(q.partner, A);
  assert.deepEqual(q.assigned, { kind: "me" });
  assert.equal(q.signedOnly, true);
  assert.equal(q.from, "2026-07-01");
  assert.equal(q.to, "2026-10-15");
  assert.equal(q.sort, "partner");
  assert.equal(q.dir, "asc");
  assert.equal(q.page, 3);
  assert.equal(q.filtered, true);
});

test("the register throws away anything it does not recognise", () => {
  const q = parseReferralListParams({
    direction: "sideways",
    stage: "won",
    partner: "'; drop table hq.referrals; --",
    assigned: "everyone",
    signed: "yes",
    from: "yesterday",
    to: "2026-02-30",
    sort: "created_by",
    dir: "up",
    page: "-1",
  });
  assert.equal(q.direction, null);
  assert.equal(q.stage, null);
  assert.equal(q.partner, null);
  assert.equal(q.assigned, null);
  assert.equal(q.signedOnly, false);
  assert.equal(q.from, null);
  assert.equal(q.to, null);
  assert.equal(q.sort, "date");
  assert.equal(q.dir, "desc");
  assert.equal(q.page, 1);
  assert.equal(q.filtered, false);
});

test("a date range typed backwards is put the right way round", () => {
  const q = parseReferralListParams({ from: "2026-10-15", to: "2026-07-01" });
  assert.equal(q.from, "2026-07-01");
  assert.equal(q.to, "2026-10-15");
});

test("every register sort key points at a real column and nothing else", () => {
  assert.deepEqual(Object.keys(REFERRAL_SORT_COLUMNS).sort(), ["assigned", "date", "partner", "prospect", "ref", "signed", "stage", "value"]);
  for (const col of Object.values(REFERRAL_SORT_COLUMNS)) assert.match(col, /^[a-z_]+$/);
  // Sorting by anything else, such as a prospect's phone number, is impossible
  for (const col of Object.values(REFERRAL_SORT_COLUMNS)) {
    assert.doesNotMatch(col, /phone|email|address/);
  }
});

test("the register's stage filter accepts exactly the eight stages", () => {
  for (const stage of OPPORTUNITY_STAGES) assert.equal(parseReferralListParams({ stage }).stage, stage);
  assert.equal(parseReferralListParams({ stage: "" }).stage, null);
});

test("the pipeline shows one stage at a time on a phone, starting at the first", () => {
  assert.equal(parsePipelineParams({}).stage, "introduction_received");
  assert.equal(parsePipelineParams({ stage: "qualified" }).stage, "qualified");
  assert.equal(parsePipelineParams({ stage: "nonsense" }).stage, "introduction_received");
  for (const stage of OPPORTUNITY_STAGES) assert.equal(parsePipelineParams({ stage }).stage, stage);
});

test("the pipeline filters are assigned, partner and hide lost", () => {
  const q = parsePipelineParams({ assigned: B, partner: A, hide_lost: "1" });
  assert.deepEqual(q.assigned, { kind: "staff", id: B.toLowerCase() });
  assert.equal(q.partner, A);
  assert.equal(q.hideLost, true);
  assert.equal(q.filtered, true);
  const none = parsePipelineParams({ hide_lost: "0", assigned: "x" });
  assert.equal(none.hideLost, false);
  assert.equal(none.assigned, null);
  assert.equal(none.filtered, false);
});

test("partner performance sorts by an allowlist, biggest first for the figures", () => {
  const q = parsePartnerParams({}, PARTNER_CATEGORIES);
  assert.equal(q.sort, "received");
  assert.equal(q.dir, "desc");
  assert.equal(q.showAll, false);
  assert.equal(q.filtered, false);
  assert.deepEqual(parsePartnerParams({ sort: "name" }, PARTNER_CATEGORIES), { category: null, showAll: false, sort: "name", dir: "asc", page: 1, filtered: false });
  assert.equal(parsePartnerParams({ sort: "signed" }, PARTNER_CATEGORIES).dir, "desc");
  assert.equal(parsePartnerParams({ sort: "signed", dir: "asc" }, PARTNER_CATEGORIES).dir, "asc");
  assert.equal(parsePartnerParams({ sort: "password" }, PARTNER_CATEGORIES).sort, "received");
  assert.equal(Object.keys(PARTNER_SORT_COLUMNS).length, 7);
});

test("partner performance accepts only a real category and the show-all switch", () => {
  assert.equal(parsePartnerParams({ category: "mortgage_broker" }, PARTNER_CATEGORIES).category, "mortgage_broker");
  assert.equal(parsePartnerParams({ category: "mortgage_broker" }, PARTNER_CATEGORIES).filtered, true);
  assert.equal(parsePartnerParams({ category: "gardener" }, PARTNER_CATEGORIES).category, null);
  assert.equal(parsePartnerParams({ show: "all" }, PARTNER_CATEGORIES).showAll, true);
  assert.equal(parsePartnerParams({ show: "yes" }, PARTNER_CATEGORIES).showAll, false);
});

test("the record form can be started from a partner or from a prospect already in the pipeline", () => {
  assert.deepEqual(parseNewReferralParams({}), { direction: "received", partnerContact: null, partnerOrganisation: null, existingOpportunity: null });
  assert.deepEqual(parseNewReferralParams({ partner_contact: A, direction: "sent" }), {
    direction: "sent",
    partnerContact: A,
    partnerOrganisation: null,
    existingOpportunity: null,
  });
  assert.equal(parseNewReferralParams({ partner_organisation: B }).partnerOrganisation, B.toLowerCase());
  assert.equal(parseNewReferralParams({ existing: A }).existingOpportunity, A);
  assert.equal(parseNewReferralParams({ partner_contact: "x", direction: "both", existing: "y" }).partnerContact, null);
  assert.equal(parseNewReferralParams({ direction: "both" }).direction, "received");
});
