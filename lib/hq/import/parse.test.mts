import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IMPORT_MAX_ROWS, invalidLines, parseCsv, parseImportText, validLines } from "./parse.ts";

const CATEGORIES = ["real_estate_sales", "mortgage_broker", "conveyancer", "lawyer", "accountant", "bank_lending", "buyers_agent", "property_developer", "builder", "financial_adviser", "other"];
const parse = (text: string) => parseImportText(text, CATEGORIES);
const seed = (name: string) => readFileSync(new URL(`../../../hq/seed/${name}`, import.meta.url), "utf8");

function ok(text: string) {
  const r = parse(text);
  assert.equal(r.ok, true, r.ok ? "" : r.error);
  if (!r.ok) throw new Error("unreachable");
  return r.file;
}

test("the bundled JSON research leads parse completely", () => {
  const file = ok(seed("referral-contacts.json"));
  assert.equal(file.format, "json");
  assert.equal(file.source, "research-leads-2026-10");
  assert.equal(file.lines.length, 27);
  assert.equal(validLines(file).length, 27);
  assert.equal(invalidLines(file).length, 0);
  const doug = file.lines.find((l) => l.row?.full_name === "Doug Reed")!;
  assert.deepEqual(doug.row?.categories, ["lawyer", "conveyancer"]);
  assert.equal(doug.row?.flags?.length, 1);
  // Nothing is invented: only what the file said.
  assert.equal(doug.row?.phone, undefined);
  assert.equal(doug.row?.email, undefined);
});

test("the bundled CSV research leads parse to the same people as the JSON", () => {
  const csv = ok(seed("referral-contacts.csv"));
  const json = ok(seed("referral-contacts.json"));
  assert.equal(csv.format, "csv");
  assert.equal(csv.lines.length, 27);
  assert.deepEqual(
    validLines(csv).map((l) => l.row),
    validLines(json).map((l) => l.row),
  );
  // `|` separated categories, and a quoted cell containing a semicolon and doubled quotes.
  const doug = csv.lines.find((l) => l.row?.full_name === "Doug Reed")!;
  assert.deepEqual(doug.row?.categories, ["lawyer", "conveyancer"]);
  assert.equal(doug.row?.flags?.[0], 'Supplied category was "Legal / Conveyancing"; both recorded.');
});

test("CSV: quoted commas, doubled quotes, newlines in quotes, CRLF, BOM and blank lines", () => {
  const text = '﻿organisation,full_name,categories,service_region,notes\r\n"Smith, Jones & Co","Ann ""AJ"" Smith",lawyer|conveyancer,Adelaide,"line one\nline two"\r\n\r\nAcme,Bob Brown,builder,,\r\n';
  const file = ok(text);
  assert.equal(file.lines.length, 2);
  const [a, b] = file.lines;
  assert.equal(a.row?.organisation, "Smith, Jones & Co");
  assert.equal(a.row?.full_name, 'Ann "AJ" Smith');
  assert.deepEqual(a.row?.categories, ["lawyer", "conveyancer"]);
  assert.equal(a.row?.notes, "line one\nline two");
  assert.equal(b.row?.service_region, undefined);
  assert.equal(b.line, 2);
});

test("CSV: header names are case-insensitive and a few synonyms work; unknown columns are ignored with a warning", () => {
  const file = ok("Organization,Name,Category,Region,Favourite colour\nAcme,Bob Brown,builder,Adelaide,green\n");
  assert.equal(file.lines[0].row?.organisation, "Acme");
  assert.equal(file.lines[0].row?.full_name, "Bob Brown");
  assert.deepEqual(file.lines[0].row?.categories, ["builder"]);
  assert.equal(file.lines[0].row?.service_region, "Adelaide");
  assert.equal(file.warnings.length, 1);
  assert.match(file.warnings[0], /Favourite colour/);
});

test("categories: array or pipe separated, labels with spaces are accepted, duplicates collapse", () => {
  const file = ok(JSON.stringify([
    { organisation: "A", full_name: "One Person", categories: ["lawyer", "conveyancer"] },
    { organisation: "A", full_name: "Two Person", categories: "Mortgage Broker | buyers-agent | mortgage_broker" },
  ]));
  assert.deepEqual(file.lines[0].row?.categories, ["lawyer", "conveyancer"]);
  assert.deepEqual(file.lines[1].row?.categories, ["mortgage_broker", "buyers_agent"]);
});

