/*
 * A small line diff for comparing two versions of a knowledge document, and a plain-language summary
 * of what changed. Lines common to both ends are trimmed first; the middle is compared with a longest
 * common subsequence. A very large middle (more than MAX_CELLS comparisons) is shown as "removed then
 * added" rather than computed, so a 50,000-character document can never stall a page or a tool call.
 *
 * Pure, no imports: unit-tested by diff.test.mts.
 */

export type DiffLine = { op: "same" | "add" | "del"; text: string };

export const MAX_CELLS = 2_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  if (before === "") a.length = 0;
  if (after === "") b.length = 0;

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ op: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ op: "same", text }));
  const ma = a.slice(start, endA);
  const mb = b.slice(start, endB);

  let middle: DiffLine[];
  if (ma.length === 0) middle = mb.map((text) => ({ op: "add", text }));
  else if (mb.length === 0) middle = ma.map((text) => ({ op: "del", text }));
  else if (ma.length * mb.length > MAX_CELLS) middle = [...ma.map((text) => ({ op: "del" as const, text })), ...mb.map((text) => ({ op: "add" as const, text }))];
  else middle = lcs(ma, mb);
  return [...head, ...middle, ...tail];
}

function lcs(a: readonly string[], b: readonly string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // table[i][j] = LCS length of a[i..] and b[j..], flattened
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
      out.push({ op: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ op: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}

export type DiffStats = { added: number; removed: number; sections: string[] };

/** Counts of non-blank lines added and removed, and the headings of the sections they sit in. */
export function diffStats(lines: readonly DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  const sections: string[] = [];
  let heading = "";
  for (const l of lines) {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l.text.trim());
    if (h && l.op !== "del") heading = h[1];
    if (l.op === "same" || !l.text.trim()) continue;
    if (l.op === "add") added += 1;
    else removed += 1;
    const name = h ? h[1] : heading;
    if (name && !sections.includes(name)) sections.push(name);
  }
  return { added, removed, sections };
}

const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/**
 * One plain sentence about what changed between two versions of a document, for the history, the
 * version page and the chat tools. Title and summary changes are named; text changes are counted and
 * placed under their headings.
 */
export function changeSummary(
  before: { title: string; summary: string | null; body: string },
  after: { title: string; summary: string | null; body: string },
): string {
  const parts: string[] = [];
  if (before.title !== after.title) parts.push(`title changed from "${before.title}" to "${after.title}"`);
  if ((before.summary ?? "") !== (after.summary ?? "")) parts.push(!before.summary ? "summary added" : !after.summary ? "summary removed" : "summary reworded");
  if (before.body !== after.body) {
    const s = diffStats(lineDiff(before.body, after.body));
    const counts = [s.added ? `${lines(s.added)} added` : null, s.removed ? `${lines(s.removed)} removed` : null].filter(Boolean).join(", ");
    const where = s.sections.length ? ` (in ${s.sections.slice(0, 4).map((x) => `"${x}"`).join(", ")}${s.sections.length > 4 ? ` and ${s.sections.length - 4} more` : ""})` : "";
    parts.push(counts ? `text: ${counts}${where}` : "text: spacing only");
  }
  if (parts.length === 0) return "No changes.";
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
