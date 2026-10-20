// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FROM_ADDRESS,
  DEFAULT_FROM_NAME,
  SENDGRID_SEND_URL,
  chooseProvider,
  deliverWithSendGrid,
  fakeFailure,
  fakeProvider,
  fromMailbox,
  safeMessageId,
  sendGridBody,
  sendGridRequest,
  sendGridStatusCode,
  type OutgoingEmail,
} from "./provider.ts";

const KEY = "SG.test-key-never-real.abcdef";
const email: OutgoingEmail = {
  to: { email: "tim@partner.test", name: "Tim Hosking" },
  from: { email: DEFAULT_FROM_ADDRESS, name: DEFAULT_FROM_NAME },
  replyTo: { email: "shannon@planted.test", name: "Shannon Langberg" },
  subject: "Thank you",
  text: "Hi Tim",
  html: "<p>Hi Tim</p>",
};

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal } };
const okFetch = (calls: Call[], status = 202, id: string | null = "msg-123.abc") => async (url: string, init: Call["init"]) => {
  calls.push({ url, init });
  return { status, headers: { get: (n: string) => (n.toLowerCase() === "x-message-id" ? id : null) } };
};

test("the SendGrid v3 request: one recipient, From, Reply-To, text and HTML, tracking off", () => {
  const req = sendGridRequest(email, KEY);
  assert.equal(req.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(req.url, SENDGRID_SEND_URL);
  assert.equal(req.method, "POST");
  assert.deepEqual(req.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
  const body = JSON.parse(req.body);
  assert.deepEqual(body.personalizations, [{ to: [{ email: "tim@partner.test", name: "Tim Hosking" }] }]);
  assert.deepEqual(body.from, { email: "hq@plantedproperty.com.au", name: "PLANTED. HQ" });
  assert.deepEqual(body.reply_to, { email: "shannon@planted.test", name: "Shannon Langberg" });
  assert.equal(body.subject, "Thank you");
  assert.deepEqual(body.content, [
    { type: "text/plain", value: "Hi Tim" },
    { type: "text/html", value: "<p>Hi Tim</p>" },
  ]);
  assert.equal(body.tracking_settings.open_tracking.enable, false);
  assert.equal(body.tracking_settings.click_tracking.enable, false);
  assert.equal(body.tracking_settings.subscription_tracking.enable, false);
  assert.equal(body.cc, undefined);
  assert.equal(body.bcc, undefined);
  assert.equal(body.personalizations[0].cc, undefined);
  assert.ok(!req.body.includes(KEY), "the key is only in the Authorization header, never in the body");
});

test("display names cannot break the header (quotes and control characters out)", () => {
  const b = sendGridBody({ ...email, to: { email: "x@y.test", name: 'Evil "Name"\r\nBcc: z@z.test' } });
  assert.deepEqual((b.personalizations as Array<{ to: unknown[] }>)[0].to, [{ email: "x@y.test", name: "Evil  Name   Bcc: z@z.test" }]);
});

test("202 is success, with the message id from x-message-id", async () => {
  const calls: Call[] = [];
  const out = await deliverWithSendGrid(email, { apiKey: KEY, fetch: okFetch(calls) });
  assert.deepEqual(out, { ok: true, messageId: "msg-123.abc" });
  assert.equal(calls.length, 1, "one attempt");
  assert.ok(calls[0].init.signal, "a timeout signal is attached");
  assert.ok(!JSON.stringify(out).includes(KEY));
});

test("HTTP failures become short codes, with one attempt and no retry", async () => {
  for (const [status, code] of [
    [400, "provider_rejected"],
    [401, "provider_auth"],
    [403, "provider_auth"],
    [413, "provider_rejected"],
    [429, "provider_rate_limited"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ] as const) {
    const calls: Call[] = [];
    const out = await deliverWithSendGrid(email, { apiKey: KEY, fetch: okFetch(calls, status) });
    assert.deepEqual(out, { ok: false, code }, `status ${status}`);
    assert.equal(calls.length, 1, `status ${status}: exactly one attempt`);
    assert.ok(!JSON.stringify(out).includes(KEY));
  }
  assert.equal(sendGridStatusCode(202), null);
  assert.equal(sendGridStatusCode(302), "provider_error");
});

test("a slow provider times out (one attempt), and a network error is network_error", async () => {
  let attempts = 0;
  const hang = (_url: string, init: Call["init"]) => {
    attempts += 1;
    return new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  };
  const started = Date.now();
  assert.deepEqual(await deliverWithSendGrid(email, { apiKey: KEY, fetch: hang, timeoutMs: 40 }), { ok: false, code: "timeout" });
  assert.ok(Date.now() - started < 2000);
  assert.equal(attempts, 1);
  // a fetch that ignores the signal still times out
  const deaf = () => new Promise<never>(() => {});
  assert.deepEqual(await deliverWithSendGrid(email, { apiKey: KEY, fetch: deaf, timeoutMs: 30 }), { ok: false, code: "timeout" });
  const broken = async () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await deliverWithSendGrid(email, { apiKey: KEY, fetch: broken }), { ok: false, code: "network_error" });
});

test("no key: nothing is attempted", async () => {
  const calls: Call[] = [];
  assert.deepEqual(await deliverWithSendGrid(email, { apiKey: "", fetch: okFetch(calls) }), { ok: false, code: "not_configured" });
  assert.equal(calls.length, 0);
});

test("message ids are stored only when they are a safe token", () => {
  assert.equal(safeMessageId("abc-DEF_1.2:3@x=y+z"), "abc-DEF_1.2:3@x=y+z");
  assert.equal(safeMessageId("has space"), null);
  assert.equal(safeMessageId("<script>"), null);
  assert.equal(safeMessageId("x".repeat(201)), null);
  assert.equal(safeMessageId(null), null);
});

test("provider choice: production is always SendGrid (never fake); development is fake unless SendGrid is asked for explicitly", () => {
  assert.deepEqual(chooseProvider({ nodeEnv: "production", provider: "fake", hasKey: true }), { kind: "sendgrid" });
  assert.deepEqual(chooseProvider({ nodeEnv: "production", provider: undefined, hasKey: false }), { kind: "none", reason: "not_configured" });
  assert.deepEqual(chooseProvider({ nodeEnv: "development", provider: undefined, hasKey: true }), { kind: "fake" });
  assert.deepEqual(chooseProvider({ nodeEnv: "development", provider: "fake", hasKey: true }), { kind: "fake" });
  assert.deepEqual(chooseProvider({ nodeEnv: "test", provider: "sendgrid", hasKey: true }), { kind: "sendgrid" });
  assert.deepEqual(chooseProvider({ nodeEnv: "development", provider: "SendGrid", hasKey: false }), { kind: "none", reason: "not_configured" });
});

test("From: the documented defaults, or valid overrides", () => {
  assert.deepEqual(fromMailbox({}), { email: "hq@plantedproperty.com.au", name: "PLANTED. HQ" });
  assert.deepEqual(fromMailbox({ address: "team@plantedproperty.com.au", name: "PLANTED. Team" }), { email: "team@plantedproperty.com.au", name: "PLANTED. Team" });
  assert.deepEqual(fromMailbox({ address: "not an address", name: '"\r\n' }), { email: "hq@plantedproperty.com.au", name: "PLANTED. HQ" });
});

test("the fake provider records and answers with a fake id, or fails on request", async () => {
  const seen: string[] = [];
  const p = fakeProvider(async (id, e) => void seen.push(`${id} ${e.to.email}`), { newId: () => "1234" });
  assert.deepEqual(await p.deliver(email), { ok: true, messageId: "fake-1234" });
  assert.deepEqual(seen, ["fake-1234 tim@partner.test"]);
  const failing = fakeProvider(async () => assert.fail("must not record"), { newId: () => "x", fail: "timeout" });
  assert.deepEqual(await failing.deliver(email), { ok: false, code: "timeout" });
  assert.equal(fakeFailure("provider_rejected"), "provider_rejected");
  assert.equal(fakeFailure("not_configured"), null);
  assert.equal(fakeFailure(undefined), null);
});
