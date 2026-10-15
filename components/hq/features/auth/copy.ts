/*
 * Words shared by the sign-in screens and their Server Actions. Plain strings, so both
 * server and client code can import them.
 */

/** The reply to a code request: the same whether or not the address is set up. */
export const CODE_SENT_MESSAGE = "If that address is set up with us, a code is on its way.";

export const NO_ACCESS_TITLE = "This login does not have access to Planted HQ";
export const NO_ACCESS_BODY =
  "You have been signed out on this device. If you should have access, ask a director to add you, then sign in again with the address they used.";

export const INACTIVE_TITLE = "Your access to Planted HQ is no longer active";
export const INACTIVE_BODY = "If you think that is a mistake, ask a director or administrator.";

/** "jane@planted.com.au" becomes "j***@planted.com.au". Shown back to the person so a typo is easy to spot. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "your address";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local[0]}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}${domain}`;
}
