// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { normaliseName } from "../../growth/params.ts";
import { clean } from "./core.ts";
import {
  assignRefs,
  bulkCreateText,
  bulkLimitText,
  bulkUpdateText,
  firstOpenBlockers,
  matchNamed,
  matchStaff,
  nameProblemsText,
  parseBulkOutcome,
  problemFor,
  readBudgetDetail,
  type DepTask,
} from "./bulk-core.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ME = { id: A, label: "Courtney Langberg", detail: "you" };
const STAFF = [
  { id: A, full_name: "Courtney Langberg", first_name: "Courtney", role: "director" },
  { id: B, full_name: "Sam Hill", first_name: "Sam", role: "virtual_assistant" },
  { id: C, full_name: "Sam Rivers", first_name: "Sam", role: "property_manager" },
];

test("refs: the entry's own, else its position; duplicates (any case) are found", () => {
  assert.deepEqual(assignRefs([{ ref: "a" }, {}, { ref: " c " }]), { refs: ["a", "2", "c"], duplicates: [] });
  assert.deepEqual(assignRefs([{ ref: "a" }, { ref: "A" }, {}]).duplicates, ["a", "A"]);
});

test("staff names resolve in one pass with the usual rules, never guessing", () => {
  assert.deepEqual(matchStaff(STAFF, "me", ME, normaliseName), { kind: "one", record: ME, how: "exact" });
  assert.equal(matchStaff(STAFF, "nobody", ME, normaliseName).kind, "nobody");
  const full = matchStaff(STAFF, "  sam   HILL ", ME, normaliseName);
  assert.ok(full.kind === "one" && full.record.id === B);
  const byId = matchStaff(STAFF, C.toUpperCase(), ME, normaliseName);
  assert.ok(byId.kind === "one" && byId.record.id === C && byId.how === "id");
  const sam = matchStaff(STAFF, "Sam", ME, normaliseName);
  assert.ok(sam.kind === "many" && sam.candidates.length === 2 && sam.how === "exact", "two people called Sam: candidates");
  const close = matchStaff(STAFF, "Rivers", ME, normaliseName);
  assert.ok(close.kind === "many" && close.candidates.length === 1 && close.how === "close", "a single close match is a candidate, not accepted");
  assert.equal(matchStaff(STAFF, "Zed", ME, normaliseName).kind, "none");
  assert.equal(matchStaff(STAFF, "99999999-9999-4999-8999-999999999999", ME, normaliseName).kind, "none", "an id that is not an active staff member");
});

test("named records (contacts, organisations, projects) resolve against rows loaded once", () => {
  const rows = [
    { id: A, label: "Alpha Realty", key: normaliseName("Alpha Realty") },
    { id: B, label: "Alpha Realty Pty Ltd (Moonta)", key: normaliseName("Alpha Realty") },
    { id: C, label: "Beta Brokers", key: normaliseName("Beta Brokers") },
  ];
  const beta = matchNamed(rows, "the beta brokers", normaliseName);
  assert.ok(beta.kind === "one" && beta.record.id === C);
  const alpha = matchNamed(rows, "Alpha Realty", normaliseName);
  assert.ok(alpha.kind === "many" && alpha.candidates.length === 2);
  const close = matchNamed(rows, "Bet", normaliseName);
  assert.ok(close.kind === "many" && close.how === "close");
  assert.equal(matchNamed(rows, "Gamma", normaliseName).kind, "none");
});

test("unresolved names come back as ONE refusal listing every problem and its candidates", () => {
  const p1 = problemFor("assignee", "active staff member", "Sam", matchStaff(STAFF, "Sam", ME, normaliseName), { index: 2, ref: "t3" });
  const p2 = problemFor("project", "project", "Lanch", { kind: "none" }, { index: null, ref: null });
  assert.ok(p1 && p2);
  assert.equal(problemFor("assignee", "x", "me", matchStaff(STAFF, "me", ME, normaliseName), { index: 0, ref: null }), null);
  const t = nameProblemsText([p1, p2], clean);
  assert.match(t.head, /Nothing was created or changed/);
  assert.match(t.head, /idempotency key was NOT used/);
  assert.ok(t.data.some((l) => l.includes("entry 3 (t3), assignee") && l.includes("2 active staff members match")));
  assert.ok(t.data.some((l) => l.includes(`[id: ${B}]`)));
  assert.ok(t.data.some((l) => l.startsWith("- the call, project: no project matching")));
});

test("the RPC result is read defensively", () => {
  assert.equal(parseBulkOutcome(null), null);
  assert.equal(parseBulkOutcome({ created: [] }), null, "needs failed too");
  const o = parseBulkOutcome({
    created: [{ index: 0, ref: "t1", id: A }, { index: "1", ref: "t2", id: B }, { index: 2 }],
    failed: [{ index: 3, ref: "t4", errors: ["Title is required.", 5] }, { index: 4, ref: null }],
    duplicate: false,
    created_count: 2,
    failed_count: 2,
  });
  assert.ok(o);
  assert.equal(o.created.length, 2, "an entry without an id is dropped");
  assert.deepEqual(o.failed[0].errors, ["Title is required."]);
  assert.equal(o.failed[1].errors.length, 1, "a failure always has a reason");
  assert.equal(parseBulkOutcome({ updated: [{ index: 0, id: A }], failed: [], updated_count: 1 })?.createdCount, 1);
});

