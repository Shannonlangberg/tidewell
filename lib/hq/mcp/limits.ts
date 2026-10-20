/*
 * Bounds for the MCP endpoint (docs/hq-mcp.md section 2, "Safety nets"; docs/hq-projects.md
 * sections 0 and 2 for bulk).
 *
 * Three budgets per person:
 *  - every tool call (reads, writes and bulk calls) counts as ONE request against the database's
 *    own limit, `hq.settings.ai_hourly_limit` (default 40), enforced inside `hq.ai_begin_request`
 *    with an advisory lock, so it is exact and cannot be bypassed from here;
 *  - single-record write calls ALSO count against a lower write cap (default 60 per rolling hour,
 *    env HQ_MCP_WRITE_HOURLY_LIMIT, 1..200), checked here by counting the person's own write calls
 *    in the rolling hour (their own `hq.ai_requests` rows, read under RLS). The call being made is
 *    already logged when it is counted, so two writes racing each other both see each other: the
 *    cap can refuse one too many, never allow one too many;
 *  - bulk calls (bulk_create_tasks, bulk_update_tasks) do NOT count against the write cap. They
 *    spend the database's bulk budget instead (`hq.consume_bulk_budget`, inside the RPC, in the
 *    same transaction as the writes): at most `bulk_calls_per_hour` calls (default 6) and
 *    `bulk_items_per_hour` items (default 300) per person per rolling hour. Over it, the RPC
 *    raises SQLSTATE 54000 with hint `bulk_rate_limited` and nothing is written.
 *
 * Pure (no imports) so `node --test` can run limits.test.mts.
 */

/**
 * Default single-write cap per person per rolling hour. A safety bound, not a business figure.
 * Raised from 15 to 60 with the projects work (docs/hq-projects.md section 0): a person working
 * through a plan one task at a time reached 15 in a few minutes.
 */
export const DEFAULT_WRITE_HOURLY_LIMIT = 60;
/** Upper bound on what HQ_MCP_WRITE_HOURLY_LIMIT may set. */
export const MAX_WRITE_HOURLY_LIMIT = 200;

/** The bulk budget's defaults (the database holds the real values: settings bulk_calls_per_hour / bulk_items_per_hour). */
export const DEFAULT_BULK_CALLS_PER_HOUR = 6;
export const DEFAULT_BULK_ITEMS_PER_HOUR = 300;
/** Entries one bulk call may carry (the database refuses 0 and more than this too). */
export const MAX_BULK_ENTRIES = 50;

/** Longest text a tool may return to the chat app (characters). Longer text is cut with a note. */
export const MAX_RESULT_CHARS = 20_000;
/** Largest structured result (JSON characters). Larger structured content is dropped; the text remains. */
export const MAX_STRUCTURED_CHARS = 40_000;
/** A tool must answer within this; Netlify's synchronous function limit is short. */
export const TOOL_TIMEOUT_MS = 8_000;
/**
 * Largest request body /mcp accepts (bytes). Single-record tool arguments are small; a bulk plan of
 * 50 tasks with descriptions and checklists is the largest legitimate request (was 64 KiB before bulk).
 */
export const MAX_REQUEST_BYTES = 192 * 1024;
/**
 * Largest number of array elements plus object members one tools/call `arguments` may hold (the
 * SDK refuses more before parsing). Sized for the biggest bulk call the schemas allow: 50 entries x
 * (16 fields + 10 dependencies + 12 checklist items) plus the call's own fields, with headroom.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 2_500;

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

/** Whether a tool kind counts against the single-write cap. Bulk calls do not (their budget is in the database). */
export function countsAgainstWriteCap(kind: "read" | "write" | "bulk"): boolean {
  return kind === "write";
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
