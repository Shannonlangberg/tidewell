/*
 * Bearer-token checks for the MCP endpoint (/mcp). docs/hq-mcp.md section 1.
 *
 * Supabase Auth is the authorization server; /mcp is the resource server. A token is
 * accepted only when it is:
 *   - a JWT signed by this project's key (verified LOCALLY against the JWKS, never by
 *     asking Supabase, and never with the secret key),
 *   - issued by this project's Auth (`iss` = <supabase url>/auth/v1),
 *   - for the `authenticated` audience and role, unexpired, with a subject,
 *   - and carrying a `client_id` claim. Supabase puts `client_id` only in tokens issued
 *     through the OAuth server, so an ordinary HQ browser session token is refused here
 *     even though it is otherwise a perfectly valid token for the same person.
 *
 * Signing: production must use an asymmetric key (ES256/RS256 from the JWKS). A
 * shared-secret HS256 token is accepted only outside production and only when
 * SUPABASE_JWT_SECRET is set, exactly as lib/auth.ts does for the local stack.
 *
 * Self-contained (jose only, no project imports, no `server-only`) so `node --test`
 * can run auth.test.mts against it. Tokens are never logged or echoed.
 */
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export const MCP_AUDIENCE = "authenticated";
/** A short tolerance for clock skew between Supabase and the function host. */
const CLOCK_TOLERANCE_S = 5;
/** Tokens are JWTs of a few hundred bytes to a couple of kB; anything far larger is not one of ours. */
const MAX_TOKEN_LENGTH = 8192;

export type McpPrincipal = {
  /** The person's auth user id. */
  userId: string;
  /** The OAuth client the person approved (dynamic registration id). */
  clientId: string;
  /** The verified token, passed on to Supabase so RLS runs as the person. */
  accessToken: string;
  aal: "aal1" | "aal2";
  exp: number;
};

export type TokenCheck = { ok: true; principal: McpPrincipal } | { ok: false; reason: "missing" | "invalid" };

/** The token from an `Authorization: Bearer <token>` header, or null. Query-string tokens are never read. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer[ ]+([A-Za-z0-9\-_.~+/]+=*)\s*$/i.exec(header);
  if (!m) return null;
  const token = m[1];
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** The claim checks after the signature has been verified. Pure; exported for tests. */
export function principalFromClaims(payload: JWTPayload, token: string, nowS: number): McpPrincipal | null {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_TOLERANCE_S <= nowS) return null;
  if (payload.role !== "authenticated") return null;
  const aud = payload.aud;
  const audOk = typeof aud === "string" ? aud === MCP_AUDIENCE : Array.isArray(aud) && aud.includes(MCP_AUDIENCE);
  if (!audOk) return null;
  const clientId = payload.client_id;
  if (typeof clientId !== "string" || clientId.length === 0 || clientId.length > 200) return null;
  return {
    userId: payload.sub,
    clientId,
    accessToken: token,
    aal: payload.aal === "aal2" ? "aal2" : "aal1",
    exp: payload.exp,
  };
}

export type VerifierOptions = {
  /** e.g. https://<ref>.supabase.co (no trailing slash). */
  supabaseUrl: string;
  /** Allow HS256 with this secret. Pass only outside production. */
  localHs256Secret?: string | null;
  /** Override the key source (tests). Defaults to the project's remote JWKS. */
  keys?: JWTVerifyGetKey;
  now?: () => number;
};

/** Builds a verifier bound to one project. The JWKS is fetched lazily and cached by jose. */
export function createTokenVerifier(opts: VerifierOptions) {
  const base = opts.supabaseUrl.replace(/\/+$/, "");
  const issuer = `${base}/auth/v1`;
  let keys = opts.keys ?? null;
  const getKeys = () => (keys ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  return async function verify(token: string | null): Promise<TokenCheck> {
    if (!token) return { ok: false, reason: "missing" };
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return { ok: false, reason: "invalid" };
    }
    try {
      let payload: JWTPayload;
      const common = { issuer, audience: MCP_AUDIENCE, clockTolerance: CLOCK_TOLERANCE_S, requiredClaims: ["exp", "sub"] };
      if (alg === "HS256") {
        if (!opts.localHs256Secret) return { ok: false, reason: "invalid" };
        ({ payload } = await jwtVerify(token, new TextEncoder().encode(opts.localHs256Secret), { ...common, algorithms: ["HS256"] }));
      } else if (alg === "ES256" || alg === "RS256") {
        ({ payload } = await jwtVerify(token, getKeys(), { ...common, algorithms: ["ES256", "RS256"] }));
      } else {
        return { ok: false, reason: "invalid" };
      }
      const principal = principalFromClaims(payload, token, now());
      return principal ? { ok: true, principal } : { ok: false, reason: "invalid" };
    } catch {
      // Bad signature, unknown key, wrong issuer or audience, expired: all the same to the caller.
      return { ok: false, reason: "invalid" };
    }
  };
}

/**
 * The 401 challenge (RFC 6750 + RFC 9728): tells the client where the protected-resource
 * metadata is, so it can discover Supabase as the authorization server. With a token that
 * failed, `error="invalid_token"` so clients refresh or re-authorise.
 */
export function wwwAuthenticate(resourceMetadataUrl: string, reason: "missing" | "invalid"): string {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl}"`];
  if (reason === "invalid") parts.push(`error="invalid_token"`, `error_description="The access token is missing, expired or not valid for this server"`);
  return parts.join(", ");
}

/** Where the MCP endpoint and its metadata live, for one public origin (no trailing slash). */
export function resourceUrls(origin: string) {
  const o = origin.replace(/\/+$/, "");
  return {
    /** The canonical resource identifier (RFC 8707 / RFC 9728): the MCP endpoint itself. */
    resource: `${o}/mcp`,
    /** RFC 9728 section 3.1: the well-known path with the resource's path appended. */
    metadata: `${o}/.well-known/oauth-protected-resource/mcp`,
    /** The root variant, for clients that only try that. */
    metadataRoot: `${o}/.well-known/oauth-protected-resource`,
  };
}

const HOST = /^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$|^\[[0-9A-Fa-f:]{2,39}\](:\d{1,5})?$/;

/**
 * The public origin of this site, as the client addressed it: HQ_PUBLIC_ORIGIN when set (an
 * absolute http(s) origin), else the Host header the request arrived with (Next's dev server
 * rewrites request.url to localhost, and a proxy may rewrite it too), else request.url's origin.
 * A spoofed Host only changes the answer sent back to whoever spoofed it.
 */
export function publicOrigin(
  req: { url: string; headers: { get(name: string): string | null } },
  configured: string | undefined = process.env.HQ_PUBLIC_ORIGIN,
): string {
  if (configured) {
    try {
      const u = new URL(configured);
      if (u.protocol === "https:" || u.protocol === "http:") return u.origin;
    } catch {
      // fall through to the request's origin
    }
  }
  const fallback = new URL(req.url);
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (!HOST.test(host)) return fallback.origin;
  const forwardedProto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : fallback.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** The RFC 9728 protected-resource metadata document for /mcp. */
export function protectedResourceMetadata(origin: string, supabaseUrl: string) {
  return {
    resource: resourceUrls(origin).resource,
    authorization_servers: [`${supabaseUrl.replace(/\/+$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    // Supabase's OAuth server has no custom scopes (openid, email, profile, phone only).
    // Access is decided per person by HQ's capabilities, not by scope.
    scopes_supported: ["email"],
    resource_name: "Planted HQ",
    resource_documentation: `${origin.replace(/\/+$/, "")}/hq/profile`,
  };
}
