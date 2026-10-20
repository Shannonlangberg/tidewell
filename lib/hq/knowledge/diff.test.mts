import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CELLS, changeSummary, diffStats, lineDiff } from "./diff.ts";

const ops = (a: string, b: string) => lineDiff(a, b).map((l) => `${l.op === "same" ? " " : l.op === "add" ? "+" : "-"}${l.text}`);

test("identical text has no changes", () => {
  assert.deepEqual(ops("a\nb", "a\nb"), [" a", " b"]);
});

test("an added line in the middle", () => {
  assert.deepEqual(ops("a\nb\nc", "a\nb\nx\nc"), [" a", " b", "+x", " c"]);
});

test("a changed line is a removal and an addition", () => {
  assert.deepEqual(ops("a\nb\nc", "a\nB\nc"), [" a", "-b", "+B", " c"]);
});

test("from nothing and to nothing", () => {
  assert.deepEqual(ops("", "a\nb"), ["+a", "+b"]);
  assert.deepEqual(ops("a", ""), ["-a"]);
});

test("reordering is found by the common subsequence", () => {
  const d = lineDiff("1\n2\n3\n4", "2\n3\n4\n1");
  assert.equal(d.filter((l) => l.op === "same").length, 3);
  assert.equal(d.filter((l) => l.op !== "same").length, 2);
});

test("a very large middle falls back to removed-then-added, quickly", () => {
  const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 10;
  const a = Array.from({ length: n }, (_, i) => `a${i}`).join("\n");
  const b = Array.from({ length: n }, (_, i) => `b${i}`).join("\n");
  const t = Date.now();
  const d = lineDiff(a, b);
  assert.ok(Date.now() - t < 2000);
  assert.equal(d.length, 2 * n);
  assert.equal(d[0].op, "del");
  assert.equal(d[d.length - 1].op, "add");
});

test("stats count lines and name the sections they are in", () => {
  const before = "# Doc\n\n## Steps\n1. one\n2. two\n\n## Owner\nSam";
  const after = "# Doc\n\n## Steps\n1. one\n2. two\n3. three\n\n## Owner\nPat";
  const s = diffStats(lineDiff(before, after));
  assert.deepEqual(s, { added: 2, removed: 1, sections: ["Steps", "Owner"] });
});

test("the plain summary", () => {
  const base = { title: "A", summary: null, body: "## Steps\n1. one" };
  assert.equal(changeSummary(base, base), "No changes.");
  assert.equal(changeSummary(base, { ...base, body: "## Steps\n1. one\n2. two" }), 'Text: 1 line added (in "Steps").');
  assert.equal(changeSummary(base, { ...base, title: "B", summary: "S" }), 'Title changed from "A" to "B"; summary added.');
  assert.equal(changeSummary(base, { ...base, body: "## Steps\n1. one " }), "Text: 1 line added, 1 line removed (in \"Steps\").");
});
