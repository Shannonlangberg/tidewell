/*
 * Pure helpers for get_brand_resource (brand.ts): how a text file is cut into parts a chat app can take, and how
 * its text is laid out for the data block. Kept apart so brand-text.test.mts can run under `node --test`.
 */
import { neutraliseMarkers } from "./core";

/** The largest text file whose content a chat app is handed (bytes). Larger: a link only. */
export const INLINE_MAX_BYTES = 60_000;
/** Characters of file content in one reply (the reply as a whole is capped at 12,000 characters by core.ts). */
export const CHUNK_CHARS = 9_000;

/** File text for the data block: line breaks and indentation kept (it is code), control characters out, the block markers neutralised. */
export function contentLines(text: string): string[] {
  return neutraliseMarkers(text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")).split("\n");
}

/** Where the next part of a long text starts: on a line break near the budget, so a line is not cut in half. */
export function partEnd(text: string, start: number, chunk: number = CHUNK_CHARS): number {
  const end = Math.min(text.length, start + chunk);
  if (end >= text.length) return text.length;
  const nl = text.lastIndexOf("\n", end);
  return nl > start + chunk / 2 ? nl + 1 : end;
}
