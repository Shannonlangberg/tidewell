import test from "node:test";
import assert from "node:assert/strict";
import { CALL_GROUPS, nextCalls, phoneWords, shortDate, type CallContact, type CallLead, type LastTouch } from "./next-calls.ts";

const TODAY = "2026-10-22";

let n = 0;
function contact(over: Partial<CallContact> = {}): CallContact {
  n += 1;
  return {
    id: `c${String(n).padStart(3, "0")}`,
    name: `Contact ${n}`,
    organisation: "Sample Realty",
    phone: "0400 000 000",
    kind: "partner",
    status: "contacted",
    priority: "medium",
    lastContact: "2026-10-15",
    nextFollowUp: null,
    added: "2026-09-01",
    ...over,
  };
}
function lead(over: Partial<CallLead> = {}): CallLead {
  n += 1;
  return {
    id: `l${String(n).padStart(3, "0")}`,
    ref: `LD-${n}`,
    name: `Lead ${n}`,
    phone: null,
    suburb: "Moonta",
    stage: "contacted",
    nextAction: "Call back",
    nextActionDue: "2026-10-30",
    lastActivity: "2026-10-20",
    added: "2026-10-01",
    contactId: null,
    newEnquiryRef: null,
    ...over,
  };
}
const touch = (over: Partial<LastTouch> = {}): LastTouch => ({ date: "2026-10-15", type: "phone_call", outcome: "spoke", callbackPromised: false, followUpDate: null, nextAction: null, ...over });

const run = (contacts: CallContact[], leads: CallLead[] = [], lastTouch: Record<string, LastTouch> = {}) => nextCalls({ today: TODAY, contacts, leads, lastTouch });

test("a follow-up set for a later day keeps a person off the list", () => {
  const r = run([contact({ nextFollowUp: "2026-10-25", lastContact: null })], [lead()]);
  assert.equal(r.calls.length, 0);
});

test("a warm lead idle for a week shows even with a later next action, and says when it is planned", () => {
  const r = run([], [lead({ stage: "appraisal_completed", nextActionDue: "2026-10-30", lastActivity: "2026-10-12" })]);
  assert.equal(r.calls[0]!.group, "warm");
  assert.equal(r.calls[0]!.why, "Appraisal completed, no activity since 12 Oct. Next action planned for 30 Oct.");
});

test("groups come in order: callback, overdue, today, warm, introduce, quiet", () => {
  const quiet = contact({ status: "active_relationship", lastContact: "2026-09-01" });
  const intro = contact({ lastContact: null, status: "identified" });
  const warm = lead({ stage: "appraisal_requested", nextActionDue: null, lastActivity: "2026-10-10" });
  const today = contact({ nextFollowUp: TODAY });
  const overdue = contact({ nextFollowUp: "2026-10-18" });
  const promised = contact({ nextFollowUp: "2026-10-21" });
  const r = run([quiet, intro, today, overdue, promised], [warm], { [`contact:${promised.id}`]: touch({ callbackPromised: true, followUpDate: "2026-10-21" }) });
  assert.deepEqual(r.calls.map((c) => c.group), ["callback", "overdue", "today", "warm", "introduce", "quiet"]);
  assert.equal(r.calls[0]!.why, "You promised to call back by 21 Oct. 1 day overdue.");
  assert.equal(r.calls[1]!.why, "Follow-up you set for 18 Oct, 4 days overdue.");
  assert.equal(r.calls[2]!.why, "Follow-up you set for today.");
  assert.equal(r.calls[3]!.why, "Appraisal requested, no activity since 10 Oct.");
  assert.equal(r.calls[4]!.why, "Medium priority, never contacted, added 1 Sep.");
  assert.equal(r.calls[5]!.why, "Active relationship, no contact for 51 days.");
  for (const g of CALL_GROUPS) assert.equal(r.counts[g], 1);
});

