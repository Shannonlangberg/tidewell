import "server-only";

import { deliverWithSendGrid, type DeliveryOutcome, type OutgoingEmail } from "./provider";

/*
 * The ONE file that reads SENDGRID_API_KEY (eslint.config.mjs refuses `process.env.SENDGRID_API_KEY`
 * anywhere else, and lets only lib/hq/email/send.ts import this file). The key is a server
 * environment variable (Netlify, marked secret); it is never logged, returned, or sent anywhere but
 * the Authorization header of the SendGrid request.
 *
 * The caller must already have authorised the person and flipped the draft to `sending` through
 * begin_email_send (lib/hq/email/orchestrator.ts): this file only delivers.
 */

const key = () => (process.env.SENDGRID_API_KEY ?? "").trim();

/** True when a SendGrid key is present. Says nothing about the key itself. */
export function sendGridConfigured(): boolean {
  return key().length > 0;
}

/** One attempt, a short timeout, no retry. Returns a message id or a short failure code. */
export function deliverViaSendGrid(email: OutgoingEmail): Promise<DeliveryOutcome> {
  return deliverWithSendGrid(email, {
    apiKey: key(),
    fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
  });
}
