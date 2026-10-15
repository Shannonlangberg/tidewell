import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACTOR_CATEGORIES } from "../constants.ts";
import { coveredTrades, parseContractorSummary } from "./widgets-summary.ts";

test("a missing or malformed summary becomes zeros and empty lists, never invented figures", () => {
  for (const bad of [null, undefined, 5, "x", [], {}]) {
    const s = parseContractorSummary(bad);
    assert.equal(s.total, 0);
    assert.equal(s.awaitingVetting, 0);
    assert.equal(s.expired, 0);
    assert.deepEqual(s.coverage, []);
    assert.deepEqual(s.tradesWithoutCover, []);
    assert.equal(s.warningDays, 30);
  }
});

test("a real summary is read field by field", () => {
  const s = parseContractorSummary({
    as_of: "2026-10-15",
    warning_days: 45,
    total: 31,
    awaiting_vetting: 4,
    expiring_soon: 2,
    expired: 1,
    cleared_with_expired_items: 1,
    preferred_coverage: [
      { category: "plumbing", approved: 1, preferred: 1, total: 2 },
      { category: "electrical", approved: 0, preferred: 0, total: 0 },
      { category: "other", approved: 0, preferred: 0, total: 0 },
      { nope: true },
      "junk",
    ],
    trades_without_cover: ["electrical", 7, "locksmith"],
  });
  assert.equal(s.warningDays, 45);
  assert.equal(s.awaitingVetting, 4);
  assert.equal(s.clearedWithExpiredItems, 1);
  assert.equal(s.coverage.length, 3);
  assert.deepEqual(s.tradesWithoutCover, ["electrical", "locksmith"]);
  assert.deepEqual(coveredTrades(s.coverage), [{ category: "plumbing", approved: 1, preferred: 1, total: 2 }]);
});

test("a non-finite number is not trusted", () => {
  assert.equal(parseContractorSummary({ total: Number.NaN, expired: Infinity }).total, 0);
  assert.equal(parseContractorSummary({ expired: "3" }).expired, 0);
});

test("every category the database can name has a label", () => {
  assert.equal(CONTRACTOR_CATEGORIES.length, 22);
});
