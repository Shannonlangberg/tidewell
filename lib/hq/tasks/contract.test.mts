import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "../next-path.ts";
import { TITLE_MAX, cleanTitle, newTaskHref, parseNewTaskQuery as parse } from "./rules.ts";

// The same two lines as lib/hq/tasks/return-path.ts (which cannot be loaded here: it imports
// next-path without an extension). The validator itself is the real one.
const safeReturnPath = (value: unknown): string | null => {
  const path = safeNextPath(value, "");
  return path === "" ? null : path;
};
const parseNewTaskQuery = (sp: Record<string, string | string[] | undefined>) => parse(sp, safeReturnPath);

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("a clean contract link prefills every field", () => {
  const p = parseNewTaskQuery({ contact: A, contractor: B, organisation: B, referral: A, opportunity: B, title: "Call back", due: "2026-10-20", return: "/hq/growth/contacts/abc" });
  assert.deepEqual(p, {
    contact: A,
    contractor: B,
    organisation: B,
    referral: A,
    opportunity: B,
    title: "Call back",
    due: "2026-10-20",
    returnTo: "/hq/growth/contacts/abc",
  });
});

test("any subset works, and an empty query prefills nothing", () => {
  const empty = parseNewTaskQuery({});
  assert.deepEqual(empty, { contact: null, contractor: null, organisation: null, referral: null, opportunity: null, title: null, due: null, returnTo: null });
  assert.equal(parseNewTaskQuery({ contact: A }).contact, A);
  assert.equal(parseNewTaskQuery({ contact: A }).organisation, null);
});

test("an id that is not a uuid is ignored, and uuids are lower-cased", () => {
  assert.equal(parseNewTaskQuery({ contact: "123" }).contact, null);
  assert.equal(parseNewTaskQuery({ contact: "' or 1=1 --" }).contact, null);
  assert.equal(parseNewTaskQuery({ contact: `${A};drop` }).contact, null);
  assert.equal(parseNewTaskQuery({ contact: "" }).contact, null);
  assert.equal(parseNewTaskQuery({ contact: A.toUpperCase() }).contact, A);
  assert.equal(parseNewTaskQuery({ contact: [A, B] }).contact, A);
});

test("a due date must be a real calendar date", () => {
  assert.equal(parseNewTaskQuery({ due: "2026-10-20" }).due, "2026-10-20");
  assert.equal(parseNewTaskQuery({ due: "2026-02-30" }).due, null);
  assert.equal(parseNewTaskQuery({ due: "20/10/2026" }).due, null);
  assert.equal(parseNewTaskQuery({ due: "tomorrow" }).due, null);
  assert.equal(parseNewTaskQuery({ due: "2026-10-20T10:00:00Z" }).due, null);
});

test("the title is cleaned of control characters, collapsed and cut to size", () => {
  assert.equal(cleanTitle("  Call\n\tback   Sam \u0000 "), "Call back Sam");
  assert.equal(cleanTitle("x".repeat(500)).length, TITLE_MAX);
  assert.equal(parseNewTaskQuery({ title: "   " }).title, null);
  assert.equal(parseNewTaskQuery({ title: "<b>hi</b>" }).title, "<b>hi</b>"); // text, never HTML: React escapes it
});

test("return accepts only a path inside /hq", () => {
  assert.equal(safeReturnPath("/hq"), "/hq");
  assert.equal(safeReturnPath("/hq/growth/contacts/abc"), "/hq/growth/contacts/abc");
  assert.equal(safeReturnPath("/hq/operations?view=team&page=2"), "/hq/operations?view=team&page=2");
  assert.equal(safeReturnPath("/hq/growth/referrals/r1#notes"), "/hq/growth/referrals/r1"); // the fragment is dropped
});

test("return refuses other origins, protocol-relative URLs, escapes and the sign-in screens", () => {
  const bad = [
    "https://evil.example/hq",
    "http://evil.example",
    "//evil.example",
    "//evil.example/hq",
    "/\\evil.example",
    "\\\\evil.example",
    "/app/route",
    "/hqevil",
    "/hq/../app",
    "/hq/%2e%2e/app",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "hq/growth",
    "",
    "/hq/sign-in",
    "/hq/verify",
    "/hq/mfa",
    "/hq/growth\u0000",
    "/hq/growth\nSet-Cookie: x=1",
    `/hq/${"a".repeat(600)}`,
  ];
  for (const v of bad) assert.equal(safeReturnPath(v), null, JSON.stringify(v.slice(0, 40)));
  assert.equal(safeReturnPath(undefined), null);
  assert.equal(safeReturnPath(null), null);
  assert.equal(safeReturnPath(42), null);
});

test("return is read from the query, first value only", () => {
  assert.equal(parseNewTaskQuery({ return: ["/hq/growth", "https://evil.example"] }).returnTo, "/hq/growth");
  assert.equal(parseNewTaskQuery({ return: "https://evil.example" }).returnTo, null);
});

test("newTaskHref builds the contract URL and parses back to the same values", () => {
  assert.equal(newTaskHref(), "/hq/operations/tasks/new");
  const href = newTaskHref({ contact: A, title: "Call back & confirm", due: "2026-10-20", returnTo: "/hq/growth/contacts/x?tab=notes" });
  assert.ok(href.startsWith("/hq/operations/tasks/new?"));
  const params = new URL(href, "http://x.invalid").searchParams;
  const back = parseNewTaskQuery(Object.fromEntries(params.entries()));
  assert.equal(back.contact, A);
  assert.equal(back.title, "Call back & confirm");
  assert.equal(back.due, "2026-10-20");
  assert.equal(back.returnTo, "/hq/growth/contacts/x?tab=notes");
});
