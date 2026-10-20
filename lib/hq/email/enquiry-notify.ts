import "server-only";

import { randomUUID } from "node:crypto";
import { STAFF_HQ_URL } from "@/lib/planted";
import { enquiryNotice } from "./enquiry-notice";
import { recordInOutbox } from "./outbox";
import { chooseProvider, fakeProvider, fromMailbox, type OutgoingEmail } from "./provider";
import { deliverViaSendGrid, sendGridConfigured } from "./sendgrid";

/*
 * The staff notification for a new website enquiry: ONE email, to ENQUIRY_TO_EMAIL only, after the
 * enquiry is stored in HQ. Best effort: it never decides whether the enquiry counts as received (HQ
 * storing it does), and a failure is logged and otherwise ignored.
 *
 * This is the second file allowed to import lib/hq/email/sendgrid.ts (eslint.config.mjs), which still
 * holds the only read of SENDGRID_API_KEY. The provider rule is the same as for HQ email: SendGrid in
 * production; elsewhere the FAKE provider (writing to the local outbox folder) unless
 * HQ_EMAIL_PROVIDER=sendgrid is set explicitly, so a development machine never sends a real email.
 *
 * From: EMAIL_FROM_ADDRESS / EMAIL_FROM_NAME (default PLANTED. <hq@plantedproperty.com.au>), as for HQ
 * email. Reply-To is the notification address itself: replying never reaches the enquirer.
 */

export const HQ_ORIGIN = new URL(STAFF_HQ_URL).origin;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NotifyInput = {
  ref: string;
  enquiryId: string;
  opportunityId: string | null;
  kind: "appraisal" | "contact";
  name: string;
  suburb: string | null;
};

export type NotifyOutcome = "sent" | "skipped" | "failed";

/** Sends the notice, or says why not. Never throws; logs the outcome and the ENQ ref only. */
export async function notifyStaffOfEnquiry(input: NotifyInput): Promise<NotifyOutcome> {
  try {
    const to = (process.env.ENQUIRY_TO_EMAIL ?? "").trim();
    if (!to || to.length > 254 || !EMAIL_RE.test(to)) {
      console.info(`[enquiry] staff notification skipped for ${input.ref}: ENQUIRY_TO_EMAIL is not set`);
      return "skipped";
    }
    const choice = chooseProvider({ nodeEnv: process.env.NODE_ENV, provider: process.env.HQ_EMAIL_PROVIDER, hasKey: sendGridConfigured() });
    if (choice.kind === "none") {
      console.error(`[enquiry] staff notification not sent for ${input.ref}: no email provider (SENDGRID_API_KEY)`);
      return "skipped";
    }
    const notice = enquiryNotice({
      ref: input.ref,
      kind: input.kind,
      name: input.name,
      suburb: input.suburb,
      receivedAt: new Date(),
      timezone: "Australia/Adelaide",
      enquiryUrl: `${HQ_ORIGIN}/hq/growth/enquiries/${encodeURIComponent(input.enquiryId)}`,
      leadUrl: input.opportunityId ? `${HQ_ORIGIN}/hq/growth/opportunities/${encodeURIComponent(input.opportunityId)}` : null,
    });
    const from = fromMailbox({ address: process.env.EMAIL_FROM_ADDRESS, name: process.env.EMAIL_FROM_NAME });
    const email: OutgoingEmail = { to: { email: to }, from, replyTo: { email: to }, ...notice };
    const outcome =
      choice.kind === "sendgrid" ? await deliverViaSendGrid(email) : await fakeProvider(recordInOutbox, { newId: randomUUID }).deliver(email);
    if (outcome.ok) {
      console.info(`[enquiry] staff notification sent for ${input.ref} via ${choice.kind}`);
      return "sent";
    }
    console.error(`[enquiry] staff notification failed for ${input.ref}: ${outcome.code}`);
    return "failed";
  } catch (e) {
    console.error(`[enquiry] staff notification failed for ${input.ref}: ${e instanceof Error ? e.name : "error"}`);
    return "failed";
  }
}