test("bad rows are kept with their problems, and good rows survive beside them", () => {
  const file = ok(JSON.stringify([
    { organisation: "Fine Co", full_name: "Good Person", categories: ["lawyer"] },
    { organisation: "", full_name: "No Org", categories: ["lawyer"] },
    { organisation: "Org", full_name: "", categories: ["lawyer"] },
    { organisation: "Org", full_name: "No Cat", categories: [] },
    { organisation: "Org", full_name: "Bad Cat", categories: ["plumber"] },
    { organisation: "Org", full_name: "Bad Email", categories: ["lawyer"], email: "not-an-email" },
    { organisation: "Org", full_name: "x".repeat(201), categories: ["lawyer"] },
    { organisation: "Org", full_name: "Wrong Type", categories: ["lawyer"], phone: { a: 1 } },
    "just a string",
    null,
  ]));
  assert.equal(file.lines.length, 10);
  assert.equal(validLines(file).length, 1);
  const problems = file.lines.map((l) => l.problems.join(" "));
  assert.match(problems[1], /Organisation is required/);
  assert.match(problems[2], /Full name is required/);
  assert.match(problems[3], /at least one category/);
  assert.match(problems[4], /Unknown category "plumber"/);
  assert.match(problems[5], /Email address isn't valid/);
  assert.match(problems[6], /Full name is longer than 200/);
  assert.match(problems[7], /Phone must be text/);
  assert.match(problems[8], /not an object/);
  assert.match(problems[9], /not an object/);
  // The label says who the row was, so the review table can name it.
  assert.equal(file.lines[4].label, "Org · Bad Cat");
});

test("fields are cleaned: trimmed, control characters removed, email lower-cased, empties dropped", () => {
  const file = ok(JSON.stringify([{ organisation: "  Acme\u0000 Pty  ", full_name: " Bob\u0007 ", categories: ["builder"], email: " Bob@Example.COM ", phone: "   ", notes: "a\u0000b" }]));
  const row = file.lines[0].row!;
  assert.equal(row.organisation, "Acme Pty");
  assert.equal(row.full_name, "Bob");
  assert.equal(row.email, "bob@example.com");
  assert.equal("phone" in row, false);
  assert.equal(row.notes, "ab");
});

test("flags: an array or pipe separated list, bounded", () => {
  const f1 = ok(JSON.stringify([{ organisation: "A", full_name: "B C", categories: ["lawyer"], flags: ["one", "two"] }]));
  assert.deepEqual(f1.lines[0].row?.flags, ["one", "two"]);
  const f2 = ok("organisation,full_name,categories,flags\nA,B C,lawyer,one|two\n");
  assert.deepEqual(f2.lines[0].row?.flags, ["one", "two"]);
  const many = ok(JSON.stringify([{ organisation: "A", full_name: "B C", categories: ["lawyer"], flags: Array.from({ length: 11 }, (_, i) => `f${i}`) }]));
  assert.match(many.lines[0].problems.join(" "), /no more than 10/);
});

test("the file as a whole can be refused", () => {
  const refused = (text: string) => {
    const r = parse(text);
    assert.equal(r.ok, false);
    return r.ok ? "" : r.error;
  };
  assert.match(refused(""), /empty/);
  assert.match(refused("   \n  "), /empty/);
  assert.match(refused("{ not json"), /valid JSON/);
  assert.match(refused('{"foo":1}'), /list of rows/);
  assert.match(refused("[]"), /no rows/);
  assert.match(refused("organisation,full_name,categories\n"), /no rows/);
  assert.match(refused("a,b,c\n1,2,3\n"), /organisation and full_name/);
  assert.match(refused('organisation,full_name,categories\n"Open quote,Name,lawyer\n'), /never closed/);
  assert.match(refused("x".repeat(1_000_001)), /larger than 1 MB/);
});

test("the row limit is enforced for both formats", () => {
  const row = { organisation: "A", full_name: "B C", categories: ["lawyer"] };
  const ok2000 = JSON.stringify(Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => ({ ...row, full_name: `P ${i}` })));
  assert.equal(parse(ok2000).ok, true);
  const over = JSON.stringify(Array.from({ length: IMPORT_MAX_ROWS + 1 }, () => row));
  const r = parse(over);
  assert.equal(r.ok, false);
  const csv = "organisation,full_name,categories\n" + Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `A,P ${i},lawyer`).join("\n");
  assert.equal(parse(csv).ok, false);
});

test("parseCsv handles a trailing line with no newline and reports an unclosed quote", () => {
  assert.deepEqual(parseCsv("a,b\n1,2").rows, [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b\n1,").rows, [["a", "b"], ["1", ""]]);
  assert.equal(parseCsv('a,"b').unterminated, true);
  assert.equal(parseCsv('a,"b"').unterminated, false);
  // A quote inside an unquoted field is just a character.
  assert.deepEqual(parseCsv('5" tall,x').rows, [['5" tall', "x"]]);
});