const fmt = { clean, url: (id: string) => `http://hq/t/${id}` };
const lines = [
  { index: 0, ref: "t1", title: "Book the licensing course" },
  { index: 1, ref: "t2", title: "Enrol" },
  { index: 2, ref: "t3", title: "Sit the exam" },
];

test("the answer reports the database's counts honestly, a table of what was created, and every failure", () => {
  const o = parseBulkOutcome({ created: [{ index: 0, ref: "t1", id: A }], failed: [{ index: 1, ref: "t2", errors: ["The due date is not a real date."] }, { index: 2, ref: "t3", errors: ["depends on t2, which failed"] }], duplicate: false, created_count: 1, failed_count: 2 })!;
  const t = bulkCreateText(o, { lines, total: 3, atomic: false, where: "PRJ-0001 Launch" }, fmt);
  assert.equal(t.head[0], "Created 1 of 3 tasks in PRJ-0001 Launch; 2 failed (reasons below, nothing was created for them).");
  assert.deepEqual(t.data, [`- t1 | Book the licensing course | id ${A} | http://hq/t/${A}`]);
  assert.ok(t.tail.includes("- entry 3 (t3): depends on t2, which failed"));
  assert.ok(t.tail.some((l) => /NEW idempotency key/.test(l)));
});

test("a replay says so and that nothing new was created; all-or-nothing says nothing was written", () => {
  const replay = parseBulkOutcome({ created: [{ index: 0, ref: "t1", id: A }], failed: [], duplicate: true, created_count: 1, failed_count: 0 })!;
  assert.match(bulkCreateText(replay, { lines, total: 1, atomic: false, where: null }, fmt).head[0], /NOTHING new was created/);
  const atomic = parseBulkOutcome({ created: [], failed: [{ index: 1, errors: ["bad"] }], duplicate: false, created_count: 0, failed_count: 1 })!;
  assert.match(bulkCreateText(atomic, { lines, total: 3, atomic: true, where: null }, fmt).head[0], /^Created 0 of 3 tasks \(all or nothing/);
  const upd = parseBulkOutcome({ updated: [{ index: 0, id: A }], failed: [{ index: 1, errors: ["You can't change this task."] }], updated_count: 1, failed_count: 1 })!;
  const u = bulkUpdateText(upd, { lines, total: 2, atomic: false }, fmt);
  assert.match(u.head[0], /^Updated 1 of 2 tasks; 1 failed/);
  assert.ok(u.tail.some((l) => l.includes("You can't change this task.")));
});

test("the bulk budget refusal is honest: what is left and when to retry, never invented", () => {
  const info = readBudgetDetail(JSON.stringify({ calls_used: 6, calls_limit: 6, items_used: 120, items_limit: 300, retry_at: "2026-10-20T11:30:00Z" }));
  assert.deepEqual(info, { callsUsed: 6, callsLimit: 6, itemsUsed: 120, itemsLimit: 300, retryAt: "2026-10-20T11:30:00Z" });
  const t = bulkLimitText(info, 30, () => "11:30 am");
  assert.match(t, /nothing was written/);
  assert.match(t, /6 of 6 used in the last hour \(0 left\)/);
  assert.match(t, /Try again after 11:30 am/);
  const items = bulkLimitText({ callsUsed: 2, callsLimit: 6, itemsUsed: 290, itemsLimit: 300, retryAt: null }, 30, () => "");
  assert.match(items, /at most 10 would fit now/);
  assert.match(items, /rolling hour/);
  assert.deepEqual(readBudgetDetail("6 of 6 calls used in the last hour"), { callsUsed: 6, callsLimit: 6, itemsUsed: null, itemsLimit: null, retryAt: null }, "the RPC's own detail");
  assert.deepEqual(readBudgetDetail("290 of 300 items used in the last hour"), { callsUsed: null, callsLimit: null, itemsUsed: 290, itemsLimit: 300, retryAt: null });
  assert.deepEqual(readBudgetDetail("calls_used=3, calls_limit=6"), { callsUsed: 3, callsLimit: 6, itemsUsed: null, itemsLimit: null, retryAt: null });
  const unknown = bulkLimitText(readBudgetDetail(null), 5, () => "");
  assert.doesNotMatch(unknown, /\d+ of \d+/, "no figures are invented when the database gave none");
});

test("first open blockers follow the chain to the work that unblocks the rest", () => {
  const t = (id: string, status = "to_do"): DepTask => ({ id, title: id, status, due: null, assignee: null, projectId: null });
  // launch <- website <- copy ; launch <- licence (done) ; launch <- insurance <- hidden
  const tasks = new Map([["launch", t("launch")], ["website", t("website")], ["copy", t("copy", "in_progress")], ["licence", t("licence", "completed")], ["insurance", t("insurance")]]);
  const deps = new Map<string, string[]>([["launch", ["website", "licence", "insurance"]], ["website", ["copy"]], ["insurance", ["secret"]]]);
  const r = firstOpenBlockers(["launch", "website"], deps, tasks);
  assert.deepEqual(r.get("launch")?.roots, ["copy"]);
  assert.equal(r.get("launch")?.hidden, 1, "a dependency this person cannot see is counted, not named");
  assert.deepEqual(r.get("website")?.roots, ["copy"]);
  // a cycle in bad data cannot loop forever
  const loop = firstOpenBlockers(["x"], new Map([["x", ["y"]], ["y", ["x"]]]), new Map([["x", t("x")], ["y", t("y")]]));
  assert.ok(loop.has("x"));
});
