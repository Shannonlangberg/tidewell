import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTRACTOR_CATEGORIES } from "../constants.ts";
import { abnProblem, stripAbn } from "./abn.ts";
import { parseContractorImport } from "./import-parse.ts";

const vocab = { categories: CONTRACTOR_CATEGORIES, abnProblem, stripAbn };

test("the bundled prospects file reads cleanly: 31 rows, name and trade only", () => {
  const r = parseContractorImport(readFileSync("hq/seed/maintenance-contractors.json", "utf8"), vocab);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.file.lines.length, 31);
  assert.ok(r.file.lines.every((l) => l.row && l.problems.length === 0));
  assert.equal(r.file.source, "research-maintenance-2026-10");
  for (const l of r.file.lines) assert.deepEqual(Object.keys(l.row!).filter((k) => !["business_name", "categories", "flags"].includes(k)), []);
  assert.equal(r.file.lines.find((l) => l.row?.business_name === "Dean Trevor Todd")?.row?.flags?.length, 1);
});

test("the CSV twin gives the same names and trades", () => {
  const j = parseContractorImport(readFileSync("hq/seed/maintenance-contractors.json", "utf8"), vocab);
  const c = parseContractorImport(readFileSync("hq/seed/maintenance-contractors.csv", "utf8"), vocab);
  assert.ok(j.ok && c.ok);
  if (!j.ok || !c.ok) return;
  assert.deepEqual(c.file.lines.map((l) => [l.row?.business_name, l.row?.categories]), j.file.lines.map((l) => [l.row?.business_name, l.row?.categories]));
});

test("a file can never set status or clear needs-verifying", () => {
  const r = parseContractorImport(JSON.stringify([{ business_name: "A", categories: ["plumbing"], status: "approved", needs_verification: false }]), vocab);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.file.lines[0].row!), ["business_name", "categories"]);
  assert.match(r.file.warnings.join(" "), /never sets a status/);
});

test("bad rows are kept with their problems", () => {
  const r = parseContractorImport(JSON.stringify([{ business_name: "", categories: [] }, { business_name: "B", categories: ["magic"] }, { business_name: "C", categories: ["plumbing"], abn: "51824753557", email: "nope" }]), vocab);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.file.lines.every((l) => l.row === null && l.problems.length > 0));
  assert.match(r.file.lines[2].problems.join(" "), /ABN/);
});

test("valid optional fields are cleaned; categories accept labels and pipes in CSV", () => {
  const r = parseContractorImport("business_name,categories,abn,email,service_suburbs\nX Pty,Pest Control|plumbing,51 824 753 556,A@B.com,Moonta|Moonta Bay|moonta\n", vocab);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.file.lines[0].row, { business_name: "X Pty", categories: ["pest_control", "plumbing"], abn: "51824753556", email: "a@b.com", service_suburbs: ["Moonta", "Moonta Bay"] });
});

test("whole-file refusals", () => {
  assert.equal(parseContractorImport("", vocab).ok, false);
  assert.equal(parseContractorImport("{not json", vocab).ok, false);
  assert.equal(parseContractorImport("name,phone\nx,1", vocab).ok, false);
  assert.equal(parseContractorImport("[]", vocab).ok, false);
  assert.equal(parseContractorImport("x".repeat(1_000_001), vocab).ok, false);
});
