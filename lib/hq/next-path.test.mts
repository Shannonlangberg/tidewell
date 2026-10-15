// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "./next-path.ts";

test("keeps a path inside HQ, with its query string", () => {
  assert.equal(safeNextPath("/hq"), "/hq");
  assert.equal(safeNextPath("/hq/growth/contacts"), "/hq/growth/contacts");
  assert.equal(safeNextPath("/hq/growth/contacts?status=met&page=2"), "/hq/growth/contacts?status=met&page=2");
  assert.equal(safeNextPath("/hq?period=90d"), "/hq?period=90d");
});

test("drops the fragment", () => {
  assert.equal(safeNextPath("/hq/people#top"), "/hq/people");
  assert.equal(safeNextPath("/hq#x"), "/hq");
});

test("anything that is not a string falls back", () => {
  assert.equal(safeNextPath(null), "/hq");
  assert.equal(safeNextPath(undefined), "/hq");
  assert.equal(safeNextPath(42), "/hq");
  assert.equal(safeNextPath(["/hq/people"]), "/hq");
  assert.equal(safeNextPath(""), "/hq");
  assert.equal(safeNextPath("   "), "/hq");
});

test("refuses other origins and protocol-relative URLs", () => {
  for (const bad of [
    "//evil.example",
    "//evil.example/hq",
    "https://evil.example/hq",
    "http://evil.example",
    "javascript:alert(1)",
    "/\\evil.example",
    "/hq/\\evil.example",
    "\\\\evil.example",
    "evil.example/hq",
  ]) {
    assert.equal(safeNextPath(bad), "/hq", bad);
  }
});

test("refuses paths outside /hq, including look-alikes", () => {
  for (const bad of ["/app", "/", "/hqx", "/hq-evil", "/hq%2fapp", "/api/session", "/stay/abc"]) {
    assert.equal(safeNextPath(bad), "/hq", bad);
  }
});

test("refuses dot segments that climb out of /hq", () => {
  assert.equal(safeNextPath("/hq/../app"), "/hq");
  assert.equal(safeNextPath("/hq/%2e%2e/app"), "/hq");
  assert.equal(safeNextPath("/hq/./growth"), "/hq/growth");
});

test("refuses control characters", () => {
  assert.equal(safeNextPath("/hq/\n/people"), "/hq");
  assert.equal(safeNextPath("/\t/evil.example"), "/hq");
  assert.equal(safeNextPath("/hq/\u0000"), "/hq");
});

test("never sends a person back to a sign-in screen", () => {
  for (const bad of ["/hq/sign-in", "/hq/sign-in?error=no-access", "/hq/verify", "/hq/mfa", "/hq/mfa/extra"]) {
    assert.equal(safeNextPath(bad), "/hq", bad);
  }
});

test("refuses very long values", () => {
  assert.equal(safeNextPath(`/hq/${"a".repeat(600)}`), "/hq");
});

test("uses the fallback given", () => {
  assert.equal(safeNextPath("https://evil.example", "/hq/people"), "/hq/people");
});
