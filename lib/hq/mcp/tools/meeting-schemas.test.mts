// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { MEETING_TYPES, MINUTES_MAX } from "../../meetings/rules.ts";
import { EDIT_OPS } from "../../knowledge/edits.ts";
import { TASK_PRIORITIES } from "../../constants.ts";
import { DECISION_CATEGORIES, OPEN_DECISION_STATUSES } from "../../decisions/rules.ts";
import * as S from "./meeting-schemas.ts";

test("the meeting vocabulary matches lib/hq/meetings, knowledge edits, tasks and decisions", () => {
  assert.deepEqual([...S.MEETING_TYPE_VALUES], [...MEETING_TYPES]);
  assert.deepEqual([...S.MINUTES_EDIT_OP_VALUES], [...EDIT_OPS]);
  assert.deepEqual([...S.ACTION_PRIORITY_VALUES], [...TASK_PRIORITIES]);
  assert.deepEqual([...S.DECISION_CATEGORY_VALUES_FOR_MEETINGS], [...DECISION_CATEGORIES]);
  assert.deepEqual([...S.OPEN_DECISION_STATUS_VALUES_FOR_MEETINGS], [...OPEN_DECISION_STATUSES]);
});

const shapes = Object.entries(S).filter(([k, v]) => k.endsWith("Shape") && v && typeof v === "object") as Array<[string, z.ZodRawShape]>;

test("every meeting tool field is described", () => {
  assert.equal(shapes.length, 8);
  for (const [name, shape] of shapes) {
    for (const [field, schema] of Object.entries(shape)) assert.ok((schema as z.ZodTypeAny).description, `${name}.${field} has no description`);
  }
});

test("create_meeting needs a title, a kind, when and a summary; the minutes are capped", () => {
  const create = z.object(S.createMeetingShape);
  const ok = { title: "Coffee with Tim", type: "partner_referral", held_at: "2026-10-20", summary: "Tim will refer." };
  assert.equal(create.safeParse(ok).success, true);
  assert.equal(create.safeParse({ ...ok, summary: undefined }).success, false);
  assert.equal(create.safeParse({ ...ok, type: "party" }).success, false);
  assert.equal(create.safeParse({ ...ok, minutes: "m".repeat(MINUTES_MAX) }).success, true);
  assert.equal(create.safeParse({ ...ok, minutes: "m".repeat(MINUTES_MAX + 1) }).success, false);
  assert.equal(create.safeParse({ ...ok, attendees: ["me", { name: "Tim from the bank", kind: "external" }] }).success, true);
  assert.equal(create.safeParse({ ...ok, attendees: [{ name: "x", kind: "alien" }] }).success, false);
  assert.equal(create.safeParse({ ...ok, linked: [{ kind: "lead", name: "LEAD-0001" }] }).success, true);
  assert.equal(create.safeParse({ ...ok, linked: [{ kind: "decision", name: "DEC-0001" }] }).success, false);
  assert.equal(create.safeParse({ ...ok, actions: [{ title: "Send fees", assignee: "me", due: "2026-10-23" }] }).success, true);
  assert.equal(create.safeParse({ ...ok, actions: [{ title: "Send fees", due: "Friday" }] }).success, false);
  assert.equal(create.safeParse({ ...ok, attendees: Array.from({ length: 41 }, () => "x") }).success, false);
});

test("every change needs a change note, and the descriptions tell the assistant not to invent", () => {
  const upd = z.object(S.updateMeetingShape);
  assert.equal(upd.safeParse({ meeting: "MTG-0001", summary: "x" }).success, false);
  assert.equal(upd.safeParse({ meeting: "MTG-0001", summary: "x", change_note: "Fixed a name" }).success, true);
  assert.equal(upd.safeParse({ meeting: "MTG-0001", change_note: "x", minutes_edit: { op: "append_section", heading: "Next steps", text: "- Call Tim" } }).success, true);
  assert.equal(upd.safeParse({ meeting: "MTG-0001", change_note: "x", minutes_edit: { op: "delete_everything" } }).success, false);
  assert.match(S.createMeetingShape.minutes.description ?? "", /never add facts/);
  assert.match(S.createMeetingShape.minutes.description ?? "", /not paste a raw transcript/i);
  assert.match(S.createMeetingShape.summary.description ?? "", /2 to 3/);
});
