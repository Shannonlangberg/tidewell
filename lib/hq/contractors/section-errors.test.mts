import test from "node:test";
import assert from "node:assert/strict";
import { GENERIC_FAILURE, NOT_PERMITTED, failureMessage, logCode } from "./section-errors.ts";

test("permission and not-found are fixed sentences", () => {
  assert.equal(failureMessage({ code: "42501", message: "permission denied for table contractors" }), NOT_PERMITTED);
  assert.match(failureMessage({ code: "P0002", message: "contractor not found" }), /could not be found/);
  assert.match(failureMessage({ code: "23505" }), /already exists/);
});

test("rule errors raised by our functions pass through when they read as plain English", () => {
  assert.equal(failureMessage({ code: "22023", message: "a note is required when a step is not applicable" }), "A note is required when a step is not applicable.");
  assert.equal(failureMessage({ code: "23514", message: "The vetting checklist is not complete." }), "The vetting checklist is not complete.");
});

test("anything that looks like SQL internals is replaced by the generic sentence", () => {
  assert.equal(failureMessage({ code: "23514", message: 'new row for relation "contractors" violates check constraint "x"' }), GENERIC_FAILURE);
  assert.equal(failureMessage({ code: "22023", message: "x".repeat(300) }), GENERIC_FAILURE);
  assert.equal(failureMessage({ code: "22023", message: "" }), GENERIC_FAILURE);
  assert.equal(failureMessage({ code: "22P02", message: "invalid input syntax for type uuid" }), GENERIC_FAILURE);
  assert.equal(failureMessage({ code: "XX000", message: "boom" }), GENERIC_FAILURE);
  assert.equal(failureMessage(null), GENERIC_FAILURE);
  assert.equal(failureMessage(undefined, "custom"), "custom");
});

test("only the code is loggable", () => {
  assert.equal(logCode({ code: "22023", message: "secret" }), "22023");
  assert.equal(logCode(null), "unknown");
});
