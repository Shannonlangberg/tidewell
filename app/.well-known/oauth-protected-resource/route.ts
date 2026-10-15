import { metadataResponse } from "@/lib/hq/mcp/metadata";

/*
 * Protected-resource metadata for /mcp at the root well-known path. The path-suffixed
 * twin (./mcp/route.ts, RFC 9728 section 3.1) is the one /mcp's 401 points to; both
 * return the same document.
 */

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return metadataResponse(req);
}
