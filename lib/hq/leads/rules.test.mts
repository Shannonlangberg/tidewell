// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { FormReader } from "../forms.ts";
import { LEAD_SOURCE_VALUES, LOST_REASON_VALUES, CONTACT_KIND_VALUES } from "../mcp/tools/schemas.ts";
import { PIPELINE_SOURCES } from "../referrals/params.ts";
import {
  CONTACT_KINDS,
  DIRECT_LEAD_SOURCES,
  LEAD_SOURCES,
  LOST_REASONS,
  addDaysIso,
  attentionText,
  classifyLeadError,
  dueState,
  dueText,
  initials,
  leadFieldError,
  leadRef,
  parseContactKindFilter,
  parseDuplicate,
  readLeadFields,
} from "./rules.ts";

const TODAY = "2026-10-20";
const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("the lead vocabularies match the database enums and the MCP schemas", () => {
  assert.deepEqual([...LEAD_SOURCES], ["website_enquiry", "referral_partner", "own_marketing", "direct_approach", "other"]);
  assert.deepEqual([...LOST_REASONS], ["price", "chose_another_manager", "self_managing", "not_ready", "unresponsive", "out_of_area", "other"]);
  assert.deepEqual([...CONTACT_KINDS], ["partner", "landlord", "other"]);
  assert.deepEqual([...LEAD_SOURCE_VALUES], [...LEAD_SOURCES]);
  assert.deepEqual([...LOST_REASON_VALUES], [...LOST_REASONS]);
  assert.deepEqual([...CONTACT_KIND_VALUES], [...CONTACT_KINDS]);
  assert.deepEqual([...PIPELINE_SOURCES], [...LEAD_SOURCES]);
  assert.ok(!DIRECT_LEAD_SOURCES.includes("referral_partner"), "a lead added by hand never claims a referral partner");
});

test("a lead's reference, initials and dates", () => {
  assert.equal(leadRef(7), "LEAD-0007");
  assert.equal(leadRef(12345), "LEAD-12345");
  assert.equal(initials("Jane Citizen"), "JC");
  assert.equal(initials("Mary Anne van Dyke"), "MD");
  assert.equal(initials("Cher"), "CH");
  assert.equal(initials(""), "?");
  assert.equal(addDaysIso(TODAY, 1), "2026-10-21");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(dueState("2026-10-19", TODAY), "overdue");
  assert.equal(dueState(TODAY, TODAY), "today");
  assert.equal(dueState("2026-10-27", TODAY), "soon");
  assert.equal(dueState("2026-10-28", TODAY), "later");
  assert.equal(dueText("2026-10-19", TODAY), "1 day overdue");
  assert.equal(dueText("2026-10-10", TODAY), "10 days overdue");
  assert.equal(dueText(TODAY, TODAY), "Due today");
  assert.equal(dueText("2026-10-21", TODAY), "Due tomorrow");
  assert.equal(dueText("2026-12-01", TODAY), null);
});

test("why a lead needs attention", () => {
  const ok = { assignedTo: STAFF, nextAction: "Call", nextActionDue: TODAY, open: true };
  assert.equal(attentionText(ok, TODAY), null, "due today is not overdue");
  assert.equal(attentionText({ ...ok, nextActionDue: "2026-10-19" }, TODAY), "Follow-up overdue");
  assert.equal(attentionText({ ...ok, assignedTo: null }, TODAY), "No owner");
  assert.equal(attentionText({ ...ok, nextAction: null }, TODAY), "No next step");
  assert.equal(attentionText({ ...ok, assignedTo: null, open: false }, TODAY), null, "a closed lead never needs attention");
});

