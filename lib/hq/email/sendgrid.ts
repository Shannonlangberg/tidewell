import "server-only";

import { deliverWithSendGrid, type DeliveryOutcome, type OutgoingEmail } from "./provider";

/*
 * The ONE file that reads SENDGRID_API_KEY (eslint.config.mjs refuses `process.env.SENDGRID_API_KEY`
 * anywhere else, and lets only lib/hq/email/send.ts, enquiry-notify.ts and enquiry-ack.ts import this
 * file). The key is a server environment variable (Netlify, marked secret); it is never logged,
 * returned, or sent anywhere but the Authorization header of the SendGrid request.
 *
 * The caller must already have decided the email may go (an approved draft flipped to `sending` by
 * begin_email_send; a website enquiry's thank-you flipped to `sending` by begin_enquiry_auto_reply):
 * this file only delivers.
 */

const key = () => (process.env.SENDGRID_API_KEY ?? "").trim();

/** True when a SendGrid key is present. Says nothing about the key itself. */
export function sendGridConfigured(): boolean {
  return key().length > 0;
}

/** One attempt, a short timeout (`timeoutMs`, default SEND_TIMEOUT_MS), no retry. Returns a message id or a short failure code. */
export function deliverViaSendGrid(email: OutgoingEmail, opts: { timeoutMs?: number } = {}): Promise<DeliveryOutcome> {
  return deliverWithSendGrid(email, {
    apiKey: key(),
    timeoutMs: opts.timeoutMs,
    fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
  });
}
