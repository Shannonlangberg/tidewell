// Run with: npm test   (node --test, no extra dependencies)
// The website enquiry path end to end, with the HQ intake and the staff email mocked: when a person is
// told their enquiry was sent, and when they are not.
import "../scripts/hq/ts-hooks.mts"; // lib/enquiries.ts imports "@/lib/planted"; the hooks resolve the alias
import test from "node:test";
import assert from "node:assert/strict";

const { processEnquiry, MESSAGES, SUCCESS_PATH, HONEYPOT_FIELD, TIMESTAMP_FIELD, JS_FIELD } = await import("./enquiries.ts");
type Deps = NonNullable<Parameters<typeof processEnquiry>[2]>;

const ADAPTER_ENV = ["RESEND_API_KEY", "ENQUIRY_TO_EMAIL", "ENQUIRY_WEBHOOK_URL", "TURNSTILE_SECRET_KEY"] as const;
for (const k of ADAPTER_ENV) delete process.env[k];

function contactForm(over: Record<string, string> = {}, js = true): FormData {
  const f = new FormData();
  const v: Record<string, string> = {
    name: "[test] Casey Contact",
    email: "casey@example.test",
    phone: "0400 000 000",
    enquiryType: "General Enquiry",
    message: "Do you manage units in Moonta?",
    [TIMESTAMP_FIELD]: String(Date.now() - 20_000),
    ...(js ? { [JS_FIELD]: "1" } : {}),
    ...over,
  };
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

function appraisalForm(): FormData {
  const f = new FormData();
  const v: Record<string, string> = {
    address: "1 Test Street",
    suburb: "Wallaroo",
    postcode: "5556",
    propertyType: "House",
    bedrooms: "3",
    bathrooms: "2",
    parking: "1",
    tenancyStatus: "No",
    otherManager: "No",
    timeframe: "Within 30 days",
    name: "[test] Ann Appraisal",
    email: "ann@example.test",
    phone: "",
    contactMethod: "Email",
    message: "",
    consent: "on",
    [TIMESTAMP_FIELD]: String(Date.now() - 60_000),
    [JS_FIELD]: "1",
  };
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
}

const STORED = { ok: true as const, ref: "ENQ-0007", enquiryId: "e7", opportunityId: "o7", duplicate: false };

function spies(hqAnswer: Awaited<ReturnType<NonNullable<Deps["hq"]>>> | Error, notifyAnswer: "sent" | "failed" | "skipped" | Error = "sent") {
  const calls = { hq: [] as unknown[], notify: [] as unknown[] };
  const deps: Deps = {
    hq: async (e) => {
      calls.hq.push(e);
      if (hqAnswer instanceof Error) throw hqAnswer;
      return hqAnswer;
    },
    notify: async (e, s) => {
      calls.notify.push([e, s]);
      if (notifyAnswer instanceof Error) throw notifyAnswer;
      return notifyAnswer;
    },
  };
  return { deps, calls };
}

test("HQ stores it and the email notice fails: the person is told it was sent", async () => {
  const { deps, calls } = spies(STORED, "failed");
  const out = await processEnquiry("contact", contactForm(), deps);
  assert.equal(out.state.status, "sent");
  assert.equal(out.state.message, MESSAGES.sent);
  assert.equal(out.redirectTo, null);
  assert.equal(calls.hq.length, 1);
  assert.equal(calls.notify.length, 1);
  assert.deepEqual((calls.notify[0] as unknown[])[1], { ref: "ENQ-0007", enquiryId: "e7", opportunityId: "o7" });
});

test("HQ stores it and the email notice throws: still sent", async () => {
  const { deps } = spies(STORED, new Error("smtp down"));
  const out = await processEnquiry("contact", contactForm(), deps);
  assert.equal(out.state.status, "sent");
});

test("a duplicate (double tap) is a success and sends no second notice", async () => {
  const { deps, calls } = spies({ ...STORED, duplicate: true });
  const out = await processEnquiry("contact", contactForm(), deps);
  assert.equal(out.state.status, "sent");
  assert.equal(calls.notify.length, 0);
});

test("HQ fails and no other adapter is configured: the person is told it failed, even in development", async () => {
  const { deps, calls } = spies({ ok: false, reason: "failed" });
  const out = await processEnquiry("contact", contactForm(), deps);
  assert.equal(out.state.status, "failed");
  assert.equal(out.state.message, MESSAGES.failed);
  assert.equal(out.state.values.email, "casey@example.test", "the form is not emptied");
  assert.equal(calls.notify.length, 0, "no notice for an enquiry that was not stored");
});

test("HQ throws: failed, never a console success", async () => {
  const { deps } = spies(new Error("network"));
  const out = await processEnquiry("contact", contactForm(), deps);
  assert.equal(out.state.status, "failed");
});

test("HQ's rate limit: an honest 'not sent', with no fallback", async () => {
  process.env.ENQUIRY_WEBHOOK_URL = "https://hooks.example.test/enquiry";
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  try {
    const { deps } = spies({ ok: false, reason: "rate_limited" });
    const out = await processEnquiry("contact", contactForm(), deps);
    assert.equal(out.state.status, "failed");
    assert.equal(out.state.message, MESSAGES.rateLimited);
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ENQUIRY_WEBHOOK_URL;
  }
});

test("HQ fails but a configured webhook delivers: sent (via the webhook)", async () => {
  process.env.ENQUIRY_WEBHOOK_URL = "https://hooks.example.test/enquiry";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch;
  try {
    const { deps } = spies({ ok: false, reason: "timeout" });
    const out = await processEnquiry("contact", contactForm(), deps);
    assert.equal(out.state.status, "sent");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ENQUIRY_WEBHOOK_URL;
  }
});

test("HQ not set up in production and nothing else configured: the 'not connected yet' failure", async () => {
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const { deps } = spies({ ok: false, reason: "unconfigured" });
    const out = await processEnquiry("appraisal", appraisalForm(), deps);
    assert.equal(out.state.status, "failed");
    assert.equal(out.state.message, MESSAGES.unconfigured);
  } finally {
    env.NODE_ENV = before;
  }
});

