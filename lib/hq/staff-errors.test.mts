// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { staffErrorMessage } from "./staff-errors.ts";

const FALLBACK = "We could not do that.";

test("an unknown or missing error gets the caller's fallback", () => {
  assert.equal(staffErrorMessage(null, FALLBACK), FALLBACK);
  assert.equal(staffErrorMessage(undefined, FALLBACK), FALLBACK);
  assert.equal(staffErrorMessage({ code: "XX000", message: "boom" }, FALLBACK), FALLBACK);
});

test("director-only rules read clearly", () => {
  for (const message of ["only a director can create a director", "only a director can change a director", "only a director can deactivate a director", "only a director can make someone a director"]) {
    assert.equal(staffErrorMessage({ code: "42501", message }, FALLBACK), "Only a director can add, change or deactivate a director.");
  }
});

test("changing your own role or status, or deactivating yourself", () => {
  const a = staffErrorMessage({ code: "42501", message: "you cannot change your own role or employment status; ask another administrator" }, FALLBACK);
  const b = staffErrorMessage({ code: "42501", message: "you cannot deactivate yourself; ask another administrator" }, FALLBACK);
  assert.match(a, /own role or status/);
  assert.match(b, /own role or status/);
});

test("any other permission refusal", () => {
  assert.equal(staffErrorMessage({ code: "42501", message: "permission denied" }, FALLBACK), "You do not have permission to do that.");
});

test("the last active director", () => {
  const expected = "At least one active director must remain, so that change was not made.";
  assert.equal(staffErrorMessage({ code: "23514", message: "at least one active director must remain" }, FALLBACK), expected);
  assert.equal(staffErrorMessage({ code: null, message: "At least one active director must remain" }, FALLBACK), expected);
});

test("duplicates", () => {
  assert.equal(staffErrorMessage({ code: "23505", message: "that person already has an HQ profile" }, FALLBACK), "That person already has an HQ profile.");
  assert.equal(staffErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "pods_name_key"' }, FALLBACK), "A pod with that name already exists.");
});

test("not found and bad arguments", () => {
  assert.equal(staffErrorMessage({ code: "P0002", message: "staff member not found" }, FALLBACK), "We could not find that person.");
  assert.equal(staffErrorMessage({ code: "22023", message: "pod not found or inactive" }, FALLBACK), "That pod is not available. Choose another.");
  assert.equal(staffErrorMessage({ code: "22023", message: "unknown timezone" }, FALLBACK), "That timezone is not recognised.");
  assert.equal(staffErrorMessage({ code: "22023", message: "user, email, full name and role are required" }, FALLBACK), "Check the details and try again.");
});

test("the database's own words are never passed through", () => {
  const out = staffErrorMessage({ code: "22023", message: "secret detail about someone@example.com" }, FALLBACK);
  assert.equal(out.includes("someone@example.com"), false);
});
