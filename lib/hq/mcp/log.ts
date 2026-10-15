/*
 * Per-call logging for the MCP endpoint, through the Phase 3 RPCs (docs/hq-phase-3.md
 * section 6): `ai_begin_request` opens one `hq.ai_requests` row per tool call (and is
 * where the database's hourly limit is enforced), `ai_finish_request` closes it.
 *
 * What is stored as the "question" is NEVER free text from the chat: only
 *   "mcp <read|write> <tool name>" plus the argument NAMES whose values are record ids
 * (uuids, or `kind:uuid` ids from search/fetch), for example
 *   "mcp write update_task task_id=6b0c...". Names, notes, search words and anything else a
 * person typed stay out of the log. The database's audit event stores only the length.
 *
 * The OAuth client id is recorded in the same summary ("via <client id>") so a director
 * can see which connected app made a call.
 *
 * Pure functions are exported for log.test.mts; the RPC wrappers take the client as an
 * argument so this file has no project imports.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_ID = /^[a-z_]{1,32}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ARG_NAME = /^[a-z][a-z0-9_]{0,63}$/i;
const CLIENT_ID = /^[A-Za-z0-9\-_.:]{1,100}$/;
/** The database caps the question at 2000 characters. */
const MAX_SUMMARY = 1900;

export type CallKind = "read" | "write";
export type FinishStatus = "answered" | "refused" | "error" | "rate_limited";

function isId(v: unknown): v is string {
  return typeof v === "string" && (UUID.test(v) || PREFIXED_ID.test(v));
}

/** "mcp write update_task task_id=<uuid> via <client>": tool name and ids only. */
export function callSummary(tool: string, kind: CallKind, args: unknown, clientId: string): string {
  const parts = [`mcp ${kind} ${tool}`];
  if (args && typeof args === "object" && !Array.isArray(args)) {
    for (const [name, value] of Object.entries(args as Record<string, unknown>)) {
      if (!ARG_NAME.test(name)) continue;
      if (isId(value)) parts.push(`${name}=${value.toLowerCase()}`);
      else if (Array.isArray(value)) {
        const ids = value.filter(isId).slice(0, 10);
        if (ids.length > 0) parts.push(`${name}=${ids.map((x) => x.toLowerCase()).join(",")}`);
      }
    }
  }
  if (CLIENT_ID.test(clientId)) parts.push(`via ${clientId}`);
  const s = parts.join(" ");
  return s.length > MAX_SUMMARY ? s.slice(0, MAX_SUMMARY) : s;
}

/** The prefix every write-call summary starts with (the write cap counts these). */
export const WRITE_PREFIX = "mcp write ";

export type BeginOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "disabled" | "rate_limited" | "forbidden" | "error" };

/** Maps an ai_begin_request error to an outcome (SQLSTATEs from hq-phase-3.md section 6). */
export function beginErrorReason(error: { code?: string | null; hint?: string | null }): "disabled" | "rate_limited" | "forbidden" | "error" {
  if (error.code === "55000" || error.hint === "ai_disabled") return "disabled";
  if (error.code === "54000" || error.hint === "ai_rate_limited") return "rate_limited";
  if (error.code === "42501") return "forbidden";
  return "error";
}

type RpcError = { code?: string | null; hint?: string | null; message?: string } | null;
/** The slice of a supabase client this file needs (kept structural so tests can fake it). */
export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
};

export async function beginCall(db: RpcClient, summary: string): Promise<BeginOutcome> {
  const { data, error } = await db.rpc("ai_begin_request", { p_question: summary });
  if (error) {
    const reason = beginErrorReason(error);
    if (reason === "error") console.error("[hq mcp] ai_begin_request failed:", error.code ?? "unknown");
    return { ok: false, reason };
  }
  return typeof data === "string" ? { ok: true, id: data } : { ok: false, reason: "error" };
}

export async function finishCall(db: RpcClient, id: string, tool: string, status: FinishStatus): Promise<void> {
  const { error } = await db.rpc("ai_finish_request", {
    p_id: id,
    p_tools: [tool],
    p_status: status,
    p_input_tokens: null,
    p_output_tokens: null,
  });
  // Never fails the call the person made; the row stays "started", which is visible in the log.
  if (error) console.error("[hq mcp] ai_finish_request failed:", error.code ?? "unknown");
}
