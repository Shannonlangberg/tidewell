// Run with: npm test   (node --test, no extra dependencies)
// The thank-you flow (lib/hq/email/enquiry-ack.ts) through the REAL SendGrid wrapper with fetch mocked:
// it sends once when the database allows it, records the outcome, swallows every failure, and never
// lets the key, the address or the name into its logs or results.
import "../../../scripts/hq/ts-hooks.mts"; // "@/..." aliases and the "server-only" stub
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const KEY = "SG.test-key-never-logged-0123456789";
const TO = "jeff.enquirer@example.test";

const outbox = mkdtempSync(path.join(os.tmpdir(), "ack-outbox-"));
process.env.HQ_EMAIL_OUTBOX_DIR = outbox;
delete process.env.HQ_EMAIL_FAKE_FAIL;
delete process.env.EMAIL_FROM_ADDRESS;
delete process.env.EMAIL_FROM_NAME;

const { acknowledgeEnquiry } = await import("./enquiry-ack.ts");
type Store = Parameters<typeof acknowledgeEnquiry>[2];

type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

function useSendGrid(answer: (call: Call) => Promise<{ status: number; headers: { get(n: string): string | null } }>) {
  process.env.HQ_EMAIL_PROVIDER = "sendgrid";
  process.env.SENDGRID_API_KEY = KEY;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: Call["init"]) => {
    const call = { url: String(url), init };
    calls.push(call);
    return answer(call);
  }) as unknown as typeof fetch;
  return calls;
}

function store(begun: Awaited<ReturnType<Store["begin"]>> | Error, finishError?: Error) {
  const seen = { begin: [] as string[], finish: [] as unknown[][] };
  const s: Store = {
    begin: async (id) => {
      seen.begin.push(id);
      if (begun instanceof Error) throw begun;
      return begun;
    },
    finish: async (...args) => {
      seen.finish.push(args);
      if (finishError) throw finishError;
    },
  };
  return { s, seen };
}

function captureLogs() {
  const lines: string[] = [];
  const orig = { info: console.info, error: console.error, log: console.log, warn: console.warn };
  for (const k of ["info", "error", "log", "warn"] as const) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  return {
    lines,
    restore: () => Object.assign(console, orig),
  };
}

const ok202 = async () => ({ status: 202, headers: { get: (n: string) => (n.toLowerCase() === "x-message-id" ? "sg-msg.123" : null) } });
const BEGUN = { send: true as const, ref: "ENQ-0042", to: TO, firstName: "Jeff", replyTo: "dana@plantedproperty.com.au" };

test("allowed: one SendGrid request, the key only in Authorization, the thank-you content, and the outcome recorded", async () => {
  const calls = useSendGrid(ok202);
  const { s, seen } = store(BEGUN);
  const log = captureLogs();
  let out;
  try {
    out = await acknowledgeEnquiry("e42", "ENQ-0042", s);
  } finally {
    log.restore();
  }
  assert.equal(out, "sent");
  assert.equal(calls.length, 1, "exactly one request");
  const c = calls[0];
  assert.equal(c.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!c.init.body.includes(KEY), "the key is not in the body");
  const body = JSON.parse(c.init.body);
  assert.deepEqual(body.personalizations, [{ to: [{ email: TO }] }], "one recipient, no name");
  assert.deepEqual(body.from, { email: "hq@plantedproperty.com.au", name: "PLANTED." });
  assert.deepEqual(body.reply_to, { email: "dana@plantedproperty.com.au" }, "replies go to the lead owner");
  assert.equal(body.subject, "Thank you for contacting PLANTED.");
  assert.match(body.content[0].value, /^Hello Jeff,/);
  assert.equal(body.tracking_settings.open_tracking.enable, false);
  assert.deepEqual(seen.begin, ["e42"]);
  assert.deepEqual(seen.finish, [["e42", true, "sg-msg.123", null]]);
  const all = log.lines.join("\n");
  assert.ok(!all.includes(KEY) && !all.includes(TO) && !all.includes("Jeff"), all);
  assert.match(all, /thank-you sent for ENQ-0042/);
});

