import test from "node:test";
import assert from "node:assert/strict";
import { SEARCH_MAX, SEARCH_MIN, normaliseQuery, parseSearchResults, queryState, totalHits } from "../search.ts";

test("normaliseQuery collapses whitespace, drops control characters and bounds the length", () => {
  assert.equal(normaliseQuery("  mortgage   broker "), "mortgage broker");
  assert.equal(normaliseQuery("a\u0000b\nc"), "a b c");
  assert.equal(normaliseQuery("x".repeat(500)).length, SEARCH_MAX);
  assert.equal(normaliseQuery(undefined), "");
  assert.equal(normaliseQuery(null), "");
  assert.equal(normaliseQuery(["first", "second"]), "first");
  assert.equal(normaliseQuery("100% _done_ \\"), "100% _done_ \\"); // special characters are kept: the database escapes them
});

test("queryState: empty, too short, ready", () => {
  assert.equal(queryState(""), "empty");
  assert.equal(queryState("a"), "too_short");
  assert.equal(queryState("ab"), "ready");
  assert.equal(SEARCH_MIN, 2);
});

test("parseSearchResults keeps well-formed hits and drops the rest", () => {
  const r = parseSearchResults({
    contacts: [{ id: "c1", title: "Sam Sample", subtitle: "Broker - Sample Lending" }, { id: 5, title: "bad id" }, null, "x", { id: "c2" }],
    organisations: [{ id: "o1", title: " Sample Lending Co. ", subtitle: "  " }],
    referrals: "nope",
    tasks: [{ id: "t1", title: "Call back", subtitle: "to do - due 2026-10-20", status: "to_do" }],
  });
  assert.deepEqual(r.contacts, [{ id: "c1", title: "Sam Sample", subtitle: "Broker - Sample Lending" }]);
  assert.deepEqual(r.organisations, [{ id: "o1", title: "Sample Lending Co.", subtitle: null }]);
  assert.deepEqual(r.referrals, []);
  assert.deepEqual(r.tasks, [{ id: "t1", title: "Call back", subtitle: "to do - due 2026-10-20" }]);
  assert.equal(totalHits(r), 3);
});

test("parseSearchResults survives garbage", () => {
  for (const v of [null, undefined, 42, "x", [], true]) {
    const r = parseSearchResults(v);
    assert.deepEqual(r, { contacts: [], organisations: [], referrals: [], tasks: [], contractors: [] });
    assert.equal(totalHits(r), 0);
  }
});

test("parseSearchResults reads the contractors group and counts it", () => {
  const r = parseSearchResults({ contractors: [{ id: "k1", title: "Moonta Plumbing", subtitle: "plumbing - Moonta - approved", status: "approved" }, { title: "no id" }] });
  assert.deepEqual(r.contractors, [{ id: "k1", title: "Moonta Plumbing", subtitle: "plumbing - Moonta - approved" }]);
  assert.equal(totalHits(r), 1);
  // A caller without contractors.read gets no group back at all: it parses as empty.
  assert.deepEqual(parseSearchResults({ contacts: [] }).contractors, []);
});
