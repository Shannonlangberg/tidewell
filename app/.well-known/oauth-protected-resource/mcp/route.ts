import { metadataResponse } from "@/lib/hq/mcp/metadata";

/* RFC 9728 section 3.1: metadata for the resource https://<site>/mcp. Same document as the root path. */

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  return metadataResponse(req);
}
