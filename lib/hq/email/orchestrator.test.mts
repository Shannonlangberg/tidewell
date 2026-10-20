// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { sendDraftWith, type BegunEmail, type SendDeps } from "./orchestrator.ts";
import { deliverWithSendGrid, type OutgoingEmail } from "./provider.ts";
import { renderEmail } from "./render.ts";

const KEY = "SG.secret-test-key-1234567890";
const DRAFT = "6b0c1a2e-3f4d-4e5f-8a9b-0c1d2e3f4a5b";
const begun: BegunEmail = {
  draft_id: DRAFT,
  ref: "EML-0007",
  to_email: "tim@partner.test",
  to_name: "Tim Hosking",
  subject: "Thank you",
  body_text: "Hi Tim,\n\nThanks for today.",
  reply_to_email: "shannon@planted.test",
  sender_name: "Shannon Langberg",
  sender_role: "director",
  recipient_contact_id: "0f3e2d1c-b4a5-4c6d-9e8f-7a6b5c4d3e2f",
};

/** A tiny stand-in for the database's status machine: begin succeeds once, then refuses. */
function fakeDb() {
  const state = { status: "approved" as string, finished: [] as Array<{ ok: boolean; messageId: string | null; code: string | null }>, begins: 0 };
  return {
    state,
    begin: async () => {
      state.begins += 1;
      await new Promise((r) => setTimeout(r, 5)); // a concurrent caller waits on the row lock
      if (state.status !== "approved") return { data: null, error: { code: "22023", message: `this email is already ${state.status}`, hint: "email_already_sent" } };
      state.status = "sending";
      return { data: begun, error: null };
    },
    finish: async (_id: string, ok: boolean, messageId: string | null, code: string | null) => {
      if (state.status !== "sending") return { error: { code: "22023", hint: "email_not_sending" } };
      state.status = ok ? "sent" : "failed";
      state.finished.push({ ok, messageId, code });
      return { error: null };
    },
  };
}

function deps(over: Partial<SendDeps> & { logs?: string[] } = {}): SendDeps & { logs: string[]; delivered: OutgoingEmail[] } {
  const db = fakeDb();
  const logs = over.logs ?? [];
  const delivered: OutgoingEmail[] = [];
  const base: SendDeps = {
    unavailable: () => null,
    begin: db.begin,
    finish: db.finish,
    render: (b) => renderEmail({ subject: b.subject, body: b.body_text, senderName: b.sender_name, senderRole: "Director" }),
    deliver: async (e) => {
      delivered.push(e);
      return { ok: true, messageId: "sg-1" };
    },
    from: { email: "hq@plantedproperty.com.au", name: "PLANTED." },
    log: (where, code) => logs.push(`${where} ${code}`),
  };
  return Object.assign({ ...base, ...over }, { logs, delivered, db });
}

test("success: begin, deliver once with the record's address and the drafter's Reply-To, finish as sent", async () => {
  const d = deps();
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.equal(r.status, "sent");
  if (r.status !== "sent") return;
  assert.deepEqual(
    { ref: r.ref, to: r.toEmail, toName: r.toName, from: r.fromEmail, replyTo: r.replyTo, id: r.messageId },
    { ref: "EML-0007", to: "tim@partner.test", toName: "Tim Hosking", from: "hq@plantedproperty.com.au", replyTo: "shannon@planted.test", id: "sg-1" },
  );
  assert.equal(d.delivered.length, 1);
  assert.deepEqual(d.delivered[0].to, { email: "tim@partner.test", name: "Tim Hosking" });
  assert.deepEqual(d.delivered[0].replyTo, { email: "shannon@planted.test", name: "Shannon Langberg" });
  assert.match(d.delivered[0].html, /PLANTED\./);
  assert.match(d.delivered[0].text, /Thanks for today\./);
  const db = (d as unknown as { db: ReturnType<typeof fakeDb> }).db;
  assert.deepEqual(db.state.finished, [{ ok: true, messageId: "sg-1", code: null }]);
  assert.deepEqual(d.logs, []);
});

