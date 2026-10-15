// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { consentLines, consentPath, isAuthorizationId, redirectHost, safeClientRedirect } from "./consent.ts";
import { safeNextPath } from "../next-path.ts";

test("authorization ids: a conservative alphabet only", () => {
  assert.ok(isAuthorizationId("abcDEF123_-xyz"));
  assert.equal(isAuthorizationId("short"), false);
  assert.equal(isAuthorizationId("has space here"), false);
  assert.equal(isAuthorizationId("../../etc/passwd"), false);
  assert.equal(isAuthorizationId(undefined), false);
});

test("the consent page is a valid HQ next path, so sign-in returns to it", () => {
  const p = consentPath("abcDEF123_-xyz");
  assert.equal(safeNextPath(p), p);
});

test("return addresses: https anywhere, http only on this machine, nothing else", () => {
  assert.equal(safeClientRedirect("https://chatgpt.com/connector_platform_oauth_redirect?code=x&state=y"), "https://chatgpt.com/connector_platform_oauth_redirect?code=x&state=y");
  assert.ok(safeClientRedirect("http://127.0.0.1:33418/callback?code=x"));
  assert.ok(safeClientRedirect("http://localhost:6274/oauth/callback"));
  assert.equal(safeClientRedirect("http://evil.example/cb"), null);
  assert.equal(safeClientRedirect("javascript:alert(1)"), null);
  assert.equal(safeClientRedirect("data:text/html,hi"), null);
  assert.equal(safeClientRedirect("https://user:pw@evil.example/"), null);
  assert.equal(safeClientRedirect("cursor://callback"), null);
  assert.equal(safeClientRedirect(""), null);
  assert.equal(redirectHost("https://claude.ai/api/mcp/auth_callback"), "claude.ai");
});

test("what a connection can do follows the person's capabilities", () => {
  const director = consentLines(["growth.read", "growth.write", "tasks.write", "contractors.read", "contractors.write", "people.read", "ai.use"]);
  assert.ok(director.can.some((l) => l.includes("contractor")));
  assert.ok(director.can.some((l) => l.startsWith("Make small changes")));
  const reader = consentLines(["ai.use"]);
  assert.ok(reader.can.some((l) => l.includes("cannot change anything")));
  assert.ok(reader.cannot.some((l) => l.includes("Delete")));
});
