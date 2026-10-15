import { supabaseUrl } from "@/lib/supabase/env";
import { protectedResourceMetadata, publicOrigin } from "./auth";

/*
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for Planted HQ's MCP endpoint.
 * MCP clients (ChatGPT, Claude) read this to find the authorization server, which is the
 * project's Supabase Auth. Public and harmless, so any origin may read it.
 */
export function metadataResponse(req: Request): Response {
  let body: unknown;
  try {
    body = protectedResourceMetadata(publicOrigin(req), supabaseUrl());
  } catch {
    return new Response(JSON.stringify({ error: "not_configured" }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
