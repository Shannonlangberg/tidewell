import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_SORT_COLUMNS,
  LIST_PAGE_SIZE,
  ORGANISATION_SORT_COLUMNS,
  boundedInt,
  first,
  lastPage,
  pageRange,
  parseContactListParams,
  parseOrganisationListParams,
  parseOwner,
  normaliseName,
  orIlike,
  searchTerm,
  staleCutoff,
} from "./params.ts";

test("searchTerm keeps names and emails and drops filter syntax", () => {
  assert.equal(searchTerm("  Tim   Hosking "), "Tim Hosking");
  assert.equal(searchTerm("o'brien"), "o'brien");
  assert.equal(searchTerm("tim@exp.com.au"), "tim@exp.com.au");
  assert.equal(searchTerm("Smith & Co"), "Smith & Co");
  // Characters that would change a PostgREST filter or a LIKE pattern are removed.
  assert.equal(searchTerm('a,b)(c"d%e_f\\g*h'), "a b c d e f g h");
  assert.equal(searchTerm("x.ilike.*,full_name.eq.1"), "x.ilike. full name.eq.1");
});

test("searchTerm handles empty, non-string and over-long input", () => {
  assert.equal(searchTerm(undefined), "");
  assert.equal(searchTerm(null), "");
  assert.equal(searchTerm("%%%"), "");
  assert.equal(searchTerm("a".repeat(500)).length, 100);
  assert.equal(searchTerm("Zoë Müller"), "Zoë Müller");
});

test("orIlike builds one quoted condition per column and refuses an empty term", () => {
  assert.equal(orIlike(["full_name", "email"], "tim"), 'full_name.ilike."*tim*",email.ilike."*tim*"');
  assert.equal(orIlike(["full_name"], "   "), null);
  assert.equal(orIlike(["full_name"], ",,,"), null);
  // The term cannot add a condition of its own.
  const built = orIlike(["full_name"], 'x",email.eq.a@b.c,"');
  assert.ok(built && !built.includes('",email.eq'));
});

test("normaliseName matches the database rules", () => {
  assert.equal(normaliseName("The Loan Arranger"), "loan arranger");
  assert.equal(normaliseName("loan arranger"), "loan arranger");
  assert.equal(normaliseName("Smith & Co Pty Ltd"), "smith and co");
  assert.equal(normaliseName("a.s lending co."), "as lending co");
  assert.equal(normaliseName("  Steve   Marshall "), "steve marshall");
  assert.equal(normaliseName("You & Me Property Partners"), "you and me property partners");
  // Never reduced to nothing.
  assert.equal(normaliseName("Ltd"), "ltd");
  assert.equal(normaliseName("The"), "the");
});


const VOCAB = {
  categories: ["real_estate_sales", "mortgage_broker", "conveyancer"],
  statuses: ["identified", "contacted", "met"],
  priorities: ["high", "medium", "low"],
};
const ID = "3f7f0d1e-1c5a-4a52-9a52-8a3b0f4a0001";

test("first takes the first value of a repeated param and never throws", () => {
  assert.equal(first(undefined), "");
  assert.equal(first("a"), "a");
  assert.equal(first(["a", "b"]), "a");
  assert.equal(first([]), "");
});

test("boundedInt accepts only whole digits and clamps", () => {
  assert.equal(boundedInt("3", 1, 1, 10), 3);
  assert.equal(boundedInt("0", 1, 1, 10), 1);
  assert.equal(boundedInt("99999", 1, 1, 10), 10);
  assert.equal(boundedInt("2abc", 1, 1, 10), 1);
  assert.equal(boundedInt("1e3", 1, 1, 10), 1);
  assert.equal(boundedInt("-4", 1, 1, 10), 1);
  assert.equal(boundedInt("", 7, 1, 10), 7);
});

test("contacts: defaults, with nothing filtered", () => {
  const q = parseContactListParams({}, VOCAB);
  assert.equal(q.q, "");
  assert.equal(q.sort, "name");
  assert.equal(q.dir, "asc");
  assert.equal(q.page, 1);
  assert.equal(q.filtered, false);
  assert.equal(q.category, null);
  assert.equal(q.owner, null);
});

test("contacts: valid filters are kept and counted as filtering", () => {
  const q = parseContactListParams(
    { q: "  tim ", category: "mortgage_broker", status: "met", priority: "high", region: "Copper Coast", owner: "me", followup: "overdue", stale: "30", verify: "needs", sort: "follow_up", dir: "desc", page: "3" },
    VOCAB,
  );
  assert.equal(q.q, "tim");
  assert.equal(q.category, "mortgage_broker");
  assert.equal(q.status, "met");
  assert.equal(q.priority, "high");
  assert.equal(q.region, "Copper Coast");
  assert.deepEqual(q.owner, { kind: "me" });
  assert.equal(q.followUp, "overdue");
  assert.equal(q.staleDays, 30);
  assert.equal(q.verify, "needs");
  assert.equal(q.sort, "follow_up");
  assert.equal(q.dir, "desc");
  assert.equal(q.page, 3);
  assert.equal(q.filtered, true);
});

