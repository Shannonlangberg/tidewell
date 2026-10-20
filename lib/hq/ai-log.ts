/*
 * Reading the connected-app activity log (hq.ai_requests) for the "AI and connected apps" screen,
 * app/hq/(app)/settings/ai/page.tsx.
 *
 * Each MCP tool call is stored by lib/hq/mcp/log.ts as a "question" made of the tool name and
 * record ids only, never free text:  "mcp <read|write> <tool> [name=<id> ...] [via <client id>]".
 * parseAiQuestion() takes that apart for display. A row in any other shape (there are none today:
 * HQ has no in-app assistant) is shown as "other", and its text is not shown.
 *
 * Pure: no imports, so `node --test` can run it.
 */

export const AI_STATUSES = ["started", "answered", "refused", "error", "rate_limited"] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_STATUS_LABEL: Record<AiStatus, string> = {
  started: "Unfinished",
  answered: "Completed",
  refused: "Refused",
  error: "Failed",
  rate_limited: "Over the limit",
};

export const AI_STATUS_TONE: Record<AiStatus, "neutral" | "success" | "warning" | "error"> = {
  started: "neutral",
  answered: "success",
  refused: "warning",
  error: "error",
  rate_limited: "warning",
};

export function isAiStatus(v: unknown): v is AiStatus {
  return typeof v === "string" && (AI_STATUSES as readonly string[]).includes(v);
}

export type ParsedCall = { source: "mcp"; kind: "read" | "write"; tool: string; clientId: string | null } | { source: "other" };

const TOOL = /^[a-z][a-z0-9_]{0,63}$/;
const CLIENT = /^[A-Za-z0-9\-_.:]{1,100}$/;

/** "mcp write update_task task_id=<id> via <client>" -> { kind: "write", tool: "update_task", clientId: "<client>" }. */
export function parseAiQuestion(question: string): ParsedCall {
  const parts = question.trim().split(/\s+/);
  if (parts[0] !== "mcp" || (parts[1] !== "read" && parts[1] !== "write") || !TOOL.test(parts[2] ?? "")) return { source: "other" };
  const via = parts.lastIndexOf("via");
  const client = via > 2 && via === parts.length - 2 && CLIENT.test(parts[via + 1]) ? parts[via + 1] : null;
  return { source: "mcp", kind: parts[1], tool: parts[2], clientId: client };
}

/** A client id short enough for a table cell: the first 8 characters of a long id. The full id goes in a title. */
export function shortClientId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * The PostgREST `or` filter that finds one tool's calls by the stored summary (it covers unfinished
 * calls too, whose tools_used is still empty). The tool name must already be checked against the
 * tool list; this refuses anything that is not a plain tool name.
 */
export function toolFilter(tool: string): string | null {
  if (!TOOL.test(tool)) return null;
  return ["read", "write"].flatMap((k) => [`question.eq."mcp ${k} ${tool}"`, `question.like."mcp ${k} ${tool} *"`]).join(",");
}

export const MIN_HOURLY_LIMIT = 1;
export const MAX_HOURLY_LIMIT = 1000;

/** The hourly limit as typed in the form: a whole number from 1 to 1000 (the database's own bounds), or null. */
export function parseHourlyLimit(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!/^[0-9]{1,4}$/.test(v)) return null;
  const n = Number(v);
  return n >= MIN_HOURLY_LIMIT && n <= MAX_HOURLY_LIMIT ? n : null;
}

/** The stored settings as the screen shows them: off unless exactly true; the limit defaults to 40, as the database does. */
export function readAiSettings(byKey: ReadonlyMap<string, unknown>): { enabled: boolean; hourlyLimit: number } {
  const raw = byKey.get("ai_hourly_limit");
  const limit = typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_HOURLY_LIMIT && raw <= MAX_HOURLY_LIMIT ? raw : 40;
  return { enabled: byKey.get("ai_enabled") === true, hourlyLimit: limit };
}
