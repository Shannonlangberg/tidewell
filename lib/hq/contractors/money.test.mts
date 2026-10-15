import test from "node:test";
import assert from "node:assert/strict";
import { centsToDollarsInput, formatRate, MAX_RATE_CENTS, parseDollars } from "./money.ts";

test("dollars become cents", () => {
  assert.deepEqual(parseDollars("85"), { ok: true, cents: 8500 });
  assert.deepEqual(parseDollars("$85.50"), { ok: true, cents: 8550 });
  assert.deepEqual(parseDollars("1,200"), { ok: true, cents: 120000 });
  assert.deepEqual(parseDollars("1,200.50"), { ok: true, cents: 120050 });
  assert.deepEqual(parseDollars(" 19.9 "), { ok: true, cents: 1990 });
});

test("blank is unknown (null), zero is zero", () => {
  assert.deepEqual(parseDollars(""), { ok: true, cents: null });
  assert.deepEqual(parseDollars("   "), { ok: true, cents: null });
  assert.deepEqual(parseDollars(null), { ok: true, cents: null });
  assert.deepEqual(parseDollars("0"), { ok: true, cents: 0 });
  assert.deepEqual(parseDollars("0.00"), { ok: true, cents: 0 });
});

test("bad amounts are refused with a message", () => {
  for (const v of ["abc", "12.345", "1,2", "12 dollars", "--5"]) assert.equal(parseDollars(v).ok, false, v);
  const neg = parseDollars("-5");
  assert.equal(neg.ok, false);
  assert.match(neg.ok ? "" : neg.message, /negative/);
  assert.equal(parseDollars(String(MAX_RATE_CENTS / 100 + 1)).ok, false);
  assert.equal(parseDollars(String(MAX_RATE_CENTS / 100)).ok, true);
});

test("cents back to an input value and a display string", () => {
  assert.equal(centsToDollarsInput(8500), "85");
  assert.equal(centsToDollarsInput(8550), "85.50");
  assert.equal(centsToDollarsInput(0), "0");
  assert.equal(centsToDollarsInput(null), "");
  assert.equal(formatRate(8500), "$85");
  assert.equal(formatRate(8550), "$85.50");
  assert.equal(formatRate(0), "$0");
  assert.equal(formatRate(null), "Not recorded");
});

test("a round trip never changes the amount", () => {
  for (const c of [0, 1, 99, 100, 8550, 123456]) assert.deepEqual(parseDollars(centsToDollarsInput(c)), { ok: true, cents: c });
});
