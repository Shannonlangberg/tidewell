import { lineDiff, type DiffLine } from "@/lib/hq/knowledge/diff";

/*
 * An inline line diff between two versions: removed lines struck through on a soft red, added lines on a
 * soft green, each also marked with - or + (never colour alone). Unchanged stretches collapse to a line
 * saying how many lines were skipped, keeping two lines of context around each change.
 */

const CONTEXT = 2;

type Row = { kind: "line"; line: DiffLine } | { kind: "gap"; count: number };

function collapse(lines: readonly DiffLine[]): Row[] {
  const keep = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.op === "same") return;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(lines.length - 1, i + CONTEXT); j += 1) keep[j] = true;
  });
  const rows: Row[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) rows.push({ kind: "gap", count: skipped });
      skipped = 0;
      rows.push({ kind: "line", line: l });
    } else skipped += 1;
  });
  if (skipped) rows.push({ kind: "gap", count: skipped });
  return rows;
}

export function KnowledgeDiff({ before, after, label }: { before: string; after: string; label: string }) {
  const lines = lineDiff(before, after);
  if (!lines.some((l) => l.op !== "same")) return <p className="hq-muted">The text is the same in both versions.</p>;
  const rows = collapse(lines);
  return (
    <ol className="hq-kb-diff" aria-label={label}>
      {rows.map((r, i) =>
        r.kind === "gap" ? (
          <li key={i} className="hq-kb-diff__gap">
            {r.count} unchanged line{r.count === 1 ? "" : "s"}
          </li>
        ) : (
          <li key={i} className="hq-kb-diff__line" data-op={r.line.op}>
            <span className="hq-kb-diff__mark" aria-hidden="true">
              {r.line.op === "add" ? "+" : r.line.op === "del" ? "-" : ""}
            </span>
            <span>
              {r.line.op === "add" ? <span className="sr-only">Added: </span> : r.line.op === "del" ? <span className="sr-only">Removed: </span> : null}
              {r.line.text || " "}
            </span>
          </li>
        ),
      )}
    </ol>
  );
}
