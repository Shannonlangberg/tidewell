/**
 * Facts the public site states about the business. Anything left null is hidden
 * everywhere it would appear, so nothing unconfirmed is shown to visitors.
 * Fill these in once they are real (see the pre-launch checklist in README.md).
 */
export const SITE = {
  name: "Tidewell",
  tagline: "Holiday homes, kept well.",
  region: "Copper Coast, South Australia",
  towns: ["Moonta Bay", "Port Hughes", "Wallaroo", "North Beach"],

  /** e.g. "0400 000 000". Shown with a tel: link when set. */
  phone: null as string | null,
  /** e.g. "hello@example.com.au". Shown with a mailto: link when set. */
  email: null as string | null,
  /** e.g. "https://tidewell.com.au". Used for Open Graph and JSON-LD when set. */
  url: null as string | null,
  /** e.g. "Tidewell Property Co Pty Ltd". */
  legalName: null as string | null,
  /** e.g. "ABN 00 000 000 000". */
  abn: null as string | null,
};

export function telHref(phone: string) {
  return `tel:${phone.replace(/[^+\d]/g, "")}`;
}