test("no Reply-To from the database (or an odd one): replies go to the From address", async () => {
  const calls = useSendGrid(ok202);
  const { s } = store({ ...BEGUN, replyTo: "not an address" });
  const log = captureLogs();
  try {
    await acknowledgeEnquiry("e42", "ENQ-0042", s);
  } finally {
    log.restore();
  }
  assert.deepEqual(JSON.parse(calls[0].init.body).reply_to, { email: "hq@plantedproperty.com.au", name: "PLANTED." });
});

test("the database says no: nothing is sent and nothing is finished", async () => {
  const calls = useSendGrid(ok202);
  const { s, seen } = store({ send: false, reason: "address_limit" });
  const log = captureLogs();
  let out;
  try {
    out = await acknowledgeEnquiry("e43", "ENQ-0043", s);
  } finally {
    log.restore();
  }
  assert.equal(out, "skipped");
  assert.equal(calls.length, 0);
  assert.equal(seen.finish.length, 0);
  assert.match(log.lines.join("\n"), /skipped for ENQ-0043: address_limit/);
});

test("a provider failure is recorded and swallowed; the key never appears", async () => {
  const calls = useSendGrid(async () => ({ status: 401, headers: { get: () => null } }));
  const { s, seen } = store(BEGUN);
  const log = captureLogs();
  let out;
  try {
    out = await acknowledgeEnquiry("e44", "ENQ-0044", s);
  } finally {
    log.restore();
  }
  assert.equal(out, "failed");
  assert.equal(calls.length, 1, "one attempt, no retry");
  assert.deepEqual(seen.finish, [["e44", false, null, "provider_auth"]]);
  const all = log.lines.join("\n") + JSON.stringify(seen);
  assert.ok(!all.includes(KEY) && !all.includes(TO), all);
});

test("fetch throwing (network) and the database failing are swallowed", async () => {
  useSendGrid(async () => {
    throw new TypeError(`fetch failed for ${TO} with ${KEY}`);
  });
  const { s, seen } = store(BEGUN, new Error(`finish failed ${TO}`));
  const log = captureLogs();
  let out;
  try {
    out = await acknowledgeEnquiry("e45", "ENQ-0045", s);
  } finally {
    log.restore();
  }
  assert.equal(out, "failed");
  assert.deepEqual(seen.finish, [["e45", false, null, "network_error"]]);
  const all = log.lines.join("\n");
  assert.ok(!all.includes(KEY) && !all.includes(TO), "the thrown messages are never logged");

  const begin = store(new Error(`begin blew up ${TO}`));
  const log2 = captureLogs();
  try {
    assert.equal(await acknowledgeEnquiry("e46", "ENQ-0046", begin.s), "failed");
  } finally {
    log2.restore();
  }
  assert.ok(!log2.lines.join("\n").includes(TO));
});

test("an address that is not plain is never sent to, even if the database returned it", async () => {
  const calls = useSendGrid(ok202);
  const { s, seen } = store({ ...BEGUN, to: "a@b.test>, victim@x.test" });
  const log = captureLogs();
  try {
    assert.equal(await acknowledgeEnquiry("e47", "ENQ-0047", s), "failed");
  } finally {
    log.restore();
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(seen.finish, [["e47", false, null, "provider_rejected"]]);
});

test("development default: the fake provider writes the outbox and never calls fetch", async () => {
  delete process.env.HQ_EMAIL_PROVIDER;
  delete process.env.SENDGRID_API_KEY;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("no");
  }) as unknown as typeof fetch;
  const { s, seen } = store(BEGUN);
  const log = captureLogs();
  try {
    assert.equal(await acknowledgeEnquiry("e48", "ENQ-0048", s), "sent");
  } finally {
    log.restore();
  }
  assert.equal(fetched, 0);
  const files = readdirSync(outbox).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  const meta = JSON.parse(readFileSync(path.join(outbox, files[0]), "utf8"));
  assert.equal(meta.to.email, TO);
  assert.equal(meta.subject, "Thank you for contacting PLANTED.");
  const [, ok, messageId] = seen.finish[0] as [string, boolean, string];
  assert.equal(ok, true);
  assert.match(messageId, /^fake-/);
  rmSync(outbox, { recursive: true, force: true });
});