test("contacts: anything outside the allowlists is ignored, never passed on", () => {
  const q = parseContactListParams(
    {
      category: "robbery",
      status: "met;drop table contacts",
      priority: "urgent",
      owner: "' or 1=1 --",
      followup: "all",
      stale: "45",
      verify: "maybe",
      sort: "password_hash",
      dir: "sideways",
      page: "-1",
    },
    VOCAB,
  );
  assert.equal(q.category, null);
  assert.equal(q.status, null);
  assert.equal(q.priority, null);
  assert.equal(q.owner, null);
  assert.equal(q.followUp, null);
  assert.equal(q.staleDays, null);
  assert.equal(q.verify, null);
  assert.equal(q.sort, "name");
  assert.equal(q.dir, "asc");
  assert.equal(q.page, 1);
  assert.equal(q.filtered, false);
});

test("contacts: sorting and paging alone do not count as filtering", () => {
  const q = parseContactListParams({ sort: "status", dir: "desc", page: "2" }, VOCAB);
  assert.equal(q.filtered, false);
});

test("contacts: every allowed sort key maps to a real directory column", () => {
  for (const [key, column] of Object.entries(CONTACT_SORT_COLUMNS)) {
    assert.equal(parseContactListParams({ sort: key }, VOCAB).sort, key);
    assert.match(column, /^[a-z_]+$/);
  }
});

test("owner filter: me, none, or a uuid", () => {
  assert.deepEqual(parseOwner("me"), { kind: "me" });
  assert.deepEqual(parseOwner("none"), { kind: "none" });
  assert.deepEqual(parseOwner(ID.toUpperCase()), { kind: "staff", id: ID });
  assert.equal(parseOwner("someone"), null);
  assert.equal(parseOwner(""), null);
});

test("a hostile search term is cleaned on the way in", () => {
  const q = parseContactListParams({ q: 'x"),email.eq.a@b.c,(y' }, VOCAB);
  assert.ok(!/[",()]/.test(q.q));
});

test("organisations: allowlisted sort, filters and paging", () => {
  const q = parseOrganisationListParams({ q: "loan", category: "conveyancer", region: "Adelaide", owner: ID, verify: "verified", sort: "contacts", dir: "desc", page: "2" }, VOCAB);
  assert.equal(q.q, "loan");
  assert.equal(q.category, "conveyancer");
  assert.deepEqual(q.owner, { kind: "staff", id: ID });
  assert.equal(q.sort, "contacts");
  assert.equal(q.dir, "desc");
  assert.equal(q.page, 2);
  assert.equal(q.filtered, true);
  assert.equal(parseOrganisationListParams({ sort: "notes" }, VOCAB).sort, "name");
  assert.equal(ORGANISATION_SORT_COLUMNS.contacts, "contact_count");
});

test("page ranges are 25 per page and the last page is at least 1", () => {
  assert.equal(LIST_PAGE_SIZE, 25);
  assert.deepEqual(pageRange(1, 25), { from: 0, to: 24 });
  assert.deepEqual(pageRange(3, 25), { from: 50, to: 74 });
  assert.equal(lastPage(0, 25), 1);
  assert.equal(lastPage(25, 25), 1);
  assert.equal(lastPage(26, 25), 2);
  assert.equal(lastPage(140, 25), 6);
});

import { parseLogParam } from "./params.ts";

test("?log= accepts the six types and the short names, and nothing else", () => {
  assert.equal(parseLogParam("call"), "phone_call");
  assert.equal(parseLogParam("phone_call"), "phone_call");
  assert.equal(parseLogParam("meeting"), "coffee_meeting");
  assert.equal(parseLogParam("office_meeting"), "office_meeting");
  assert.equal(parseLogParam("note"), "note");
  assert.equal(parseLogParam("EMAIL"), "email");
  assert.equal(parseLogParam(["message", "note"]), "message");
  assert.equal(parseLogParam("delete"), null);
  assert.equal(parseLogParam(""), null);
  assert.equal(parseLogParam(undefined), null);
});

test("staleCutoff is N whole days before now, as an ISO timestamp", () => {
  const now = new Date("2026-10-15T02:00:00Z");
  assert.equal(staleCutoff(30, now), "2026-09-15T02:00:00.000Z");
  assert.equal(staleCutoff(14, now), "2026-10-01T02:00:00.000Z");
});
