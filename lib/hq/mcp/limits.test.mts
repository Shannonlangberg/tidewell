// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BULK_CALLS_PER_HOUR,
  DEFAULT_BULK_ITEMS_PER_HOUR,
  DEFAULT_WRITE_HOURLY_LIMIT,
  MAX_BULK_ENTRIES,
  MAX_REQUEST_BYTES,
  MAX_TOOL_INPUT_ELEMENTS,
  MAX_WRITE_HOURLY_LIMIT,
  capStructured,
  capText,
  countsAgainstWriteCap,
  overWriteCap,
  withTimeout,
  writeHourlyLimit,
} from "./limits.ts";

test("the documented defaults: 60 single writes an hour (raised from 15), bulk 6 calls / 300 items, 50 entries a call", () => {
  assert.equal(DEFAULT_WRITE_HOURLY_LIMIT, 60);
  assert.equal(MAX_WRITE_HOURLY_LIMIT, 200);
  assert.equal(DEFAULT_BULK_CALLS_PER_HOUR, 6);
  assert.equal(DEFAULT_BULK_ITEMS_PER_HOUR, 300);
  assert.equal(MAX_BULK_ENTRIES, 50);
});

test("only single-record writes count against the write cap; bulk calls use the database's bulk budget", () => {
  assert.equal(countsAgainstWriteCap("write"), true);
  assert.equal(countsAgainstWriteCap("read"), false);
  assert.equal(countsAgainstWriteCap("bulk"), false);
});

test("a full bulk plan fits the request bounds", () => {
  // 50 entries x (16 fields + 10 dependencies + 12 checklist items), plus the call's own fields.
  assert.ok(MAX_TOOL_INPUT_ELEMENTS >= 50 * (16 + 10 + 12) + 50 + 10);
  assert.ok(MAX_REQUEST_BYTES >= 128 * 1024);
});

test("write cap from the environment: default, clamped, whole numbers only", () => {
  assert.equal(writeHourlyLimit(undefined), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit(""), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("abc"), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("2.5"), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("3"), 3);
  assert.equal(writeHourlyLimit("15"), 15, "the old default can still be set");
  assert.equal(writeHourlyLimit("0"), 1);
  assert.equal(writeHourlyLimit("100000"), MAX_WRITE_HOURLY_LIMIT);
});

test("the N-th write in the hour is allowed, the N+1-th refused", () => {
  assert.equal(overWriteCap(3, 3), false);
  assert.equal(overWriteCap(4, 3), true);
});

test("long text is cut with a note and never exceeds the cap", () => {
  const out = capText("x".repeat(500), 200);
  assert.ok(out.length <= 200);
  assert.match(out, /Result shortened/);
  assert.equal(capText("short", 200), "short");
});

test("oversized structured content is dropped", () => {
  assert.deepEqual(capStructured({ a: 1 }, 100), { a: 1 });
  assert.equal(capStructured({ a: "x".repeat(200) }, 100), undefined);
  assert.equal(capStructured(undefined), undefined);
});

test("a slow tool times out", async () => {
  await assert.rejects(withTimeout(new Promise((r) => setTimeout(r, 200)), 20), { name: "TimeoutError" });
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
});
