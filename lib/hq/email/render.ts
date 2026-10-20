/*
 * The branded PLANTED. email, as plain text and as HTML, from what a person wrote.
 *
 * The look matches supabase/templates/otp.html (the sign-in code email): a charcoal header with the
 * wordmark, a soft-white card with a hairline border and a 4px radius, Georgia for the wordmark and
 * Arial for the text (email clients ignore web fonts), everything inline. No remote images, no
 * tracking pixel, no links added: what the person wrote, their signature, and the footer.
 *
 * The signature carries only what HQ knows for certain: the sender's name, their HQ role, and
 * "PLANTED. Property Management". No phone number, address, ABN or licence is invented.
 *
 * The footer identifies the sender and says how to opt out (Spam Act 2003 style). Its wording is a
 * placeholder pending legal review (docs/hq-setup.md, Email).
 *
 * Pure with NO imports: unit tested with `node --test` (render.test.mts).
 */

export const BRAND_NAME = "PLANTED.";
export const BRAND_LINE = "PLANTED. Property Management";

export type RenderInput = {
  subject: string;
  /** Plain text; a blank line starts a new paragraph. */
  body: string;
  /** The person the email is from (the drafter). */
  senderName: string;
  /** Their HQ role as people read it, for example "Business Development Manager". */
  senderRole: string | null;
};

export type RenderedEmail = { subject: string; text: string; html: string };

const C = {
  charcoal: "#252525",
  ivory: "#F5F1EA",
  softWhite: "#FAF8F4",
  border: "#DED8D0",
  clay: "#A89A8B",
  greyText: "#5F5B56",
  muted: "#6F6B66",
} as const;

/** Escapes text for HTML element content and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** One line (names, subject): control characters out, spaces collapsed. */
function line(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/** Paragraphs from blank lines; single line breaks stay inside a paragraph. */
export function paragraphs(body: string): string[][] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.split("\n").map((l) => l.replace(/[ \t]+$/g, "")))
    .map((lines) => {
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return lines;
    })
    .filter((lines) => lines.length > 0);
}

/** The footer sentence (identification and opt-out). Pending legal review. */
export function footerText(senderName: string): string {
  const name = line(senderName) || "our team";
  return `Sent by ${BRAND_LINE} on behalf of ${name}. Reply to this email to reach ${name}. If you would rather not receive emails from us, reply with the word unsubscribe.`;
}

/** The signature lines: name, role (when known), the business. */
export function signatureLines(senderName: string, senderRole: string | null): string[] {
  return [line(senderName), line(senderRole), BRAND_LINE].filter(Boolean);
}

export function renderText(input: RenderInput): string {
  const body = paragraphs(input.body)
    .map((p) => p.join("\n"))
    .join("\n\n");
  return [body, "", "--", ...signatureLines(input.senderName, input.senderRole), "", footerText(input.senderName), ""].join("\n");
}

export function renderHtml(input: RenderInput): string {
  const subject = escapeHtml(line(input.subject));
  const paras = paragraphs(input.body)
    .map(
      (p) =>
        `<tr><td style="font-size:16px;line-height:1.6;padding-bottom:16px;color:${C.charcoal};">${p.map((l) => escapeHtml(l)).join("<br />")}</td></tr>`,
    )
    .join("\n                  ");
  const [name, ...rest] = signatureLines(input.senderName, input.senderRole);
  const sig = [
    `<span style="font-weight:bold;color:${C.charcoal};">${escapeHtml(name ?? "")}</span>`,
    ...rest.map((r) => `<span style="color:${C.greyText};">${escapeHtml(r)}</span>`),
  ].join("<br />");
  const footer = escapeHtml(footerText(input.senderName));

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:${C.ivory};font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:${C.charcoal};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.ivory};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
            <tr>
              <td style="background:${C.charcoal};padding:26px 32px;border-radius:4px 4px 0 0;">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1;letter-spacing:1.5px;color:${C.ivory};">${BRAND_NAME}</span><br />
                <span style="font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:1;letter-spacing:3px;color:${C.clay};text-transform:uppercase;display:inline-block;margin-top:10px;">Property Management</span>
              </td>
            </tr>
            <tr>
              <td style="background:${C.softWhite};border:1px solid ${C.border};border-top:0;border-radius:0 0 4px 4px;padding:32px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${paras}
                  <tr><td style="font-size:15px;line-height:1.6;padding-top:8px;padding-bottom:22px;">${sig}</td></tr>
                  <tr><td style="font-size:13px;line-height:1.6;color:${C.muted};border-top:1px solid ${C.border};padding-top:18px;">${footer}</td></tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}

export function renderEmail(input: RenderInput): RenderedEmail {
  return { subject: line(input.subject), text: renderText(input), html: renderHtml(input) };
}
