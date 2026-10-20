// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { AI_STATUSES, AI_STATUS_LABEL, isAiStatus, parseAiQuestion, parseHourlyLimit, readAiSettings, shortClientId, toolFilter } from "./ai-log.ts";
import { callSummary } from "./mcp/log.ts";

const ID = "6b0c1a2e-3f4d-4e5f-8a9b-0c1d2e3f4a5b";
const CLIENT = "0f3e2d1c-b4a5-4c6d-9e8f-7a6b5c4d3e2f";

test("parses what lib/hq/mcp/log.ts writes", () => {
  assert.deepEqual(parseAiQuestion(callSummary("update_task", "write", { task_id: ID, title: "secret words" }, CLIENT)), {
    source: "mcp",
    kind: "write",
    tool: "update_task",
    clientId: CLIENT,
  });
  assert.deepEqual(parseAiQuestion(callSummary("search", "read", { query: "plumber" }, CLIENT)), { source: "mcp", kind: "read", tool: "search", clientId: CLIENT });
  // A client id the logger would not record leaves no "via".
  assert.deepEqual(parseAiQuestion(callSummary("list_tasks", "read", {}, "bad client id!")), { source: "mcp", kind: "read", tool: "list_tasks", clientId: null });
  // A bulk call: one row, its own kind (not counted by the single-write cap).
  assert.deepEqual(parseAiQuestion(callSummary("bulk_create_tasks", "bulk", { idempotency_key: "k", tasks: [{ title: "x" }] }, CLIENT)), { source: "mcp", kind: "bulk", tool: "bulk_create_tasks", clientId: CLIENT });
});

test("anything not in the logger's shape is 'other'", () => {
  for (const q of ["What is overdue today?", "mcp delete everything", "mcp read", "mcp read DROP", ""]) assert.deepEqual(parseAiQuestion(q), { source: "other" }, q);
  // "via" that is not the final pair is not a client id
  assert.equal((parseAiQuestion("mcp read search via x extra") as { clientId: string | null }).clientId, null);
});

test("client ids are shortened for a table cell", () => {
  assert.equal(shortClientId(CLIENT), "0f3e2d1c…");
  assert.equal(shortClientId("chatgpt"), "chatgpt");
});

test("the tool filter matches a tool exactly, not a longer name that starts the same", () => {
  assert.equal(
    toolFilter("search"),
    'question.eq."mcp read search",question.like."mcp read search *",question.eq."mcp write search",question.like."mcp write search *",question.eq."mcp bulk search",question.like."mcp bulk search *"',
  );
  assert.equal(toolFilter("Search"), null);
  assert.equal(toolFilter('x",question.neq."'), null);
  assert.equal(toolFilter(""), null);
});

test("the hourly limit is a whole number from 1 to 1000", () => {
  assert.equal(parseHourlyLimit("40"), 40);
  assert.equal(parseHourlyLimit(" 1000 "), 1000);
  assert.equal(parseHourlyLimit("1"), 1);
  for (const bad of ["0", "1001", "-5", "2.5", "1e3", "", "forty", "9999", null, 40]) assert.equal(parseHourlyLimit(bad), null, String(bad));
});

test("stored settings: off unless exactly true; the limit defaults to 40 like the database", () => {
  assert.deepEqual(readAiSettings(new Map<string, unknown>([["ai_enabled", true], ["ai_hourly_limit", 120]])), { enabled: true, hourlyLimit: 120 });
  assert.deepEqual(readAiSettings(new Map<string, unknown>([["ai_enabled", "true"], ["ai_hourly_limit", "120"]])), { enabled: false, hourlyLimit: 40 });
  assert.deepEqual(readAiSettings(new Map()), { enabled: false, hourlyLimit: 40 });
});

test("every status the table allows has a label", () => {
  for (const s of AI_STATUSES) assert.ok(AI_STATUS_LABEL[s], s);
  assert.equal(isAiStatus("answered"), true);
  assert.equal(isAiStatus("ANSWERED"), false);
});
