/*
 * The automatic thank-you to someone who filled in a form on the PLANTED. website, as plain text and
 * HTML. It goes to the address THEY typed (an unauthenticated member of the public), so it is generic on
 * purpose:
 *
 *   - it never echoes what they wrote: no message, no phone, no address, no suburb, no ENQ number;
 *   - it greets by first name only when that passes a strict check (letters, spaces, hyphens and
 *     apostrophes, at most 40 characters), otherwise "Hello,". Whatever is used is escaped by the
 *     renderer;
 *   - it promises nothing the owner has not confirmed: no response time, hours, prices or services.
 *     It says we have received the message and will be in touch;
 *   - the contact details shown are exactly the confirmed ones passed in (CONTACT in lib/planted.ts),
 *     each only when it is set;
 *   - it says what to do if they did not send it, and carries the same signature line, footer
 *     (identification and opt-out, pending legal review) and look as every HQ email (render.ts).
 *
 * No server-only imports: unit tested with `node --test` (enquiry-ack-email.test.mts).
 */
import { renderEmail, type RenderedEmail } from "./render";

export const ACK_SUBJECT = "Thank you for contacting PLANTED.";
const NAME_MAX = 40;

/**
 * The name to greet by, or null for "Hello,". Only letters (any alphabet), spaces, hyphens and
 * apostrophes; it must start with a letter; at most 40 characters. Anything else (digits, brackets,
 * dots, @, links, control characters) gives null.
 */
export function ackGreetingName(raw: string | null | undefined): string | null {
  const v = (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (!v || v.length > NAME_MAX) return null;
  return /^\p{L}[\p{L}\p{M} '’-]*$/u.test(v) ? v : null;
}

export type AckContact = { email: string | null; phone: string | null };

/** A confirmed contact value, only when it is a plain single line. */
function contactLine(value: string | null): string | null {
  const v = (value ?? "").trim();
  return v && v.length <= 120 && !/[\u0000-\u001f\u007f]/.test(v) ? v : null;
}

export function enquiryAckBody(firstName: string | null | undefined, contact: AckContact): string {
  const name = ackGreetingName(firstName);
  const email = contactLine(contact.email);
  const phone = contactLine(contact.phone);
  const reach = [email ? `Email: ${email}` : null, phone ? `Phone: ${phone}` : null].filter((l): l is string => l !== null);
  return [
    name ? `Hello ${name},` : "Hello,",
    "Thank you for getting in touch with PLANTED. We have received your message and will be in touch.",
    ...(reach.length ? [["You can also reach us here:", ...reach].join("\n")] : []),
    "If you did not send this enquiry, you can ignore this email.",
  ].join("\n\n");
}

/** The whole email: the subject, the plain-text part and the branded HTML part. */
export function enquiryAckEmail(input: { firstName: string | null | undefined; contact: AckContact }): RenderedEmail {
  // No sender name: the signature is "PLANTED. Property Management" alone, and the footer says it was
  // sent on behalf of "our team" (render.ts footerText).
  return renderEmail({ subject: ACK_SUBJECT, body: enquiryAckBody(input.firstName, input.contact), senderName: "", senderRole: null });
}