test("a promised callback whose follow-up was moved since is not a callback", () => {
  const c = contact({ nextFollowUp: "2026-10-28" });
  const r = run([c], [], { [`contact:${c.id}`]: touch({ callbackPromised: true, followUpDate: "2026-10-20" }) });
  assert.equal(r.calls.length, 0);
});

test("never-contacted partners: high priority first, then the oldest added, never by name", () => {
  const zed = contact({ name: "Aaron", lastContact: null, priority: "low", added: "2026-08-01" });
  const old = contact({ name: "Zoe", lastContact: null, priority: "high", added: "2026-09-02" });
  const newer = contact({ name: "Abe", lastContact: null, priority: "high", added: "2026-10-03" });
  const r = run([newer, zed, old]);
  assert.deepEqual(r.calls.map((c) => c.name), ["Zoe", "Abe", "Aaron"]);
  assert.equal(r.calls[0]!.why, "High priority, never contacted, added 2 Sep.");
});

test("landlords and other contacts never contacted are not 'introduce'", () => {
  const r = run([contact({ kind: "landlord", lastContact: null }), contact({ kind: "other", lastContact: null })]);
  assert.equal(r.calls.length, 0);
});

test("inactive contacts never appear", () => {
  const r = run([contact({ status: "inactive", nextFollowUp: "2026-10-01" })]);
  assert.equal(r.calls.length, 0);
});

test("quiet needs more than 30 days and a met, active or referring relationship", () => {
  const r = run([
    contact({ status: "met", lastContact: "2026-09-22" }), // exactly 30: not yet
    contact({ status: "met", lastContact: "2026-09-21" }),
    contact({ status: "contacted", lastContact: "2026-01-01" }),
  ]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.why, "Met, no contact for 31 days.");
});

test("a lead and its landlord contact are one person, shown as the lead", () => {
  const c = contact({ kind: "landlord", nextFollowUp: "2026-10-01" });
  const l = lead({ contactId: c.id, nextActionDue: TODAY, newEnquiryRef: "ENQ-0012" });
  const r = run([c], [l]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.kind, "lead");
  assert.equal(r.calls[0]!.why, "New website enquiry ENQ-0012: the reply is due today.");
});

test("an overdue lead quotes its next action", () => {
  const r = run([], [lead({ nextActionDue: "2026-10-20", nextAction: "Send the fee summary" })]);
  assert.equal(r.calls[0]!.why, "Lead next action was due 20 Oct, 2 days overdue: “Send the fee summary”.");
  assert.equal(r.calls[0]!.business, "Landlord, Moonta");
});

test("warm leads need a week without activity", () => {
  const r = run([], [lead({ stage: "proposal_sent", nextActionDue: null, lastActivity: "2026-10-16" }), lead({ stage: "qualified", nextActionDue: null, lastActivity: "2026-10-15" })]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0]!.why, "Qualified, no activity since 15 Oct.");
});

test("a lead's promised callback outranks its next action", () => {
  const l = lead({ nextActionDue: TODAY });
  const r = run([], [l], { [`lead:${l.id}`]: touch({ callbackPromised: true, followUpDate: TODAY, outcome: "left_message" }) });
  assert.equal(r.calls[0]!.group, "callback");
  assert.equal(r.calls[0]!.why, "You promised to call back today.");
  assert.deepEqual(r.calls[0]!.lastContact, { date: "2026-10-15", type: "phone_call", outcome: "left_message" });
});

test("within a dated group the earlier date comes first", () => {
  const later = contact({ nextFollowUp: "2026-10-20" });
  const earlier = contact({ nextFollowUp: "2026-10-10" });
  const r = run([later, earlier]);
  assert.deepEqual(r.calls.map((c) => c.id), [earlier.id, later.id]);
});

test("phone and date words", () => {
  assert.equal(phoneWords(null), "No number recorded");
  assert.equal(phoneWords("  "), "No number recorded");
  assert.equal(phoneWords("08 1234 5678"), "08 1234 5678");
  assert.equal(shortDate("2025-12-01", TODAY), "1 Dec 2025");
});
