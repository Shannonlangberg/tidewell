import "server-only";

import { randomUUID } from "node:crypto";
import { CONTACT } from "@/lib/planted";
import type { AckBegun } from "@/lib/hq/enquiry-rules";
import { enquiryAckEmail } from "./enquiry-ack-email";
import { recordInOutbox } from "./outbox";
import { chooseProvider, fakeFailure, fakeProvider, fromMailbox, type DeliveryOutcome, type OutgoingEmail } from "./provider";
import { deliverViaSendGrid, sendGridConfigured } from "./sendgrid";

/*
 * The automatic thank-you to the person who filled in a website form: ONE generic, branded email to the
 * address they typed, after HQ stored their NEW enquiry and after the staff notice. Best effort, in the
 * strictest sense: it never changes what the visitor is told (the form's result is decided before this
 * runs), every error is swallowed, and logs carry the ENQ ref and a short code only: never the address,
 * the name, the message or the key.
 *
 * Whether it may go at all is the DATABASE's decision (hq.begin_enquiry_auto_reply, service_role only,
 * through `store` = lib/hq/enquiry-intake.ts): the switch, one per address per 24 hours, 30 per hour
 * across HQ, never twice for one enquiry, never for spam. begin flips the enquiry to `sending`, so a
 * retry or a duplicate cannot send again; finish records what the provider said (and, when sent, the
 * timeline entry on the lead). When begin itself errors or times out, fail records that (0154), so an
 * enquiry never reads "not attempted" after the site tried.
 *
 * This is the third file allowed to import lib/hq/email/sendgrid.ts (eslint.config.mjs); SENDGRID_API_KEY
 * is still read only there. Provider rule as for every HQ email: SendGrid in production; elsewhere the
 * fake provider (the local outbox) unless HQ_EMAIL_PROVIDER=sendgrid is set explicitly.
 * HQ_EMAIL_FAKE_FAIL makes the fake provider fail, to see "Thank-you not sent" locally.
 *
 * From: EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME (default PLANTED. <hq@plantedproperty.com.au>). Reply-To:
 * the lead owner's HQ address when begin returns one, else the From address.
 */

/** One attempt, no retry (a retry after a timeout could deliver twice). */
export const ACK_SEND_TIMEOUT_MS = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type AckStore = {
  begin: (enquiryId: string) => Promise<AckBegun>;
  finish: (enquiryId: string, ok: boolean, messageId: string | null, errorCode: string | null) => Promise<void>;
  fail: (enquiryId: string, errorCode: "not_begun" | "begin_timeout") => Promise<void>;
};

export type AckOutcome = "sent" | "skipped" | "failed";

const plainAddress = (v: string | null | undefined): v is string => typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v) && !/[\u0000-\u001f\u007f<>,;"]/.test(v);

const errName = (e: unknown) => (e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "error");

/** Sends the thank-you if the database allows it. Never throws. */
export async function acknowledgeEnquiry(enquiryId: string, ref: string, store: AckStore): Promise<AckOutcome> {
  const tag = /^ENQ-\d{4,}$/.test(ref) ? ref : "an enquiry";
  let begun: AckBegun;
  try {
    begun = await store.begin(enquiryId);
  } catch (e) {
    console.error(`[enquiry] thank-you not begun for ${tag}: ${errName(e)}`);
    const code = errName(e) === "TimeoutError" || errName(e) === "AbortError" ? "begin_timeout" : "not_begun";
    try {
      await store.fail(enquiryId, code);
    } catch (e2) {
      console.error(`[enquiry] thank-you failure not recorded for ${tag}: ${errName(e2)}`);
    }
    return "failed";
  }
  if (!begun.send) {
    console.info(`[enquiry] thank-you skipped for ${tag}: ${begun.reason}`);
    return "skipped";
  }

  let outcome: DeliveryOutcome;
  try {
    const choice = chooseProvider({ nodeEnv: process.env.NODE_ENV, provider: process.env.HQ_EMAIL_PROVIDER, hasKey: sendGridConfigured() });
    if (!plainAddress(begun.to)) {
      outcome = { ok: false, code: "provider_rejected" };
    } else if (choice.kind === "none") {
      outcome = { ok: false, code: "not_configured" };
    } else {
      const from = fromMailbox({ address: process.env.EMAIL_FROM_ADDRESS, name: process.env.EMAIL_FROM_NAME });
      const rendered = enquiryAckEmail({ firstName: begun.firstName, contact: { email: CONTACT.email, phone: CONTACT.phone } });
      const email: OutgoingEmail = { to: { email: begun.to }, from, replyTo: plainAddress(begun.replyTo) ? { email: begun.replyTo } : from, ...rendered };
      outcome =
        choice.kind === "sendgrid"
          ? await deliverViaSendGrid(email, { timeoutMs: ACK_SEND_TIMEOUT_MS })
          : await fakeProvider(recordInOutbox, { fail: fakeFailure(process.env.HQ_EMAIL_FAKE_FAIL), newId: randomUUID }).deliver(email);
    }
  } catch (e) {
    console.error(`[enquiry] thank-you failed for ${tag}: ${errName(e)}`);
    outcome = { ok: false, code: "provider_error" };
  }

  try {
    await store.finish(enquiryId, outcome.ok, outcome.ok ? outcome.messageId : null, outcome.ok ? null : outcome.code);
  } catch (e) {
    // The enquiry stays `sending` (shown as "Thank-you not confirmed"); it is never retried.
    console.error(`[enquiry] thank-you outcome not recorded for ${tag}: ${errName(e)}`);
  }
  if (outcome.ok) {
    console.info(`[enquiry] thank-you sent for ${tag}`);
    return "sent";
  }
  console.error(`[enquiry] thank-you not sent for ${tag}: ${outcome.code}`);
  return "failed";
}
