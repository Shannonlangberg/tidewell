/*
 * The shared contract between the MCP transport (lib/hq/mcp/server.ts, builder M1)
 * and the tools (lib/hq/mcp/tools/**, builder M2). See docs/hq-mcp.md section 3.
 * Type-only: importing this file loads nothing at runtime.
 */
import type { z } from "zod";
import type { HqClient } from "@/lib/hq/db";

export type ToolContext = {
  /** Typed supabase client for schema hq, carrying the person's own token (RLS applies). */
  db: HqClient;
  staff: { id: string; fullName: string; role: string; capabilities: readonly string[]; timezone: string };
  /** OAuth client id from the token. */
  clientId: string;
  /** Site origin for building HQ page links. */
  baseUrl: string;
};

export type ToolResult = { text: string; structured?: Record<string, unknown> };

export type ToolDef<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /** Required HQ capability, or null for "any active staff". */
  capability: string | null;
  /**
   * read: counts only against the database's hourly limit (ai_hourly_limit).
   * write: also counts against the lower single-write cap (limits.ts writeHourlyLimit).
   * bulk: ONE call that writes many records in one database transaction (bulk_create_tasks,
   * bulk_update_tasks). It counts as ONE request against ai_hourly_limit and NOT against the
   * single-write cap; its own budget (calls and items per rolling hour) is enforced inside the
   * RPC by hq.consume_bulk_budget (docs/hq-projects.md section 2).
   */
  kind: "read" | "write" | "bulk";
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<ToolResult>;
};
