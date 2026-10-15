import test from "node:test";
import assert from "node:assert/strict";
import { classifyContractorError, logTag } from "./db-errors.ts";

test("constraint names map to plain kinds", () => {
  assert.equal(classifyContractorError({ code: "23514", message: 'violates check constraint "contractors_abn_valid"' }), "abn_invalid");
  assert.equal(classifyContractorError({ code: "23505", message: 'violates unique constraint "contractors_abn_uq"' }), "abn_duplicate");
  assert.equal(classifyContractorError({ code: "23505", message: 'violates unique constraint "contractors_name_key_uq"' }), "name_duplicate");
  assert.equal(classifyContractorError({ code: "23514", message: "contractors_rates_not_negative" }), "rates_negative");
});

test("codes map to kinds", () => {
  assert.equal(classifyContractorError({ code: "42501" }), "permission");
  assert.equal(classifyContractorError({ code: "P0002" }), "not_found");
  assert.equal(classifyContractorError({ code: "23514", message: "the vetting checklist is not complete" }), "refused");
  assert.equal(classifyContractorError({ code: "22023" }), "invalid");
  assert.equal(classifyContractorError({ code: "23505", message: "other" }), "duplicate_other");
  assert.equal(classifyContractorError(null), "other");
});

test("log tags never include the message body", () => {
  assert.equal(logTag({ code: "23505", message: 'duplicate key value violates "contractors_abn_uq" Key (abn)=(51824753556)' }), "23505 contractors_abn_uq");
  assert.equal(logTag({ code: "42501", message: "secret business name" }), "42501");
  assert.equal(logTag(undefined), "unknown");
});

test("a trade that is unknown or archived (0123) maps to its own kind, and the log names the rule only", () => {
  const e = { code: "23514", message: "not a current trade: roofing (contractors_trades_known)" };
  assert.equal(classifyContractorError(e), "trade_not_current");
  assert.equal(logTag(e), "23514 contractors_trades_known");
});
