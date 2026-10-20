/*
 * The staff notification for a new website enquiry, as plain text and HTML. It goes ONLY to the
 * address in ENQUIRY_TO_EMAIL (never to the person who filled in the form) and carries plain facts and
 * links into HQ: which form, the ENQ number, the name and suburb as given, when it arrived. The
 * message, email address and phone number stay in HQ (behind sign-in), so the inbox holds as little
 * personal information as possible.
 *
 * Everything the public typed is escaped for HTML and reduced to one line; nothing in it becomes a
 * link. Pure with NO imports: unit tested with `node --test` (enquiry-notice.test.mts).
 */

export type EnquiryNoticeInput = {
  ref: string;
  kind: "appraisal" | "contact";
  name: string;
  suburb: string | null;
  receivedAt: Date;
  timezone: string;
  /** Absolute HQ links. */
  enquiryUrl: string;
  leadUrl: string | null;
};

const C = { charcoal: "#252525", ivory: "#F5F1EA", softWhite: "#FAF8F4", border: "#DED8D0", greyText: "#5F5B56" } as const;

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** One line, at most `max` characters: control characters out, spaces collapsed. */
function line(value: string | null | undefined, max = 120): string {
  const v = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/** Only http(s) links we built ourselves are used; anything else is dropped. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function enquiryNotice(input: EnquiryNoticeInput): { subject: string; text: string; html: string } {
  const what = input.kind === "appraisal" ? "Rental appraisal request" : "Contact form enquiry";
  const name = line(input.name) || "Someone";
  const suburb = line(input.suburb);
  let when: string;
  try {
    when = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: input.timezone }).format(input.receivedAt);
  } catch {
    when = input.receivedAt.toISOString();
  }
  const enquiryUrl = safeUrl(input.enquiryUrl);
  const leadUrl = safeUrl(input.leadUrl);
  const ref = line(input.ref, 20);

  const subject = `New website enquiry ${ref}: ${what}${suburb ? ` (${suburb})` : ""}`;
  const facts: [string, string][] = [
    ["Form", what],
    ["Enquiry", ref],
    ["Name", name],
    ...(suburb ? ([["Suburb", suburb]] as [string, string][]) : []),
    ["Received", when],
  ];

  const text = [
    `A new website enquiry is in Planted HQ.`,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    ...(enquiryUrl ? [`Read it in HQ: ${enquiryUrl}`] : []),
    ...(leadUrl ? [`Open the lead: ${leadUrl}`] : []),
    "",
    "The message and contact details are in HQ. A follow-up task, due today, is on the owner's list.",
    "This is an automatic notice from the PLANTED. website. A reply to it comes back to this inbox, never to the enquirer.",
  ].join("\n");

  const rows = facts
    .map(
      ([k, v]) =>
        `<tr><th align="left" style="padding:6px 16px 6px 0;vertical-align:top;font-weight:600;white-space:nowrap;color:${C.charcoal}">${esc(k)}</th>` +
        `<td style="padding:6px 0;vertical-align:top;color:${C.charcoal}">${esc(v)}</td></tr>`,
    )
    .join("");
  const link = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 12px 8px 0;padding:10px 16px;background:${C.charcoal};color:${C.ivory};text-decoration:none;border-radius:4px;font-weight:600">${esc(label)}</a>`;

  const html = [
    `<div style="background:${C.softWhite};padding:24px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${C.charcoal}">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${C.border};border-radius:4px">`,
    `<div style="background:${C.charcoal};color:${C.ivory};padding:16px 24px;font-family:Georgia,'Times New Roman',serif;font-size:20px;letter-spacing:0.04em">PLANTED.</div>`,
    `<div style="padding:24px">`,
    `<p style="margin:0 0 16px">A new website enquiry is in Planted HQ.</p>`,
    `<table cellpadding="0" cellspacing="0" border="0">${rows}</table>`,
    `<p style="margin:20px 0 8px">`,
    enquiryUrl ? link(enquiryUrl, "Read it in HQ") : "",
    leadUrl ? link(leadUrl, "Open the lead") : "",
    `</p>`,
    `<p style="margin:12px 0 0;color:${C.greyText};font-size:13px">The message and contact details are in HQ. A follow-up task, due today, is on the owner&#39;s list. This is an automatic notice from the PLANTED. website.</p>`,
    `</div></div></div>`,
  ].join("");

  return { subject, text, html };
}
