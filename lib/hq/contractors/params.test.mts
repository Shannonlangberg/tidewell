import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACTOR_CATEGORIES, CONTRACTOR_EXPIRY_STATES, CONTRACTOR_STATUSES } from "../constants.ts";
import { searchTerm as growthSearchTerm } from "../growth/params.ts";
import { DIRECTORY_SORT_KEYS, orIlike, pageRange, parseDirectoryParams, placeKey, placeTerm, searchTerm } from "./params.ts";

const vocab = { categories: CONTRACTOR_CATEGORIES, statuses: CONTRACTOR_STATUSES, expiryStates: CONTRACTOR_EXPIRY_STATES };

test("the brief's example: approved plumbers who service Moonta", () => {
  const q = parseDirectoryParams({ status: "cleared", trade: "plumbing", suburb: "Moonta" }, vocab);
  assert.equal(q.status, "cleared");
  assert.equal(q.trade, "plumbing");
  assert.equal(q.suburb, "Moonta");
  assert.equal(placeKey(q.suburb ?? ""), "moonta");
  assert.equal(q.filtered, true);
});

test("no params means no filters, name ascending, page 1", () => {
  const q = parseDirectoryParams({}, vocab);
  assert.deepEqual([q.q, q.trade, q.suburb, q.status, q.chip, q.sort, q.dir, q.page, q.filtered], ["", null, null, null, null, "name", "asc", 1, false]);
});

test("anything outside the allowlists is dropped", () => {
  const q = parseDirectoryParams({ trade: "wizardry", status: "approved;drop", insurance: "fine", licence: "x", emergency: "maybe", chip: "evil", sort: "password", dir: "sideways", page: "2abc" }, vocab);
  assert.deepEqual([q.trade, q.status, q.insurance, q.licence, q.emergency, q.chip, q.sort, q.dir, q.page, q.filtered], [null, null, null, null, null, null, "name", "asc", 1, false]);
});

test("valid filters, chips, sort and page are kept", () => {
  const q = parseDirectoryParams({ emergency: "unknown", insurance: "expired", licence: "current", chip: "awaiting", sort: "vetting", dir: "desc", page: "3", status: "suspended" }, vocab);
  assert.deepEqual([q.emergency, q.insurance, q.licence, q.chip, q.sort, q.dir, q.page, q.status], ["unknown", "expired", "current", "awaiting", "vetting", "desc", 3, "suspended"]);
});

test("array params use the first value", () => {
  assert.equal(parseDirectoryParams({ trade: ["electrical", "plumbing"] }, vocab).trade, "electrical");
});

test("a suburb cannot carry filter syntax", () => {
  assert.equal(placeTerm("Moonta Bay"), "Moonta Bay");
  assert.equal(placeTerm("St. Kilda's-end"), "St. Kilda's-end");
  assert.equal(placeTerm("a},{b,c)"), "a b c");
  assert.equal(placeTerm('x"y\\z'), "x y z");
  assert.equal(placeTerm("%%%"), null);
  assert.equal(placeTerm(undefined), null);
  assert.equal(placeKey("  Port   Hughes "), "port hughes");
});

test("search helpers match the partner lists' twins", () => {
  for (const s of ["  Tim   Hosking ", "o'brien", 'a,b)(c"d%e_f\\g*h', "Smith & Co", "%%%", "Zoë Müller", "x".repeat(300)]) assert.equal(searchTerm(s), growthSearchTerm(s));
  assert.equal(orIlike(["a", "b"], "tim"), 'a.ilike."*tim*",b.ilike."*tim*"');
  assert.equal(orIlike(["a"], "  "), null);
  assert.deepEqual(pageRange(3, 25), { from: 50, to: 74 });
});

test("every sort key maps to a real directory column name", () => {
  assert.deepEqual([...DIRECTORY_SORT_KEYS].sort(), ["contacted", "insurance", "licence", "name", "owner", "rating", "status", "used", "vetting"]);
});

test("the trade filter accepts exactly the trades the caller loaded (an owner-added trade too)", () => {
  const custom = { ...vocab, categories: ["plumbing", "solar_and_batteries"] };
  assert.equal(parseDirectoryParams({ trade: "solar_and_batteries" }, custom).trade, "solar_and_batteries");
  assert.equal(parseDirectoryParams({ trade: "electrical" }, custom).trade, null, "a trade not in the loaded list is dropped");
});

test("the directory can be sorted by last used (last_job_date)", () => {
  assert.equal(parseDirectoryParams({ sort: "used", dir: "desc" }, vocab).sort, "used");
});