test("a provider failure finishes the draft as failed with the code, and is not retried", async () => {
  let attempts = 0;
  const d = deps({
    deliver: async () => {
      attempts += 1;
      return { ok: false, code: "provider_rejected" };
    },
  });
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.deepEqual({ status: r.status, code: r.status === "failed" ? r.code : null }, { status: "failed", code: "provider_rejected" });
  assert.equal(attempts, 1);
  const db = (d as unknown as { db: ReturnType<typeof fakeDb> }).db;
  assert.equal(db.state.status, "failed");
  assert.deepEqual(db.state.finished, [{ ok: false, messageId: null, code: "provider_rejected" }]);
  // trying again does not send: the database refuses a failed draft until it is approved again
  const again = await sendDraftWith({ ...d, begin: db.begin, finish: db.finish }, DRAFT, "hq");
  assert.equal(again.status, "refused");
  assert.equal(attempts, 1);
});

test("a timeout from SendGrid becomes a failed draft with code timeout", async () => {
  const hang = (_u: string, init: { signal?: AbortSignal }) => new Promise<never>((_, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))));
  const d = deps({ deliver: (e) => deliverWithSendGrid(e, { apiKey: KEY, fetch: hang, timeoutMs: 30 }) });
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.equal(r.status, "failed");
  assert.equal(r.status === "failed" ? r.code : "", "timeout");
});

test("a deliver that throws is recorded as provider_error, never re-attempted", async () => {
  let attempts = 0;
  const d = deps({
    deliver: async () => {
      attempts += 1;
      throw new Error(`boom with ${KEY}`);
    },
  });
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.equal(r.status === "failed" ? r.code : r.status, "provider_error");
  assert.equal(attempts, 1);
  assert.ok(!d.logs.join("\n").includes(KEY), "the thrown message (which here holds the key) is never logged");
});

test("no double send: two calls at once and a retry after success deliver exactly once", async () => {
  const d = deps();
  const [a, b] = await Promise.all([sendDraftWith(d, DRAFT, "hq"), sendDraftWith(d, DRAFT, "hq")]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["refused", "sent"]);
  const c = await sendDraftWith(d, DRAFT, "chat");
  assert.equal(c.status, "refused");
  assert.equal(d.delivered.length, 1);
});

test("the database refusing begin means nothing is delivered", async () => {
  const d = deps({ begin: async () => ({ data: null, error: { code: "42501", message: "this email has not been approved: open it in HQ and tap Approve and send", hint: "email_not_approved" } }) });
  const r = await sendDraftWith(d, DRAFT, "chat");
  assert.equal(r.status, "refused");
  assert.equal(r.status === "refused" ? r.error?.hint : "", "email_not_approved");
  assert.equal(d.delivered.length, 0);
  assert.deepEqual(d.logs, ["begin_email_send email_not_approved"]);
});

test("provider not configured: nothing is begun or delivered", async () => {
  let begins = 0;
  const d = deps({
    unavailable: () => "not_configured",
    begin: async () => {
      begins += 1;
      return { data: begun, error: null };
    },
  });
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.deepEqual(r, { status: "refused", reason: "not_configured", error: null });
  assert.equal(begins, 0);
  assert.equal(d.delivered.length, 0);
});

test("delivered but not recorded: reported as sent_unrecorded, never re-sent", async () => {
  const d = deps({ finish: async () => ({ error: { code: "08006" } }) });
  const r = await sendDraftWith(d, DRAFT, "hq");
  assert.equal(r.status, "sent_unrecorded");
  assert.equal(d.delivered.length, 1);
  assert.deepEqual(d.logs, ["finish_email_send 08006"]);
});

test("the key never appears in any result or log, through the real SendGrid request path", async () => {
  const logs: string[] = [];
  const sent: string[] = [];
  const fetch = async (_u: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push(init.headers.Authorization);
    assert.ok(!init.body.includes(KEY));
    return { status: 202, headers: { get: () => "abc" } };
  };
  for (const status of [202, 401] as const) {
    const f = status === 202 ? fetch : async () => ({ status, headers: { get: () => null } });
    const d = deps({ logs, deliver: (e) => deliverWithSendGrid(e, { apiKey: KEY, fetch: f }) });
    const r = await sendDraftWith(d, DRAFT, "hq");
    assert.ok(!JSON.stringify(r).includes(KEY), `result for ${status}`);
  }
  assert.ok(!logs.join("\n").includes(KEY));
  assert.ok(!logs.join("\n").includes("tim@partner.test"), "no address in a log line");
  assert.deepEqual(sent, [`Bearer ${KEY}`], "the key went only into the Authorization header");
});