test("the honeypot is unchanged: a bot sees success, nothing reaches HQ", async () => {
  const { deps, calls } = spies(STORED);
  const out = await processEnquiry("contact", contactForm({ [HONEYPOT_FIELD]: "Acme Pty Ltd" }), deps);
  assert.equal(out.state.status, "sent");
  assert.equal(calls.hq.length, 0);
  assert.equal(calls.notify.length, 0);
  const noJs = await processEnquiry("contact", contactForm({ [HONEYPOT_FIELD]: "x" }, false), deps);
  assert.equal(noJs.redirectTo, SUCCESS_PATH);
  assert.equal(calls.hq.length, 0);
});

test("too fast and invalid submissions never reach HQ", async () => {
  const { deps, calls } = spies(STORED);
  const fast = await processEnquiry("contact", contactForm({ [TIMESTAMP_FIELD]: String(Date.now() - 500) }), deps);
  assert.equal(fast.state.status, "invalid");
  assert.equal(fast.state.message, MESSAGES.tooFast);
  const bad = await processEnquiry("contact", contactForm({ email: "not-an-email" }), deps);
  assert.equal(bad.state.status, "invalid");
  assert.ok(bad.state.errors.email);
  assert.equal(calls.hq.length, 0);
});

test("without JavaScript a stored enquiry redirects to the confirmation page", async () => {
  const { deps } = spies(STORED);
  const out = await processEnquiry("contact", contactForm({}, false), deps);
  assert.equal(out.redirectTo, SUCCESS_PATH);
  assert.equal(out.state.status, "sent");
});

test("the appraisal reaches HQ with its validated values and no IP or other request data", async () => {
  const { deps, calls } = spies(STORED);
  const out = await processEnquiry("appraisal", appraisalForm(), deps);
  assert.equal(out.state.status, "sent");
  const sent = calls.hq[0] as { kind: string; data: Record<string, string>; suburb: string | null };
  assert.equal(sent.kind, "appraisal");
  assert.equal(sent.data.consent, "yes");
  assert.equal(sent.suburb, "Wallaroo");
  assert.deepEqual(Object.keys(sent.data).sort(), [
    "address", "bathrooms", "bedrooms", "consent", "contactMethod", "email", "message", "name", "otherManager", "parking", "phone", "postcode", "propertyType", "suburb", "tenancyStatus", "timeframe",
  ]);
  assert.ok(!JSON.stringify(sent).match(/\d+\.\d+\.\d+\.\d+/), "no IP address in what is handed on");
});
