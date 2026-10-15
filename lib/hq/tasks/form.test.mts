import test from "node:test";
import assert from "node:assert/strict";
import { FormReader } from "../forms.ts";
import { readTaskFields } from "./rules.ts";

function readTaskForm(formData: FormData) {
  const reader = new FormReader(formData);
  const values = readTaskFields(reader);
  return { reader, values };
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("a minimal form is valid: only the title is required, priority falls back to normal", () => {
  const { reader, values } = readTaskForm(form({ title: "Call the broker" }));
  assert.equal(reader.ok, true);
  assert.equal(values.title, "Call the broker");
  assert.equal(values.priority, "normal");
  assert.equal(values.description, null);
  assert.equal(values.dueDate, null);
  assert.equal(values.assignedTo, null);
  assert.equal(values.contactId, null);
});

test("a full form reads every field", () => {
  const { reader, values } = readTaskForm(
    form({
      title: "  Send the appraisal  ",
      description: "Two pages.",
      due_date: "2026-10-20",
      priority: "urgent",
      assigned_to: A.toUpperCase(),
      related_contact_id: A,
      related_organisation_id: A,
      related_referral_id: A,
      related_opportunity_id: A,
    }),
  );
  assert.equal(reader.ok, true);
  assert.equal(values.title, "Send the appraisal");
  assert.equal(values.dueDate, "2026-10-20");
  assert.equal(values.priority, "urgent");
  assert.equal(values.assignedTo, A);
  assert.equal(values.contactId, A);
  assert.equal(values.referralId, A);
  assert.equal(values.opportunityId, A);
});

test("the title is required and limited to 200 characters", () => {
  assert.equal(readTaskForm(form({ title: "" })).reader.errors.title, "Title is required.");
  assert.equal(readTaskForm(form({ title: "   " })).reader.errors.title, "Title is required.");
  assert.equal(readTaskForm(form({})).reader.errors.title, "Title is required.");
  assert.equal(readTaskForm(form({ title: "x".repeat(200) })).reader.ok, true);
  assert.match(readTaskForm(form({ title: "x".repeat(201) })).reader.errors.title, /200 characters or fewer/);
});

test("the description is limited", () => {
  assert.equal(readTaskForm(form({ title: "t", description: "x".repeat(4000) })).reader.ok, true);
  assert.match(readTaskForm(form({ title: "t", description: "x".repeat(4001) })).reader.errors.description, /4000 characters/);
});

test("a bad date, priority or id is a field error", () => {
  assert.ok(readTaskForm(form({ title: "t", due_date: "2026-02-30" })).reader.errors.due_date);
  assert.ok(readTaskForm(form({ title: "t", due_date: "next week" })).reader.errors.due_date);
  assert.ok(readTaskForm(form({ title: "t", priority: "critical" })).reader.errors.priority);
  assert.ok(readTaskForm(form({ title: "t", assigned_to: "me" })).reader.errors.assigned_to);
  assert.ok(readTaskForm(form({ title: "t", related_contact_id: "1; drop table" })).reader.errors.related_contact_id);
  assert.ok(readTaskForm(form({ title: "t", related_organisation_id: "x" })).reader.errors.related_organisation_id);
  assert.ok(readTaskForm(form({ title: "t", related_referral_id: "x" })).reader.errors.related_referral_id);
  assert.ok(readTaskForm(form({ title: "t", related_opportunity_id: "x" })).reader.errors.related_opportunity_id);
});

test("a created_by field in the post is never read", () => {
  const { values } = readTaskForm(form({ title: "t", created_by: A, completed_by: A, status: "completed", source: "ai_draft" }));
  assert.deepEqual(Object.keys(values).sort(), [
    "assignedTo",
    "contactId",
    "contractorId",
    "description",
    "dueDate",
    "opportunityId",
    "organisationId",
    "priority",
    "referralId",
    "title",
  ]);
});

test("a blank assignee means unassigned", () => {
  const { reader, values } = readTaskForm(form({ title: "t", assigned_to: "" }));
  assert.equal(reader.ok, true);
  assert.equal(values.assignedTo, null);
});
