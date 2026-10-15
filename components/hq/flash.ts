/*
 * Redirect-after-action toasts. A Server Action finishes with
 *   redirect(withToast("/hq/growth/contacts/123", "Contact saved"))
 * and <FlashFromSearchParams/> (mounted by app/hq/layout.tsx) shows it once, then
 * removes the parameters from the address bar.
 *
 * Server-safe: no client imports. Messages are plain text and are never rendered
 * as HTML.
 */

export type FlashTone = "success" | "error" | "info";

export const FLASH_PARAM = "toast";
export const FLASH_TONE_PARAM = "toast_tone";
export const FLASH_MAX_LENGTH = 160;

export function withToast(path: string, message: string, tone: FlashTone = "success"): string {
  const [base, existing = ""] = path.split("?", 2);
  const params = new URLSearchParams(existing);
  params.set(FLASH_PARAM, message.slice(0, FLASH_MAX_LENGTH));
  if (tone !== "success") params.set(FLASH_TONE_PARAM, tone);
  return `${base}?${params.toString()}`;
}
