"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { processEnquiry, type DeliveryDeps, type EnquiryKind, type EnquiryState } from "@/lib/enquiries";
import { beginEnquiryAck, finishEnquiryAck, submitToHq } from "@/lib/hq/enquiry-intake";
import { acknowledgeEnquiry } from "@/lib/hq/email/enquiry-ack";
import { notifyStaffOfEnquiry } from "@/lib/hq/email/enquiry-notify";

/*
 * The two enquiry Server Actions.
 *
 * These are reachable by direct POST, so nothing the client did is trusted:
 * every submission is read from the FormData and re-validated from scratch
 * (lib/enquiries.ts processEnquiry: honeypot, timing, validation, Turnstile).
 * Only then is it delivered: stored in Planted HQ through hq.submit_enquiry
 * (lib/hq/enquiry-intake.ts; the database validates, dedupes and rate-limits
 * again), followed by a best-effort email to staff (ENQUIRY_TO_EMAIL only) and
 * then a best-effort thank-you to the enquirer (one per address per day, and
 * only when the database allows it: lib/hq/email/enquiry-ack.ts).
 *
 * Both actions work with or without JavaScript — the form sends a flag, and
 * without it a success redirects to the shared confirmation page instead of
 * returning a state for the component to render.
 *
 * The one rule that outranks everything else: a person is only ever told their
 * enquiry was sent when it was actually delivered (stored in HQ, or delivered
 * by another configured adapter). An email notice or a thank-you failing after
 * HQ stored it does not change that.
 */

async function deliveryDeps(): Promise<DeliveryDeps> {
  const h = await headers();
  return {
    hq: (enquiry) => submitToHq({ kind: enquiry.kind, data: enquiry.data }, h),
    notify: (enquiry, stored) =>
      notifyStaffOfEnquiry({
        ref: stored.ref,
        enquiryId: stored.enquiryId,
        opportunityId: stored.opportunityId,
        kind: enquiry.kind,
        name: enquiry.data.name ?? "",
        suburb: enquiry.suburb,
      }),
    acknowledge: (_enquiry, stored) => acknowledgeEnquiry(stored.enquiryId, stored.ref, { begin: beginEnquiryAck, finish: finishEnquiryAck }),
  };
}

async function run(kind: EnquiryKind, form: FormData): Promise<EnquiryState> {
  const { state, redirectTo } = await processEnquiry(kind, form, await deliveryDeps());
  if (redirectTo) redirect(redirectTo);
  return state;
}

export async function submitAppraisal(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  return run("appraisal", form);
}

export async function submitContact(_prev: EnquiryState, form: FormData): Promise<EnquiryState> {
  return run("contact", form);
}
