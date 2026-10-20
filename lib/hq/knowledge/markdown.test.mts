import test from "node:test";
import assert from "node:assert/strict";
import { inlineText, parseInline, parseMarkdown, safeHref, type Block, type Inline } from "./markdown.ts";

/*
 * The knowledge renderer's reader. React renders the tree it returns as text nodes, so "escaping" here
 * means: nothing that looks like HTML ever becomes anything but text, and no link leaves the three
 * allowed schemes.
 */

const all = (blocks: Block[]): Inline[] =>
  blocks.flatMap((b) => (b.type === "heading" || b.type === "paragraph" ? b.children : b.type === "list" ? b.items.flatMap((i) => i.children) : []));
const deep = (nodes: Inline[]): Inline[] => nodes.flatMap((n) => (n.type === "text" ? [n] : [n, ...deep(n.children)]));

test("headings, paragraphs and a rule", () => {
  const b = parseMarkdown("# Title\n\nFirst line\nsecond line\n\n## Part\n### Small\n#### Deeper\n---\nEnd");
  assert.deepEqual(
    b.map((x) => x.type + (x.type === "heading" ? x.level : "")),
    ["heading1", "paragraph", "heading2", "heading3", "heading3", "hr", "paragraph"],
  );
  assert.equal(inlineText((b[1] as Extract<Block, { type: "paragraph" }>).children), "First line second line");
});

test("bullet, numbered and checklist lists stay separate", () => {
  const b = parseMarkdown("- one\n* two\n\n1. first\n2) second\n\n- [ ] to do\n- [x] done");
  assert.equal(b.length, 3);
  const [bul, num, chk] = b as Extract<Block, { type: "list" }>[];
  assert.equal(bul.ordered, false);
  assert.equal(bul.items.length, 2);
  assert.equal(num.ordered, true);
  assert.equal(num.start, 1);
  assert.equal(chk.checklist, true);
  assert.deepEqual(chk.items.map((i) => [inlineText(i.children), i.checked]), [["to do", false], ["done", true]]);
});

test("a numbered list keeps its starting number", () => {
  const [l] = parseMarkdown("3. third\n4. fourth") as Extract<Block, { type: "list" }>[];
  assert.equal(l.start, 3);
});

test("bold, italic and links", () => {
  const n = parseInline("a **bold** and *it* and _also_ [site](https://example.test/x)");
  assert.deepEqual(
    n.map((x) => x.type),
    ["text", "strong", "text", "em", "text", "em", "text", "link"],
  );
  const link = n[n.length - 1] as Extract<Inline, { type: "link" }>;
  assert.equal(link.href, "https://example.test/x");
  assert.equal(inlineText(link.children), "site");
});

test("snake_case and lone stars are left as text", () => {
  assert.deepEqual(parseInline("file_name_here and 2 * 3"), [{ type: "text", text: "file_name_here and 2 * 3" }]);
  assert.deepEqual(parseInline("**unclosed"), [{ type: "text", text: "**unclosed" }]);
});

test("raw HTML is only ever text", () => {
  const src = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n# <b>Heading</b>\n\n- <a href="javascript:alert(1)">x</a>';
  const nodes = deep(all(parseMarkdown(src)));
  assert.ok(nodes.every((n) => n.type === "text"), "no element of any kind comes out of HTML");
  assert.ok(inlineText(all(parseMarkdown(src))).includes("<script>alert(1)</script>"), "the characters are kept as text");
});

test("links: only http, https and mailto", () => {
  assert.equal(safeHref("https://plantedproperty.com.au/a?b=1"), "https://plantedproperty.com.au/a?b=1");
  assert.equal(safeHref("http://example.test"), "http://example.test/");
  assert.equal(safeHref("mailto:hello@example.test"), "mailto:hello@example.test");
  for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "/hq/knowledge", "//evil.test", "ftp://x.test", "https://", "java\nscript:alert(1)", " javascript:alert(1)"]) {
    assert.equal(safeHref(bad), null, bad);
  }
  const n = parseInline("[click](javascript:alert(1)) and [ok](mailto:a@b.test)");
  assert.ok(!n.some((x) => x.type === "link" && !/^mailto:/.test(x.href)), "the javascript link lost its link");
  assert.ok(inlineText(n).includes("click"), "but kept its words");
});

test("images are not images", () => {
  const n = deep(parseInline("![alt](https://example.test/a.png)"));
  assert.ok(!n.some((x) => (x as { type: string }).type === "image"));
  assert.ok(inlineText(parseInline("![alt](https://example.test/a.png)")).startsWith("!"));
});

test("nesting is bounded and text is never lost", () => {
  const src = "**".repeat(50) + "x" + "**".repeat(50);
  assert.ok(inlineText(parseInline(src)).includes("x"));
  const big = Array.from({ length: 3000 }, (_, i) => `- item ${i}`).join("\n");
  const [l] = parseMarkdown(big) as Extract<Block, { type: "list" }>[];
  assert.equal(l.items.length, 3000);
});

test("CR LF and tabs are read as ordinary lines", () => {
  const b = parseMarkdown("# A\r\n\r\n\t- tabbed item\r\n");
  assert.deepEqual(b.map((x) => x.type), ["heading", "list"]);
});
