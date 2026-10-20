import "server-only";

import { createSecretClient, derivedSecret } from "@/lib/supabase/secret";
import { ackBegun, clientIp, hashIp, intakeFailure, intakeSuccess, ipSalt, submitArgs, type AckBegun, type IntakeEnquiry, type IntakeResult } from "./enquiry-rules";

/*
 * Website enquiries into Planted HQ: the ONE place the public site's path touches the secret key
 * (eslint.config.mjs allows this file, and only this file, among the site's code). It does exactly one
 * thing with it: call the three website functions the database grants to service_role only.
 * hq.submit_enquiry validates and caps every field again, dedupes, rate-limits, and creates the contact,
 * the lead, the timeline entry and the reply task (migration 0134). hq.begin_enquiry_auto_reply and
 * hq.finish_enquiry_auto_reply decide and record the automatic thank-you to the enquirer (0136); the
 * email itself is sent by lib/hq/email/enquiry-ack.ts, which never sees this key.
 *
 * The caller (app/(site)/enquiry-actions.ts, through lib/enquiries.ts) has already validated the form
 * and run the honeypot, timing and Turnstile checks. Nothing here trusts that: the database decides.
 *
 * Privacy: the client IP is reduced to a salted SHA-256 here and never stored, logged or returned. The
 * salt is ENQUIRY_IP_SALT (16+ characters), else a value derived from the secret key inside
 * lib/supabase/secret.ts. Logs carry the outcome and the ENQ ref only: never the key, a name, an email,
 * a phone number or the message.
 */

/** Well inside Netlify's synchronous function limit, with room for the notification after it. */
const INTAKE_TIMEOUT_MS = 8000;

type HeaderGetter = { get(name: string): string | null };

/** The salted hash of the caller's IP, or null when no address is known (the IP rate limit is then skipped; the email limit still applies). */
export function enquiryIpHash(headers: HeaderGetter): string | null {
  const ip = clientIp(headers);
  if (!ip) return null;
  const salt = ipSalt(process.env.ENQUIRY_IP_SALT, derivedSecret("enquiry-ip-salt"));
  return salt ? hashIp(ip, salt) : null;
}

/** Stores the enquiry in HQ. A success means it is stored (or was already, for a duplicate). */
export async function submitToHq(enquiry: IntakeEnquiry, headers: HeaderGetter): Promise<IntakeResult> {
  let client: ReturnType<typeof createSecretClient>;
  try {
    client = createSecretClient();
  } catch {
    console.error("[enquiry] hq intake not configured (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is missing)");
    return { ok: false, reason: "unconfigured" };
  }

  const args = submitArgs(enquiry, enquiryIpHash(headers));
  try {
    const { data, error } = await client.schema("hq").rpc("submit_enquiry", args).abortSignal(AbortSignal.timeout(INTAKE_TIMEOUT_MS));
    if (error) {
      const reason = intakeFailure(error);
      console.error(`[enquiry] hq intake refused: kind=${enquiry.kind} reason=${reason} code=${error.code ?? "none"}`);
      return { ok: false, reason };
    }
    const result = intakeSuccess(data);
    if (result.ok) console.info(`[enquiry] hq intake stored: kind=${enquiry.kind} ref=${result.ref} duplicate=${result.duplicate}`);
    else console.error(`[enquiry] hq intake gave an unexpected answer: kind=${enquiry.kind}`);
    return result;
  } catch (e) {
    const reason = intakeFailure({ name: e instanceof Error ? e.name : null, message: e instanceof Error ? e.message : null });
    console.error(`[enquiry] hq intake failed: kind=${enquiry.kind} reason=${reason}`);
    return { ok: false, reason };
  }
}

// ── the automatic thank-you (0136): the database decides, the email file only delivers ──

/** Short: the thank-you runs after the enquiry is stored and the staff notice is sent, while the visitor waits. */
const ACK_DB_TIMEOUT_MS = 2500;

/**
 * hq.begin_enquiry_auto_reply (service_role only): may the thank-you go, and to whom? It applies the
 * switch, the 24-hour per-address limit, the hourly cap and the never-twice guard, and records a refusal.
 * Throws on any error (the caller swallows it).
 */
export async function beginEnquiryAck(enquiryId: string): Promise<AckBegun> {
  const client = createSecretClient();
  const { data, error } = await client.schema("hq").rpc("begin_enquiry_auto_reply", { p_enquiry_id: enquiryId }).abortSignal(AbortSignal.timeout(ACK_DB_TIMEOUT_MS));
  if (error) throw Object.assign(new Error("begin_enquiry_auto_reply refused"), { name: "AckBeginError", code: error.code ?? "none" });
  return ackBegun(data);
}

/** hq.finish_enquiry_auto_reply (service_role only): what the provider said. Writes the timeline entry on success. Throws on error. */
export async function finishEnquiryAck(enquiryId: string, ok: boolean, messageId: string | null, errorCode: string | null): Promise<void> {
  const client = createSecretClient();
  const { error } = await client
    .schema("hq")
    .rpc("finish_enquiry_auto_reply", { p_enquiry_id: enquiryId, p_ok: ok, ...(messageId ? { p_message_id: messageId } : {}), ...(errorCode ? { p_error: errorCode } : {}) })
    .abortSignal(AbortSignal.timeout(ACK_DB_TIMEOUT_MS));
  if (error) throw Object.assign(new Error("finish_enquiry_auto_reply refused"), { name: "AckFinishError", code: error.code ?? "none" });
}
