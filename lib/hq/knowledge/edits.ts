/*
 * Targeted edits to a knowledge document's text, so a chat app can change one part of a long document
 * without sending the whole of it back. Each returns the new text, or a plain refusal: a match that is
 * missing or ambiguous is never guessed. The result is saved as a NEW DRAFT version like any other edit.
 *
 *   replace_text    exactly one occurrence of old_text becomes new_text (empty new_text removes it)
 *   append_section  a new "## heading" section at the end (refused if that heading already exists)
 *   add_to_section  text added at the end of an existing section (before the next heading)
 *   replace_section the content under an existing heading is replaced (the heading stays)
 *
 * Pure, no imports: unit-tested by edits.test.mts.
 */

export const EDIT_OPS = ["replace_text", "append_section", "add_to_section", "replace_section"] as const;
export type EditOp = (typeof EDIT_OPS)[number];

export type EditResult = { ok: true; body: string } | { ok: false; message: string };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

const key = (s: string) => s.replace(/^#+\s*/, "").replace(/\s*#*\s*$/, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

type Section = { heading: string; level: number; line: number; end: number };

/** Every heading with the line it is on and the line its section ends before. */
export function sections(body: string): Section[] {
  const lines = body.split("\n");
  const found: Section[] = [];
  lines.forEach((l, i) => {
    const m = HEADING.exec(l.trim());
    if (m) found.push({ heading: m[2], level: m[1].length, line: i, end: lines.length });
  });
  for (let i = 0; i < found.length; i += 1) {
    const next = found.slice(i + 1).find((s) => s.level <= found[i].level);
    if (next) found[i].end = next.line;
  }
  return found;
}

/** The headings of a document, for a refusal that lists what can be named. */
export function headingList(body: string, max = 20): string {
  const list = sections(body).map((s) => `"${s.heading}"`);
  if (list.length === 0) return "it has no headings";
  return `its headings are ${list.slice(0, max).join(", ")}${list.length > max ? ` and ${list.length - max} more` : ""}`;
}

function findSection(body: string, heading: string): { ok: true; section: Section } | { ok: false; message: string } {
  const want = key(heading);
  if (!want) return { ok: false, message: "Say which heading (section) to change." };
  const hits = sections(body).filter((s) => key(s.heading) === want);
  if (hits.length === 0) return { ok: false, message: `No section is headed "${heading.trim().slice(0, 80)}"; ${headingList(body)}.` };
  if (hits.length > 1) return { ok: false, message: `${hits.length} sections are headed "${heading.trim().slice(0, 80)}". Use replace_text with the exact words to change instead.` };
  return { ok: true, section: hits[0] };
}

/** The text of one section, heading included (for reading a long document a part at a time). */
export function sectionText(body: string, heading: string): EditResult {
  const f = findSection(body, heading);
  if (!f.ok) return f;
  return { ok: true, body: body.split("\n").slice(f.section.line, f.section.end).join("\n").replace(/\s+$/, "") };
}

const tidy = (s: string) => s.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");

/** Exactly one occurrence of `oldText` becomes `newText`. Missing or several matches are refused. */
export function replaceText(body: string, oldText: string, newText: string): EditResult {
  const from = oldText.replace(/\r\n?/g, "\n");
  if (!from.trim()) return { ok: false, message: "Give the exact words to replace (old_text)." };
  const first = body.indexOf(from);
  if (first < 0) return { ok: false, message: "The words to replace (old_text) were not found exactly in the current text. Read the document again and copy them exactly." };
  if (body.indexOf(from, first + 1) >= 0) return { ok: false, message: "The words to replace (old_text) appear more than once. Include more of the surrounding words so they match exactly one place." };
  return { ok: true, body: body.slice(0, first) + newText.replace(/\r\n?/g, "\n") + body.slice(first + from.length) };
}

/** A new section at the end, headed `## heading` (or at the given level). */
export function appendSection(body: string, heading: string, text: string, level = 2): EditResult {
  const h = heading.replace(/[\r\n]+/g, " ").replace(/^#+\s*/, "").trim();
  const t = tidy(text);
  if (!h) return { ok: false, message: "A new section needs a heading." };
  if (!t) return { ok: false, message: "A new section needs some text." };
  if (sections(body).some((s) => key(s.heading) === key(h))) {
    return { ok: false, message: `A section headed "${h.slice(0, 80)}" already exists. Use add_to_section to add to it, or replace_section to rewrite it.` };
  }
  const marks = "#".repeat(Math.min(6, Math.max(1, level)));
  return { ok: true, body: `${body.replace(/\s+$/, "")}\n\n${marks} ${h}\n\n${t}` };
}

/** Text added at the end of an existing section (before the next heading of the same or a higher level). */
export function addToSection(body: string, heading: string, text: string): EditResult {
  const t = tidy(text);
  if (!t) return { ok: false, message: "Give the text to add." };
  const f = findSection(body, heading);
  if (!f.ok) return f;
  const lines = body.split("\n");
  let at = f.section.end;
  while (at > f.section.line + 1 && !lines[at - 1].trim()) at -= 1;
  // a list item directly after a list joins it; anything else starts a new paragraph
  const item = /^\s*([-*+]|\d{1,9}[.)])\s+/;
  const joins = at > f.section.line + 1 && item.test(t) && item.test(lines[at - 1]);
  const rest = lines.slice(at);
  const out = [...lines.slice(0, at), ...(joins ? [] : [""]), ...t.split("\n"), ...(rest.length && rest[0].trim() ? [""] : []), ...rest];
  return { ok: true, body: out.join("\n").replace(/\n{3,}/g, "\n\n") };
}

/** The content under an existing heading is replaced; the heading itself stays. */
export function replaceSection(body: string, heading: string, text: string): EditResult {
  const t = tidy(text);
  if (!t) return { ok: false, message: "Give the new text for the section." };
  const f = findSection(body, heading);
  if (!f.ok) return f;
  const lines = body.split("\n");
  const before = lines.slice(0, f.section.line + 1);
  const after = lines.slice(f.section.end);
  const out = [...before, "", ...t.split("\n"), ...(after.length ? ["", ...after] : [])];
  return { ok: true, body: out.join("\n").replace(/\n{3,}/g, "\n\n") };
}

/** Runs one targeted edit by name. */
export function applyEdit(body: string, edit: { op: EditOp; heading?: string; text?: string; oldText?: string; newText?: string }): EditResult {
  switch (edit.op) {
    case "replace_text":
      return replaceText(body, edit.oldText ?? "", edit.newText ?? "");
    case "append_section":
      return appendSection(body, edit.heading ?? "", edit.text ?? "");
    case "add_to_section":
      return addToSection(body, edit.heading ?? "", edit.text ?? "");
    case "replace_section":
      return replaceSection(body, edit.heading ?? "", edit.text ?? "");
  }
}
