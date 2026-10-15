/*
 * Bounds for the MCP endpoint (docs/hq-mcp.md section 2, "Safety nets").
 *
 * Two hourly caps per person:
 *  - every tool call (reads and writes) counts against the database's own limit,
 *    `hq.settings.ai_hourly_limit` (default 40), enforced inside `hq.ai_begin_request`
 *    with an advisory lock, so it is exact and cannot be bypassed from here;
 *  - write calls ALSO count against a lower write cap, checked here by counting the
 *    person's own write calls in the rolling hour (their own `hq.ai_requests` rows, read
 *    under RLS). The call being made is already logged when it is counted, so two writes
 *    racing each other both see each other: the cap can refuse one too many, never allow
 *    one too many.
 *
 * Pure (no imports) so `node --test` can run limits.test.mts.
 */

/** Default write cap per person per rolling hour. A safety bound, not a business figure. */
export const DEFAULT_WRITE_HOURLY_LIMIT = 15;
/** Upper bound on what HQ_MCP_WRITE_HOURLY_LIMIT may set. */
export const MAX_WRITE_HOURLY_LIMIT = 200;

/** Longest text a tool may return to the chat app (characters). Longer text is cut with a note. */
export const MAX_RESULT_CHARS = 20_000;
/** Largest structured result (JSON characters). Larger structured content is dropped; the text remains. */
export const MAX_STRUCTURED_CHARS = 40_000;
/** A tool must answer within this; Netlify's synchronous function limit is short. */
export const TOOL_TIMEOUT_MS = 8_000;
/** Largest request body /mcp accepts (bytes). Tool arguments are small. */
export const MAX_REQUEST_BYTES = 64 * 1024;

/** The write cap from the environment, clamped to 1..MAX; the default when unset or not a whole number. */
export function writeHourlyLimit(raw: string | undefined = process.env.HQ_MCP_WRITE_HOURLY_LIMIT): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_WRITE_HOURLY_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n)) return DEFAULT_WRITE_HOURLY_LIMIT;
  return Math.min(Math.max(n, 1), MAX_WRITE_HOURLY_LIMIT);
}

/** True when `countIncludingThis` write calls in the hour is more than the cap allows. */
export function overWriteCap(countIncludingThis: number, cap: number): boolean {
  return countIncludingThis > cap;
}

/** Cuts text to the result cap, saying so, so the chat app never silently sees half a record. */
export function capText(text: string, max: number = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  const note = "\n\n[Result shortened: it was longer than this connection returns. Ask for something narrower.]";
  return text.slice(0, Math.max(0, max - note.length)) + note;
}

/** The structured result if it is small enough to send, else undefined. */
export function capStructured(structured: Record<string, unknown> | undefined, max: number = MAX_STRUCTURED_CHARS): Record<string, unknown> | undefined {
  if (!structured) return undefined;
  try {
    return JSON.stringify(structured).length <= max ? structured : undefined;
  } catch {
    return undefined;
  }
}

/** Rejects after `ms` with a TimeoutError so a slow tool cannot hold the function open. */
export function withTimeout<T>(work: Promise<T>, ms: number = TOOL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("tool timed out"), { name: "TimeoutError" })), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
