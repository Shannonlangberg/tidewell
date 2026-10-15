// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { bearerToken, createTokenVerifier, principalFromClaims, protectedResourceMetadata, publicOrigin, resourceUrls, wwwAuthenticate } from "./auth.ts";

const SUPA = "https://example-ref.supabase.co";
const ISS = `${SUPA}/auth/v1`;
const NOW = 1_800_000_000;

async function setup() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; exp?: number; kid?: string; key?: CryptoKey } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "k1" })
      .setIssuer(opts.iss ?? ISS)
      .setIssuedAt(NOW - 10)
      .setExpirationTime(opts.exp ?? NOW + 3600)
      .sign(opts.key ?? privateKey);
  const verify = createTokenVerifier({ supabaseUrl: SUPA, keys, now: () => NOW, localHs256Secret: null });
  return { sign, verify };
}

const GOOD = { sub: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", client_id: "22222222-2222-4222-8222-222222222222", aal: "aal1" };

test("an OAuth token from this project is accepted, with the person and the client", async () => {
  const { sign, verify } = await setup();
  const r = await verify(await sign(GOOD));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.principal.userId, GOOD.sub);
    assert.equal(r.principal.clientId, GOOD.client_id);
    assert.equal(r.principal.aal, "aal1");
  }
});

test("no token is 'missing'; garbage is 'invalid'", async () => {
  const { verify } = await setup();
  assert.deepEqual(await verify(null), { ok: false, reason: "missing" });
  assert.deepEqual(await verify("not-a-jwt"), { ok: false, reason: "invalid" });
  assert.deepEqual(await verify("a.b.c"), { ok: false, reason: "invalid" });
});

test("an ordinary browser session token (no client_id) is refused", async () => {
  const { sign, verify } = await setup();
  const { client_id: _drop, ...session } = GOOD;
  void _drop;
  assert.equal((await verify(await sign(session))).ok, false);
});

test("expired, wrong issuer, wrong audience, wrong role, no subject: refused", async () => {
  const { sign, verify } = await setup();
  assert.equal((await verify(await sign(GOOD, { exp: NOW - 60 }))).ok, false);
  assert.equal((await verify(await sign(GOOD, { iss: "https://other.supabase.co/auth/v1" }))).ok, false);
  assert.equal((await verify(await sign({ ...GOOD, aud: "something-else" }))).ok, false);
  assert.equal((await verify(await sign({ ...GOOD, role: "service_role" }))).ok, false);
  assert.equal((await verify(await sign({ ...GOOD, role: "anon" }))).ok, false);
  const { sub: _s, ...noSub } = GOOD;
  void _s;
  assert.equal((await verify(await sign(noSub))).ok, false);
});

test("a token signed by another key (forged) is refused", async () => {
  const { sign, verify } = await setup();
  const other = await generateKeyPair("ES256");
  assert.equal((await verify(await sign(GOOD, { key: other.privateKey }))).ok, false);
  assert.equal((await verify(await sign(GOOD, { key: other.privateKey, kid: "unknown" }))).ok, false);
});

test("HS256 is refused unless a local secret is configured, and alg none always", async () => {
  const secret = "local-dev-secret-local-dev-secret-0123";
  const hs = await new SignJWT(GOOD).setProtectedHeader({ alg: "HS256" }).setIssuer(ISS).setExpirationTime(NOW + 600).sign(new TextEncoder().encode(secret));
  const strict = createTokenVerifier({ supabaseUrl: SUPA, now: () => NOW, localHs256Secret: null, keys: createLocalJWKSet({ keys: [] }) });
  assert.equal((await strict(hs)).ok, false);
  const local = createTokenVerifier({ supabaseUrl: SUPA, now: () => NOW, localHs256Secret: secret, keys: createLocalJWKSet({ keys: [] }) });
  assert.equal((await local(hs)).ok, true);
  const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ ...GOOD, iss: ISS, exp: NOW + 600 })).toString("base64url")}.`;
  assert.equal((await local(none)).ok, false);
});

test("principalFromClaims accepts an audience array that includes authenticated", () => {
  assert.ok(principalFromClaims({ ...GOOD, aud: ["authenticated", "x"], exp: NOW + 60 }, "t", NOW));
  assert.equal(principalFromClaims({ ...GOOD, client_id: "", exp: NOW + 60 }, "t", NOW), null);
});

test("bearer header parsing", () => {
  assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("bearer abc.def.ghi"), "abc.def.ghi");
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer "), null);
  assert.equal(bearerToken("Bearer a b"), null);
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken(`Bearer ${"a".repeat(9000)}`), null);
});

test("401 challenge and metadata point at the path-suffixed well-known document", () => {
  const u = resourceUrls("https://hq.example.com/");
  assert.equal(u.resource, "https://hq.example.com/mcp");
  assert.equal(u.metadata, "https://hq.example.com/.well-known/oauth-protected-resource/mcp");
  assert.equal(wwwAuthenticate(u.metadata, "missing"), `Bearer resource_metadata="${u.metadata}"`);
  assert.match(wwwAuthenticate(u.metadata, "invalid"), /error="invalid_token"/);
  const m = protectedResourceMetadata("https://hq.example.com", SUPA + "/");
  assert.deepEqual(m.authorization_servers, [ISS]);
  assert.equal(m.resource, "https://hq.example.com/mcp");
});

test("public origin: configured value wins when valid, then the Host the client used", () => {
  const req = (url: string, h: Record<string, string> = {}) => ({ url, headers: { get: (n: string) => h[n.toLowerCase()] ?? null } });
  assert.equal(publicOrigin(req("http://localhost:3350/mcp", { host: "mcp.localhost:3350" }), undefined), "http://mcp.localhost:3350");
  assert.equal(publicOrigin(req("http://internal:8080/mcp", { host: "x", "x-forwarded-host": "hq.example.com", "x-forwarded-proto": "https" }), undefined), "https://hq.example.com");
  assert.equal(publicOrigin(req("http://internal:8080/mcp"), "https://tidewellcc.netlify.app"), "https://tidewellcc.netlify.app");
  assert.equal(publicOrigin(req("http://internal:8080/mcp"), "javascript:alert(1)"), "http://internal:8080");
  assert.equal(publicOrigin(req("http://internal:8080/mcp", { host: "evil.com/path" }), undefined), "http://internal:8080");
});