test("the add-a-lead form: required fields, the owner defaults to the caller", () => {
  const f = new FormReader(form({ prospect_name: "Jane Citizen", prospect_phone: "0400 000 000", source: "own_marketing", next_action: "Call to book an appraisal", next_action_due: "2026-10-21", estimated_value: "3,200" }));
  const v = readLeadFields(f, { today: TODAY, staffId: STAFF });
  assert.equal(f.ok, true, JSON.stringify(f.errors));
  assert.equal(v.assignedTo, STAFF);
  assert.equal(v.estimateCents, 320000);
  assert.equal(v.source, "own_marketing");
  assert.equal(v.confirmDistinct, false);

  const g = new FormReader(form({ prospect_name: " ", source: "referral_partner", next_action: "", next_action_due: "2026-10-19", expected_close_date: "2030-01-01", assigned_to: OTHER }));
  const w = readLeadFields(g, { today: TODAY, staffId: STAFF });
  assert.ok(g.errors.prospect_name);
  assert.match(g.errors.source, /recorded as a referral/);
  assert.ok(g.errors.next_action);
  assert.equal(g.errors.next_action_due, "Choose today or a later date.");
  assert.equal(g.errors.expected_close_date, "Choose a date within the next three years.");
  assert.equal(w.assignedTo, OTHER);

  const h = new FormReader(form({ prospect_name: "x", source: "other", next_action: "x" }));
  readLeadFields(h, { today: TODAY, staffId: STAFF });
  assert.equal(h.errors.next_action_due, "A date is required.");
  const far = new FormReader(form({ prospect_name: "x", source: "other", next_action: "x", next_action_due: "2029-01-01" }));
  readLeadFields(far, { today: TODAY, staffId: STAFF });
  assert.equal(far.errors.next_action_due, "Choose a date within the next two years.");
});

test("database refusals are classified, never shown raw", () => {
  assert.equal(classifyLeadError({ code: "42501", message: "permission denied" }), "permission");
  assert.equal(classifyLeadError({ code: "23505", message: "a lead or landlord with these details is already in HQ", hint: "possible_duplicate" }), "duplicate");
  assert.equal(classifyLeadError({ code: "22023", message: "x", hint: "use_record_referral" }), "use_referral");
  assert.equal(classifyLeadError({ code: "22023", message: "x", hint: "source_is_referral" }), "source_is_referral");
  assert.equal(classifyLeadError({ code: "22023", message: "the lead owner must be an active member of staff" }), "owner_inactive");
  assert.equal(classifyLeadError({ code: "22023", message: "the follow-up date must be from today to two years ahead" }), "follow_up_range");
  assert.equal(classifyLeadError({ code: "22023", message: "a lost opportunity needs a reason code", hint: "lost_reason_code_required" }), "lost_code_required");
  assert.equal(classifyLeadError({ code: "23514", message: "x", hint: "lead_stale" }), "stale");
  assert.equal(classifyLeadError({ code: "23514", message: "x", hint: "lead_needs_next_step" }), "lead_rule");
  assert.equal(classifyLeadError({ code: "P0002", message: "opportunity not found" }), "not_found");
  assert.equal(classifyLeadError({ code: "XX000", message: "boom" }), "other");
  assert.equal(leadFieldError("owner_inactive")?.field, "assigned_to");
  assert.equal(leadFieldError("permission"), null);
});

test("a duplicate refusal names the record it matched", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  assert.deepEqual(parseDuplicate(`opportunity:${id}:phone`), { kind: "opportunity", id, reason: "phone" });
  assert.deepEqual(parseDuplicate(`contact:${id}:name_suburb`), { kind: "contact", id, reason: "name_suburb" });
  assert.equal(parseDuplicate("Key (email)=(x) already exists"), null);
  assert.equal(parseDuplicate(null), null);
});

test("the contacts list shows partners unless asked otherwise", () => {
  assert.equal(parseContactKindFilter(undefined), "partner");
  assert.equal(parseContactKindFilter("landlord"), "landlord");
  assert.equal(parseContactKindFilter("all"), "all");
  assert.equal(parseContactKindFilter("nonsense"), "partner");
});
