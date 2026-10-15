// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_WRITE_HOURLY_LIMIT, MAX_WRITE_HOURLY_LIMIT, capStructured, capText, overWriteCap, withTimeout, writeHourlyLimit } from "./limits.ts";

test("write cap from the environment: default, clamped, whole numbers only", () => {
  assert.equal(writeHourlyLimit(undefined), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit(""), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("abc"), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("2.5"), DEFAULT_WRITE_HOURLY_LIMIT);
  assert.equal(writeHourlyLimit("3"), 3);
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
