/*
 * Email providers, as pure functions: the SendGrid v3 request, sending it with a given fetch and key
 * (one attempt, a short timeout, never a retry), turning the answer into a short outcome code, the
 * fake provider used in development, and the rule that picks between them.
 *
 * The API key is passed IN by lib/hq/email/sendgrid.ts, the only file that reads SENDGRID_API_KEY
 * (eslint.config.mjs enforces it). Nothing here logs, and no outcome carries the key, the address
 * or the message.
 *
 * Pure with NO imports: unit tested with `node --test` (provider.test.mts).
 */

export const SENDGRID_SEND_URL = "https://api.sendgrid.com/v3/mail/send";
export const DEFAULT_FROM_ADDRESS = "hq@plantedproperty.com.au";
export const DEFAULT_FROM_NAME = "PLANTED. HQ";
/** Well inside Netlify's synchronous function limit, with room for the database calls either side. */
export const SEND_TIMEOUT_MS = 6000;

export type Mailbox = { email: string; name?: string | null };

export type OutgoingEmail = {
  to: Mailbox;
  from: Mailbox;
  replyTo: Mailbox;
  subject: string;
  text: string;
  html: string;
};

/** What a provider said, as data that is safe to store and log: a message id or a short code. */
export type DeliveryOutcome = { ok: true; messageId: string | null } | { ok: false; code: SendErrorCode };

export type SendErrorCode =
  | "timeout"
  | "network_error"
  | "provider_rejected"
  | "provider_auth"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_error"
  | "not_configured";

export type Provider = { name: "sendgrid" | "fake"; deliver: (email: OutgoingEmail) => Promise<DeliveryOutcome> };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; redirect?: "error" }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
}>;

const mailbox = (m: Mailbox) => (m.name && m.name.trim() ? { email: m.email, name: m.name.replace(/[\u0000-\u001f\u007f"]/g, " ").trim() } : { email: m.email });

/** The SendGrid v3 mail/send body: one recipient, text and HTML, Reply-To, every tracking feature off. */
export function sendGridBody(email: OutgoingEmail): Record<string, unknown> {
  return {
    personalizations: [{ to: [mailbox(email.to)] }],
    from: mailbox(email.from),
    reply_to: mailbox(email.replyTo),
    subject: email.subject,
    content: [
      { type: "text/plain", value: email.text },
      { type: "text/html", value: email.html },
    ],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
      ganalytics: { enable: false },
    },
  };
}

/** The whole request. The key goes in the Authorization header and nowhere else. */
export function sendGridRequest(email: OutgoingEmail, apiKey: string): { url: string; method: "POST"; headers: Record<string, string>; body: string } {
  return {
    url: SENDGRID_SEND_URL,
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(sendGridBody(email)),
  };
}

/** A SendGrid HTTP status as an outcome code. 202 is the only success. */
export function sendGridStatusCode(status: number): SendErrorCode | null {
  if (status === 202 || status === 200) return null;
  if (status === 401 || status === 403) return "provider_auth";
  if (status === 429) return "provider_rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "provider_rejected";
  return "provider_error";
}

/** A message id as stored (letters, digits and . _ : @ = + -, at most 200), else null. */
export function safeMessageId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v && v.length <= 200 && /^[A-Za-z0-9._:@=+-]+$/.test(v) ? v : null;
}

/**
 * Sends ONE email through SendGrid: one attempt, `timeoutMs` at most, no retry (a retry after a timeout
 * could deliver twice). The response body is never read, so nothing the provider echoes is kept.
 */
export async function deliverWithSendGrid(email: OutgoingEmail, opts: { apiKey: string; fetch: FetchLike; timeoutMs?: number }): Promise<DeliveryOutcome> {
  if (!opts.apiKey) return { ok: false, code: "not_configured" };
  const req = sendGridRequest(email, opts.apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SEND_TIMEOUT_MS);
  try {
    const res = await Promise.race([
      opts.fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal, redirect: "error" }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), { once: true })),
    ]);
    const code = sendGridStatusCode(res.status);
    if (code) return { ok: false, code };
    return { ok: true, messageId: safeMessageId(res.headers.get("x-message-id")) };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, code: controller.signal.aborted || name === "AbortError" || name === "TimeoutError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

// ── which provider ───────────────────────────────────────────

export type ProviderChoice = { kind: "sendgrid" } | { kind: "fake" } | { kind: "none"; reason: "not_configured" };

/**
 * Production always uses SendGrid (a fake provider is never honoured there), and refuses to send when
 * the key is missing. Anywhere else the FAKE provider is the default; SendGrid is used only when
 * HQ_EMAIL_PROVIDER=sendgrid is set explicitly AND a key is present, so a development machine never
 * sends a real email by accident.
 */
export function chooseProvider(env: { nodeEnv?: string; provider?: string; hasKey: boolean }): ProviderChoice {
  const production = env.nodeEnv === "production";
  const wanted = (env.provider ?? "").trim().toLowerCase();
  if (production) return env.hasKey ? { kind: "sendgrid" } : { kind: "none", reason: "not_configured" };
  if (wanted === "sendgrid") return env.hasKey ? { kind: "sendgrid" } : { kind: "none", reason: "not_configured" };
  return { kind: "fake" };
}

/** A From mailbox from the optional environment overrides, with the documented defaults. */
export function fromMailbox(env: { address?: string; name?: string }): Mailbox {
  const address = (env.address ?? "").trim();
  const name = (env.name ?? "").replace(/[\u0000-\u001f\u007f"]/g, " ").trim();
  const valid = address.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  return { email: valid ? address : DEFAULT_FROM_ADDRESS, name: name || DEFAULT_FROM_NAME };
}

/**
 * The fake provider: records the email with `record` (the server writes it to a local outbox folder)
 * and answers with a fake message id. `fail` makes it answer with a failure code instead (for
 * trying the failed-send screens locally).
 */
export function fakeProvider(record: (id: string, email: OutgoingEmail) => Promise<void>, opts: { fail?: SendErrorCode | null; newId: () => string }): Provider {
  return {
    name: "fake",
    deliver: async (email) => {
      if (opts.fail) return { ok: false, code: opts.fail };
      const id = `fake-${opts.newId()}`;
      await record(id, email);
      return { ok: true, messageId: id };
    },
  };
}

const FAIL_CODES: readonly SendErrorCode[] = ["timeout", "network_error", "provider_rejected", "provider_auth", "provider_rate_limited", "provider_unavailable", "provider_error"];
/** HQ_EMAIL_FAKE_FAIL, when it names a known failure code. */
export function fakeFailure(value: string | undefined): SendErrorCode | null {
  const v = (value ?? "").trim().toLowerCase();
  return (FAIL_CODES as readonly string[]).includes(v) ? (v as SendErrorCode) : null;
}
