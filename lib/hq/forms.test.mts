import test from "node:test";
import assert from "node:assert/strict";
import { FormReader, intParam, isIsoDate, isUuid, likeValue, strParam } from "./forms.ts";

const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

test("text trims, bounds length and treats empty as null", () => {
  const r = new FormReader(form({ a: "  hello  ", b: "", c: "x".repeat(10) }));
  assert.equal(r.text("a"), "hello");
  assert.equal(r.text("b"), null);
  assert.equal(r.text("c", { max: 5, label: "Name" }), null);
  assert.equal(r.errors.c, "Name must be 5 characters or fewer.");
  assert.equal(r.ok, false);
});

test("requiredText reports a missing value", () => {
  const r = new FormReader(form({}));
  r.requiredText("title", { label: "Title" });
  assert.equal(r.errors.title, "Title is required.");
});

test("email normalises and validates", () => {
  const r = new FormReader(form({ ok: " Person@Example.COM ", bad: "nope" }));
  assert.equal(r.email("ok"), "person@example.com");
  assert.equal(r.email("bad"), null);
  assert.ok(r.errors.bad);
  assert.equal(r.errors.ok, undefined);
});

test("phone accepts Australian formats and rejects junk", () => {
  const r = new FormReader(form({ a: "0400 000 000", b: "(08) 8821 1234", c: "+61 400 000 000", d: "abc", e: "12" }));
  assert.equal(r.phone("a"), "0400 000 000");
  assert.equal(r.phone("b"), "(08) 8821 1234");
  assert.equal(r.phone("c"), "+61 400 000 000");
  assert.equal(r.phone("d"), null);
  assert.equal(r.phone("e"), null);
  assert.deepEqual(Object.keys(r.errors).sort(), ["d", "e"]);
});

test("url adds a scheme and rejects nonsense", () => {
  const r = new FormReader(form({ a: "example.com.au", b: "https://example.com", c: "not a url" }));
  assert.equal(r.url("a"), "https://example.com.au");
  assert.equal(r.url("b"), "https://example.com");
  assert.equal(r.url("c"), null);
  assert.ok(r.errors.c);
});

test("uuid and dates are strict", () => {
  assert.ok(isUuid("123e4567-e89b-12d3-a456-426614174000"));
  assert.ok(!isUuid("123"));
  assert.ok(isIsoDate("2026-10-15"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("15/10/2026"));
});

test("oneOf, manyOf and bool", () => {
  const r = new FormReader(form({ s: "high", t: "bogus", cats: ["a", "b", "a"], on: "on" }));
  assert.equal(r.oneOf("s", ["high", "low"] as const), "high");
  assert.equal(r.oneOf("t", ["high", "low"] as const), null);
  assert.ok(r.errors.t);
  assert.deepEqual(r.manyOf("cats", ["a", "b", "c"] as const), ["a", "b"]);
  assert.equal(r.bool("on"), true);
  assert.equal(r.bool("missing"), false);
});

test("dollarsToCents parses typed amounts", () => {
  const r = new FormReader(form({ a: "$12,500", b: "460.50", c: "ten", d: "" }));
  assert.equal(r.dollarsToCents("a"), 1_250_000);
  assert.equal(r.dollarsToCents("b"), 46_050);
  assert.equal(r.dollarsToCents("c"), null);
  assert.ok(r.errors.c);
  assert.equal(r.dollarsToCents("d"), null);
  assert.equal(r.errors.d, undefined);
});

test("search params are bounded", () => {
  assert.equal(intParam("3", 1), 3);
  assert.equal(intParam("abc", 1), 1);
  assert.equal(intParam("-5", 1), 1);
  assert.equal(intParam("999999", 1, 1, 100), 100);
  assert.equal(strParam(["  hello "], 3), "hel");
});

test("likeValue neutralises filter metacharacters", () => {
  assert.equal(likeValue("50%_off,(x)"), "50\\%\\_off\\,\\(x\\)");
});
