import test from "node:test";
import assert from "node:assert/strict";
import { scoreTask, weightWords, whyLine } from "../leadership/rules.ts";
import { PRIORITY_MAX, asScorable, rankPriorities, type PriorityInput } from "./priorities.ts";

const TODAY = "2026-11-03";
const explain = { why: whyLine, weight: weightWords };
const hrefs = { lead: (id: string) => `/lead/${id}`, decision: (id: string) => `/decision/${id}`, enquiry: (id: string) => `/enquiry/${id}` };
const base: PriorityInput = { tasks: [], leads: [], decisions: [], enquiries: [], hrefs };

test("one ranking: an overdue lead follow-up scores exactly as the same task would", () => {
  const lead = { id: "l1", ref: "LEAD-0001", prospect: "J. Citizen", nextAction: "Call back", due: "2026-10-31", ownerName: "Shannon", stage: "contacted", missingOwner: false };
  const [p] = rankPriorities({ ...base, leads: [lead] }, TODAY, scoreTask, explain);
  const same = scoreTask(asScorable({ id: "l1", title: "x", priority: "normal", dueDate: "2026-10-31", pipeline: true }), TODAY);
  assert.equal(p.score, same.score);
  assert.equal(p.kind, "lead");
  assert.equal(p.title, "Call back: J. Citizen");
  assert.match(p.why, /Overdue by 3 days/);
  assert.equal(p.href, "/lead/l1");
});

test("mixed kinds are ordered by the score; at most five; nothing is invented when there is nothing", () => {
  assert.deepEqual(rankPriorities(base, TODAY, scoreTask, explain), []);
  const task = asScorable({ id: "t1", title: "Engage the accountant", priority: "urgent", dueDate: "2026-11-01" });
  const quiet = asScorable({ id: "t2", title: "Tidy the drive", priority: "low" });
  const input: PriorityInput = {
    ...base,
    tasks: [{ task: quiet, href: "/t/t2" }, { task, href: "/t/t1" }],
    leads: [{ id: "l1", ref: "LEAD-0001", prospect: "A", nextAction: null, due: "2026-11-03", ownerName: null, stage: "contacted", missingOwner: true }],
    decisions: [{ id: "d1", ref: "DEC-0001", title: "Choose the trust bank" }],
    enquiries: [{ id: "e1", ref: "ENQ-0001", name: "B", receivedOn: "2026-10-30", kind: "appraisal" }],
  };
  const ranked = rankPriorities(input, TODAY, scoreTask, explain);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[0].id, "t1", "urgent and overdue first");
  assert.equal(ranked[ranked.length - 1].id, "t2", "a low task with no date comes last");
  assert.ok(ranked.every((p, i) => i === 0 || ranked[i - 1].score >= p.score));
  assert.match(ranked.find((p) => p.kind === "lead")!.why, /No owner/);
  assert.match(ranked.find((p) => p.kind === "decision")!.why, /Waiting on your decision/);
  assert.equal(rankPriorities(input, TODAY, scoreTask, explain, 2).length, 2);
  assert.equal(PRIORITY_MAX, 5);
});
