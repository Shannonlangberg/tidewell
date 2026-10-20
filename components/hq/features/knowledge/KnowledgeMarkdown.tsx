import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/hq/knowledge/markdown";

/*
 * Renders a knowledge document's text with ordinary React elements from the tree that
 * lib/hq/knowledge/markdown.ts reads. Every piece of text is a React text node (escaped by React);
 * nothing is ever inserted as HTML; links are only http, https or mailto (the reader drops others) and
 * open in a new tab without access to this page. Checklist boxes are drawn, not form controls: they
 * cannot be ticked. A document's own "# Title" heading renders one level down (h2), under the page's h1.
 */

function inline(nodes: readonly Inline[], key = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    switch (n.type) {
      case "text":
        return n.text;
      case "strong":
        return <strong key={k}>{inline(n.children, k)}</strong>;
      case "em":
        return <em key={k}>{inline(n.children, k)}</em>;
      case "link":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(n.children, k)}
          </a>
        );
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.type) {
    case "heading": {
      const H = (b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
      return <H key={i}>{inline(b.children)}</H>;
    }
    case "paragraph":
      return <p key={i}>{inline(b.children)}</p>;
    case "hr":
      return <hr key={i} />;
    case "list": {
      if (b.checklist) {
        return (
          <ul key={i} className="hq-kb-checklist">
            {b.items.map((it, j) => (
              <li key={j} className="hq-kb-check">
                <span className="hq-kb-check__box" data-checked={it.checked ? "true" : "false"} aria-hidden="true" />
                <span>
                  <span className="sr-only">{it.checked ? "Done: " : "To do: "}</span>
                  {inline(it.children)}
                </span>
              </li>
            ))}
          </ul>
        );
      }
      const L = b.ordered ? "ol" : "ul";
      return (
        <L key={i} start={b.ordered && b.start !== 1 ? b.start : undefined}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it.children)}</li>
          ))}
        </L>
      );
    }
  }
}

export function KnowledgeMarkdown({ text, label }: { text: string; label?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="hq-kb-doc" aria-label={label}>
      {blocks.length ? blocks.map(block) : <p className="hq-muted">No text.</p>}
    </div>
  );
}
