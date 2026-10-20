import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  CONTRACTOR_STATUSES,
  INTERACTION_TYPES,
  OPPORTUNITY_STAGES,
  PARTNER_CATEGORIES,
  PRIORITIES,
  RELATIONSHIP_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VETTING_STEPS,
} from "../../constants.ts";
import { TASK_VIEW_KEYS } from "../../tasks/rules.ts";
import { TENANT_FEEDBACK } from "../../contractors/reviews-form.ts";
import { GROWTH_PERIODS } from "../../referrals/periods.ts";
import { DECISION_CATEGORIES, DECISION_STATUSES, OPEN_DECISION_STATUSES } from "../../decisions/rules.ts";
import * as S from "./schemas.ts";

test("the vocabularies written out in schemas.ts match lib/hq/constants.ts and the modules that own them", () => {
  assert.deepEqual([...S.CONTRACTOR_STATUS_VALUES], [...CONTRACTOR_STATUSES]);
  assert.deepEqual([...S.PARTNER_CATEGORY_VALUES], [...PARTNER_CATEGORIES]);
  assert.deepEqual([...S.RELATIONSHIP_STATUS_VALUES], [...RELATIONSHIP_STATUSES]);
  assert.deepEqual([...S.PRIORITY_VALUES], [...PRIORITIES]);
  assert.deepEqual([...S.INTERACTION_TYPE_VALUES], [...INTERACTION_TYPES]);
  assert.deepEqual([...S.OPPORTUNITY_STAGE_VALUES], [...OPPORTUNITY_STAGES]);
  assert.deepEqual([...S.TASK_STATUS_VALUES], [...TASK_STATUSES]);
  assert.deepEqual([...S.TASK_PRIORITY_VALUES], [...TASK_PRIORITIES]);
  assert.deepEqual([...S.TASK_VIEW_VALUES], [...TASK_VIEW_KEYS]);
  assert.deepEqual([...S.SETTABLE_VETTING_STEPS], VETTING_STEPS.filter((s) => s !== "review_and_approve"));
  assert.deepEqual([...S.TENANT_FEEDBACK_VALUES], [...TENANT_FEEDBACK]);
  assert.deepEqual([...S.GROWTH_PERIOD_VALUES], [...GROWTH_PERIODS]);
  assert.deepEqual([...S.DECISION_CATEGORY_VALUES], [...DECISION_CATEGORIES]);
  assert.deepEqual([...S.DECISION_STATUS_VALUES], [...DECISION_STATUSES]);
  assert.deepEqual([...S.OPEN_DECISION_STATUS_VALUES], [...OPEN_DECISION_STATUSES]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every field of every tool says what it is", () => {
  assert.ok(shapes.length >= 29);
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) {
      assert.ok((schema as z.ZodType).description, `${name}.${field} has no description`);
    }
  }
});

const parse = (shape: z.ZodRawShape, args: unknown) => z.object(shape).safeParse(args);

test("arguments are checked before anything runs", () => {
  assert.equal(parse(S.searchShape, { query: "a" }).success, false, "search needs 2 characters");
  assert.equal(parse(S.searchShape, { query: "ab" }).success, true);
  assert.equal(parse(S.createTaskShape, {}).success, false, "a task needs a title");
  assert.equal(parse(S.createTaskShape, { title: "Call Jo", due_date: "15/10/2026" }).success, false, "dates are YYYY-MM-DD");
  assert.equal(parse(S.createTaskShape, { title: "Call Jo", due_date: "2026-10-15", priority: "urgent" }).success, true);
  assert.equal(parse(S.createTaskShape, { title: "Call Jo", priority: "whenever" }).success, false);
  assert.equal(parse(S.searchContractorsShape, { limit: 26 }).success, false, "lists are capped at 25");
  // Trades are the owner's list in hq.trades, so any name passes the schema and the tool resolves it (or lists the trades).
  assert.equal(parse(S.searchContractorsShape, { trade: "electricians" }).success, true);
  assert.equal(parse(S.searchContractorsShape, { trade: "x" }).success, false, "a trade name has at least 2 characters");
  assert.equal(parse(S.searchContractorsShape, { trade: "x".repeat(61) }).success, false);
  assert.equal(parse(S.searchContractorsShape, { not_used_days: 0 }).success, false, "not used in at least 1 day");
  assert.equal(parse(S.searchContractorsShape, { not_used_days: 90, sort: "last_used" }).success, true);
  assert.equal(parse(S.searchContractorsShape, { sort: "rating" }).success, false);
  assert.equal(parse(S.recordContractorJobShape, { contractor: "X", job_date: "12/10/2026" }).success, false, "dates are YYYY-MM-DD");
  assert.equal(parse(S.recordContractorJobShape, { contractor: "X" }).success, true, "the date defaults to today");
  assert.equal(parse(S.createContactShape, { full_name: "Jo", categories: [] }).success, false, "a contact needs a category");
  assert.equal(parse(S.updateContractorShape, { contractor: "X", hourly_rate: -5 }).success, false, "money is never negative");
  assert.equal(parse(S.recordContractorReviewShape, { contractor: "X", work_quality: 6 }).success, false, "ratings are 1 to 5");
  assert.equal(parse(S.setVettingStepShape, { contractor: "X", step: "review_and_approve", status: "done" }).success, false, "step 9 is approval, not settable");
  assert.equal(parse(S.logInteractionShape, { contact: "Jo", type: "phone_call", summary: "x", occurred_at: "2026-10-15 10:00" }).success, false);
  assert.equal(parse(S.updateTaskShape, { task: "x", due_date: "none" }).success, true, '"none" clears a due date');
});

test("move_opportunity accepts the full stage list so it can refuse signed and lost with a clear message", () => {
  assert.equal(parse(S.moveOpportunityShape, { opportunity: "REF-0001", stage: "management_signed" }).success, true);
  assert.equal(parse(S.moveOpportunityShape, { opportunity: "REF-0001", stage: "won" }).success, false);
});
