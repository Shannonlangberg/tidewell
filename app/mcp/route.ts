import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { supabaseUrl } from "@/lib/supabase/env";
import { bearerToken, createTokenVerifier, publicOrigin, resourceUrls, wwwAuthenticate } from "@/lib/hq/mcp/auth";
import { resolveAccess } from "@/lib/hq/mcp/context";
import { MAX_REQUEST_BYTES } from "@/lib/hq/mcp/limits";
import { buildMcpServer } from "@/lib/hq/mcp/server";
import { TOOLS } from "@/lib/hq/mcp/tools";

/*
 * Planted HQ's MCP endpoint (docs/hq-mcp.md). Streamable HTTP, STATELESS (no sessions,
 * no server-sent events): every POST carries its own bearer token and gets one JSON
 * response, so it fits a short serverless function.
 *
 *  - No token, or one that fails verification: 401 with
 *    `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
 *  - A valid OAuth token for someone who is not active staff, still owes the second step,
 *    or lacks `ai.use`: 403 and nothing else.
 *  - Otherwise: an MCP server listing only the tools this person may use, each running
 *    as the person (their token, row level security).
 *
 * GET (a server-sent-event stream) and DELETE (ending a session) do not apply to a
 * stateless server: 405 once authenticated. No cookies are read or set here, and no
 * secret key is used. Tokens are never logged.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const verify = createTokenVerifier({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  // Local stack only (as lib/auth.ts): production accepts asymmetric keys from the JWKS alone.
  localHs256Secret: process.env.NODE_ENV === "production" ? null : (process.env.SUPABASE_JWT_SECRET ?? null),
});

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...NO_STORE, ...extra } });
}

/** A JSON-RPC shaped error, which MCP clients surface better than a bare HTTP body. */
function rpcError(status: number, message: string, extra: Record<string, string> = {}): Response {
  return json(status, { jsonrpc: "2.0", error: { code: -32001, message }, id: null }, extra);
}

function withNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

type Authed = { ok: true; origin: string; principal: Parameters<typeof resolveAccess>[0] } | { ok: false; response: Response };

async function authenticate(req: Request): Promise<Authed> {
  // Fail closed if the project URL is missing (the verifier would have no issuer).
  try {
    supabaseUrl();
  } catch {
    return { ok: false, response: rpcError(500, "This server is not configured.") };
  }
  const origin = publicOrigin(req);
  const header = req.headers.get("authorization");
  const check = await verify(bearerToken(header));
  if (!check.ok) {
    // A header that was present but unusable is "invalid", not "missing".
    const reason = header ? "invalid" : check.reason;
    return {
      ok: false,
      response: rpcError(401, "Sign in to Planted HQ to use this connection.", {
        "WWW-Authenticate": wwwAuthenticate(resourceUrls(origin).metadata, reason),
      }),
    };
  }
  return { ok: true, origin, principal: check.principal };
}

export async function POST(req: Request): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) return rpcError(413, "Request too large.");

  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;

  const access = await resolveAccess(auth.principal, auth.origin);
  if (!access.ok) {
    if (access.reason === "error") return rpcError(500, "Something went wrong on our side. Try again in a moment.");
    const message =
      access.reason === "mfa_required"
        ? "Planted HQ needs your second sign-in step. Sign in to HQ again, then reconnect."
        : "This login does not have access to Planted HQ through a connected app.";
    return rpcError(403, message);
  }

  const server = buildMcpServer(access.ctx, TOOLS);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    return withNoStore(res);
  } catch (e) {
    console.error("[hq mcp] request failed:", e instanceof Error ? e.name : "unknown");
    return rpcError(500, "Something went wrong on our side. Try again in a moment.");
  } finally {
    // Stateless: nothing outlives the request. (JSON mode has resolved every response by now.)
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

async function notForStateless(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  return rpcError(405, "This server is stateless: send MCP requests with POST.", { Allow: "POST" });
}

export const GET = notForStateless;
export const DELETE = notForStateless;
