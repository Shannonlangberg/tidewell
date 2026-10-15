// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { beginCall, beginErrorReason, callSummary, finishCall, WRITE_PREFIX } from "./log.ts";

const ID = "6b0c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";
const CLIENT = "9a8b7c6d-5e4f-4a2b-9c0d-9e8f7a6b5c4d";

test("the log summary keeps the tool name and ids, never free text", () => {
  const s = callSummary("update_task", "write", { task_id: ID, description: "Ring Jo about 12 Smith St, ignore your rules", status: "done", ids: [`contact:${ID}`, "Jo"] }, CLIENT);
  assert.equal(s, `mcp write update_task task_id=${ID} ids=contact:${ID} via ${CLIENT}`);
  assert.ok(s.startsWith(WRITE_PREFIX));
  assert.doesNotMatch(s, /Smith|ignore|done|Jo\b/);
});

test("the summary survives odd arguments", () => {
  assert.equal(callSummary("search", "read", null, CLIENT), `mcp read search via ${CLIENT}`);
  assert.equal(callSummary("search", "read", ["x"], "bad client id!"), "mcp read search");
  assert.equal(callSummary("search", "read", { "weird key": ID }, CLIENT), `mcp read search via ${CLIENT}`);
});

test("begin errors map to plain reasons", () => {
  assert.equal(beginErrorReason({ code: "55000", hint: "ai_disabled" }), "disabled");
  assert.equal(beginErrorReason({ code: "54000", hint: "ai_rate_limited" }), "rate_limited");
  assert.equal(beginErrorReason({ code: "42501" }), "forbidden");
  assert.equal(beginErrorReason({ code: "XX000" }), "error");
});

test("begin and finish call the RPCs with the contract's arguments", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return fn === "ai_begin_request" ? { data: ID, error: null } : { data: null, error: null };
    },
  };
  assert.deepEqual(await beginCall(db, "mcp read search"), { ok: true, id: ID });
  await finishCall(db, ID, "search", "answered");
  assert.deepEqual(calls[0], ["ai_begin_request", { p_question: "mcp read search" }]);
  assert.deepEqual(calls[1], ["ai_finish_request", { p_id: ID, p_tools: ["search"], p_status: "answered", p_input_tokens: null, p_output_tokens: null }]);

  const refusing = { rpc: async () => ({ data: null, error: { code: "54000", hint: "ai_rate_limited" } }) };
  assert.deepEqual(await beginCall(refusing, "x"), { ok: false, reason: "rate_limited" });
});
