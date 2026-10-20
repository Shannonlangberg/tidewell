import test from "node:test";
import assert from "node:assert/strict";
import { addToSection, appendSection, applyEdit, headingList, replaceSection, replaceText, sections } from "./edits.ts";

const DOC = "# Landlord onboarding\n\nPurpose: welcome a new landlord.\n\n## Steps\n1. Sign the agreement\n2. Book the inspection\n\n## Owner\nThe director";

const body = (r: ReturnType<typeof replaceText>) => {
  assert.ok(r.ok, r.ok ? "" : r.message);
  return r.ok ? r.body : "";
};

test("sections: headings and where they end", () => {
  const s = sections(DOC);
  assert.deepEqual(s.map((x) => [x.heading, x.level]), [["Landlord onboarding", 1], ["Steps", 2], ["Owner", 2]]);
  assert.equal(s[0].end, DOC.split("\n").length, "a level-1 section runs to the end");
  assert.equal(headingList(DOC), 'its headings are "Landlord onboarding", "Steps", "Owner"');
  assert.equal(headingList("no headings"), "it has no headings");
});

test("replace_text: exactly one match", () => {
  assert.equal(body(replaceText(DOC, "Book the inspection", "Book the ingoing inspection")).includes("2. Book the ingoing inspection"), true);
  assert.equal(body(replaceText(DOC, "Purpose: welcome a new landlord.\n\n", "")).includes("Purpose"), false, "empty new text removes");
});

test("replace_text: missing and ambiguous matches are refused", () => {
  const missing = replaceText(DOC, "Collect the keys", "x");
  assert.ok(!missing.ok && /not found exactly/.test(missing.message));
  const twice = replaceText(DOC, "the", "THE");
  assert.ok(!twice.ok && /more than once/.test(twice.message));
  const blank = replaceText(DOC, "   ", "x");
  assert.ok(!blank.ok);
});

test("append_section: a new section at the end", () => {
  const out = body(appendSection(DOC, "Review date", "Every six months."));
  assert.ok(out.endsWith("## Owner\nThe director\n\n## Review date\n\nEvery six months."));
  const dup = appendSection(DOC, "  steps ", "x");
  assert.ok(!dup.ok && /already exists/.test(dup.message), "an existing heading (any case) is refused");
  assert.ok(!appendSection(DOC, "", "x").ok);
  assert.ok(!appendSection(DOC, "New", "  ").ok);
});

test("add_to_section: a list item joins the list", () => {
  const out = body(addToSection(DOC, "steps", "3. Confirm the owner has an Ailo invitation"));
  assert.ok(out.includes("2. Book the inspection\n3. Confirm the owner has an Ailo invitation\n\n## Owner"), out);
});

test("add_to_section: a paragraph gets a blank line; the last section works", () => {
  const out = body(addToSection(DOC, "Owner", "Backup: the administrator"));
  assert.ok(out.endsWith("The director\n\nBackup: the administrator"), out);
});

test("add_to_section and replace_section refuse a missing or repeated heading", () => {
  const missing = addToSection(DOC, "Keys", "x");
  assert.ok(!missing.ok && /No section is headed "Keys"; its headings are/.test(missing.message));
  const twice = "## A\nx\n## A\ny";
  const amb = replaceSection(twice, "A", "z");
  assert.ok(!amb.ok && /2 sections are headed/.test(amb.message));
});

test("replace_section keeps the heading and the following sections", () => {
  const out = body(replaceSection(DOC, "Steps", "1. Call the owner\n2. Send the agreement"));
  assert.ok(out.includes("## Steps\n\n1. Call the owner\n2. Send the agreement\n\n## Owner\nThe director"), out);
  assert.ok(!out.includes("Book the inspection"));
});

test("a level-1 section replaced keeps nothing below it but its own content", () => {
  const out = body(replaceSection("# Top\nold\n## Sub\nkeep?", "Top", "new"));
  assert.equal(out, "# Top\n\nnew", "a level-1 section includes its subsections");
});

test("applyEdit dispatches by name", () => {
  assert.ok(applyEdit(DOC, { op: "replace_text", oldText: "The director", newText: "Shannon" }).ok);
  assert.ok(applyEdit(DOC, { op: "append_section", heading: "Notes", text: "x" }).ok);
  assert.ok(applyEdit(DOC, { op: "add_to_section", heading: "Owner", text: "x" }).ok);
  assert.ok(applyEdit(DOC, { op: "replace_section", heading: "Owner", text: "x" }).ok);
});
