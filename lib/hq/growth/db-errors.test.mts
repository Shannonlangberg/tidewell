import test from "node:test";
import assert from "node:assert/strict";
import { classifyDbError, logTag } from "./db-errors.ts";

const unique = (constraint: string) => ({ code: "23505", message: `duplicate key value violates unique constraint "${constraint}"` });

test("unique violations are told apart by constraint", () => {
  assert.equal(classifyDbError(unique("contacts_org_name_key_uq")), "duplicate_contact_name");
  assert.equal(classifyDbError(unique("contacts_email_uq")), "duplicate_contact_email");
  assert.equal(classifyDbError(unique("organisations_name_key_uq")), "duplicate_organisation_name");
  assert.equal(classifyDbError(unique("contacts_one_primary_uq")), "duplicate_primary");
  assert.equal(classifyDbError(unique("something_else")), "duplicate_other");
});

test("other codes map to a small set of kinds", () => {
  assert.equal(classifyDbError({ code: "42501", message: "permission denied" }), "permission");
  assert.equal(classifyDbError({ code: "P0002", message: "contact not found" }), "not_found");
  assert.equal(classifyDbError({ code: "PGRST116", message: "0 rows" }), "not_found");
  assert.equal(classifyDbError({ code: "PGRST103", message: "range" }), "range");
  assert.equal(classifyDbError({ code: "22023", message: "a summary is required" }), "invalid");
  assert.equal(classifyDbError({ code: "XX000", message: "boom" }), "other");
  assert.equal(classifyDbError(null), "other");
  assert.equal(classifyDbError(undefined), "other");
});

test("logTag carries the code and constraint name only, never the message body", () => {
  const tag = logTag({ code: "23505", message: 'duplicate key value violates unique constraint "contacts_email_uq"; Key (email)=(jo@example.com)' });
  assert.equal(tag, "23505 contacts_email_uq");
  assert.ok(!tag.includes("jo@example.com"));
  assert.equal(logTag({ code: "22023", message: "summary is: private words" }), "22023");
  assert.equal(logTag(null), "unknown");
});
