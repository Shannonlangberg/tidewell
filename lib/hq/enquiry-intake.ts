import "server-only";

import { createSecretClient, derivedSecret } from "@/lib/supabase/secret";
import { clientIp, hashIp, intakeFailure, intakeSuccess, ipSalt, submitArgs, type IntakeEnquiry, type IntakeResult } from "./enquiry-rules";

/*
 * Website enquiries into Planted HQ: the ONE place the public site's path touches the secret key
 * (eslint.config.mjs allows this file, and only this file, among the site's code). It does exactly one
 * thing with it: call hq.submit_enquiry, which the database grants to service_role only. That function
 * validates and caps every field again, dedupes, rate-limits, and creates the contact, the lead, the
 * timeline entry and the reply task (migration 0134).
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
