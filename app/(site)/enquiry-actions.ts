"use server";

import { redirect } from "next/navigation";
import {
  appraisalErrors,
  buildAppraisal,
  buildContact,
  contactErrors,
  deliver,
  hasJs,
  logOutcome,
  MESSAGES,
  readAppraisal,
  readContact,
  screen,
  verifyTurnstile,
  type EnquiryState,
  type FieldErrors,
  type Values,
} from "@/lib/enquiries";

/*
 * The two enquiry Server Actions.
 *
 * These are reachable by direct POST, so nothing the client did is trusted:
 * every submission is read from the FormData and re-validated here from
 * scratch. Both actions work with or without JavaScript — the form sends a
 * flag, and without it a success redirects to the shared confirmation page
 * instead of returning a state for the component to render.
 *
 * The one rule that outranks everything else: a person is only ever told their
 * enquiry was sent when it was actually delivered.
 */

const SUCCESS_PATH = "/enquiry-received";

function invalid(message: string, errors: FieldErrors, values: Values): EnquiryState {
  return { status: "invalid", message, errors, values };
}

/** A real, delivered submission. The form is emptied, so no values come back. */
const SENT: EnquiryState = { status: "sent", message: MESSAGES.sent, errors: {}, values: {} };

export async function submitAppraisal(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const js = hasJs(form);
  const verdict = screen(form);

  // A filled honeypot is a bot. It is discarded and shown the ordinary
  // success, so the bot learns nothing about why it failed.
  if (verdict === "honeypot") {
    logOutcome("appraisal", null, verdict);
    if (!js) redirect(SUCCESS_PATH);
    return SENT;
  }

  const values = readAppraisal(form);

  if (verdict === "too-fast") {
    logOutcome("appraisal", null, verdict);
    return invalid(MESSAGES.tooFast, {}, values);
  }

  const errors = appraisalErrors(values);
  if (Object.keys(errors).length > 0) return invalid(MESSAGES.invalid, errors, values);

  if (!(await verifyTurnstile(form))) return invalid(MESSAGES.robot, {}, values);

  const enquiry = buildAppraisal(values);
  const outcome = await deliver(enquiry);
  logOutcome("appraisal", enquiry.suburb, outcome);

  if (!outcome.ok) {
    return { status: "failed", message: failureMessage(outcome.reason), errors: {}, values };
  }

  if (!js) redirect(SUCCESS_PATH);
  return SENT;
}

export async function submitContact(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  const js = hasJs(form);
  const verdict = screen(form);

  if (verdict === "honeypot") {
    logOutcome("contact", null, verdict);
    if (!js) redirect(SUCCESS_PATH);
    return SENT;
  }

  const values = readContact(form);

  if (verdict === "too-fast") {
    logOutcome("contact", null, verdict);
    return invalid(MESSAGES.tooFast, {}, values);
  }

  const errors = contactErrors(values);
  if (Object.keys(errors).length > 0) return invalid(MESSAGES.invalid, errors, values);

  if (!(await verifyTurnstile(form))) return invalid(MESSAGES.robot, {}, values);

  const enquiry = buildContact(values);
  const outcome = await deliver(enquiry);
  logOutcome("contact", enquiry.suburb, outcome);

  if (!outcome.ok) {
    return { status: "failed", message: failureMessage(outcome.reason), errors: {}, values };
  }

  if (!js) redirect(SUCCESS_PATH);
  return SENT;
}

/*
 * Not exported: a "use server" file may only export async functions, and these
 * two are plain helpers.
 */
function failureMessage(reason: "unconfigured" | "failed"): string {
  return reason === "unconfigured" ? MESSAGES.unconfigured : MESSAGES.failed;
}
