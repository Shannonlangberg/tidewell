/*
 * A deliberately small markdown reader for knowledge documents. It turns text into a tree of plain
 * blocks and inline pieces; components/hq/features/knowledge/KnowledgeMarkdown.tsx renders the tree
 * with ordinary React elements, so every piece of text is escaped by React and nothing is ever
 * inserted as HTML.
 *
 * Supported (and nothing else): headings (#, ##, ###; deeper levels read as ###), paragraphs,
 * bullet lists (- or *), numbered lists (1. or 1)), checklists (- [ ] and - [x], shown as boxes that
 * cannot be ticked), **bold**, *italic* (and _italic_), links [text](url) to http, https and mailto
 * only, and a horizontal rule (---, ***, ___). Raw HTML, images, tables, code and nesting are shown as
 * the text they are. A link to any other scheme (javascript:, data:, a relative path) keeps its words
 * and loses the link.
 *
 * Pure, no imports: unit-tested by markdown.test.mts.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type ListItem = { children: Inline[]; checked: boolean | null };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; checklist: boolean; items: ListItem[] }
  | { type: "hr" };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;

/** An href for a link, or null when the scheme is not http, https or mailto (or it does not parse). */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url || /[\u0000-\u001f\u007f\s<>"'`]/.test(url)) return null;
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "mailto:") return null;
    if (u.protocol !== "mailto:" && !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Inline marks in one line or paragraph. Unclosed marks stay as the characters they are. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (depth < 4 && ch === "[") {
      const m = /^\[([^\]\n]{1,500})\]\(([^()\s]{1,2000})\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        const children = parseInline(m[1], depth + 1);
        if (href) out.push({ type: "link", href, children });
        else {
          for (const c of children) {
            if (c.type === "text") pushText(out, c.text);
            else out.push(c);
          }
        }
        i += m[0].length;
        continue;
      }
    }
    if (depth < 4 && ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2 && !/\s/.test(src[i + 2]) && !/\s/.test(src[end - 1])) {
        out.push({ type: "strong", children: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 4 && (ch === "*" || ch === "_") && src[i + 1] !== ch) {
      const prev = i > 0 ? src[i - 1] : " ";
      // _ inside a word (snake_case) is not emphasis
      if (ch === "*" || !/[A-Za-z0-9]/.test(prev)) {
        const end = src.indexOf(ch, i + 1);
        const next = end >= 0 ? src[end + 1] ?? " " : " ";
        if (end > i + 1 && !/\s/.test(src[i + 1]) && !/\s/.test(src[end - 1]) && (ch === "*" || !/[A-Za-z0-9]/.test(next))) {
          out.push({ type: "em", children: parseInline(src.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** The whole document as blocks. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { type: "list" }> | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = HEADING.exec(line.trim());
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(3, h[1].length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, children: parseInline(h[2]) });
      continue;
    }
    if (HR.test(line)) {
      flushPara();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    if (b || n) {
      flushPara();
      const ordered = !!n;
      const content = b ? b[1] : n![2];
      const c = !ordered ? CHECK.exec(content) : null;
      const item: ListItem = c ? { children: parseInline(c[2]), checked: c[1] !== " " } : { children: parseInline(content), checked: null };
      const checklist = item.checked !== null;
      const current = list as Extract<Block, { type: "list" }> | null;
      if (!current || current.ordered !== ordered || current.checklist !== checklist) {
        flushList();
        list = { type: "list", ordered, start: n ? Math.max(1, Number(n[1])) : 1, checklist, items: [] };
      }
      list!.items.push(item);
      continue;
    }
    // a line that continues a list item (indented text under it)
    const cur = list as Extract<Block, { type: "list" }> | null;
    if (cur && /^\s{2,}\S/.test(line)) {
      const last = cur.items[cur.items.length - 1];
      last.children.push({ type: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** The plain words of inline pieces (for tests, excerpts and accessible names). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text : inlineText(n.children))).join("");
}
