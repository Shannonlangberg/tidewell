/*
 * The branded PLANTED. email, as plain text and as HTML, from what a person wrote.
 *
 * The look is the 2026 brand (the PLANTED. Design System, "Applications: email"): an ivory page, a
 * forest header carrying the horizontal lockup (ivory letters, pale lime full stop), a white card with
 * 28px corners, Hanken Grotesk for the text (most email clients fall back to Helvetica or Arial), ink
 * on white, muted secondary text, and the signature as the app icon beside one line of details.
 * Everything is inline.
 *
 * Images: only the two brand files below, served from the public site at fixed paths (no query string,
 * so nothing identifies the recipient: no tracking pixel). The email reads correctly when images are
 * blocked: the header's alt text is the brand name in ivory on forest, and the icon is decoration
 * (alt=""). No links are added: what the person wrote, their signature, and the footer.
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

/** The 2026 palette (tokens/colors.css). Hairlines are 12% ink, flattened to hex for email clients. */
export const EMAIL_COLORS = {
  forest: "#14291F",
  ivory: "#F7F5EF",
  white: "#FFFFFF",
  ink: "#1D241E",
  muted: "#5A635B",
  lime: "#E4F0A5",
  line: "#E4E5E4",
  lineOnIvory: "#DDDCD6",
} as const;
const C = EMAIL_COLORS;

/** The site that serves the brand files (public/brand/logos/png). */
const ASSET_BASE = "https://plantedproperty.com.au/brand/logos/png";
/** The horizontal lockup, ivory and lime, 1200 by 117 (shown at 360 by 35). */
export const EMAIL_LOCKUP_URL = `${ASSET_BASE}/planted-lockup-horizontal-ivory-lime-1200.png`;
/** The app icon, forest with the lime full stop, 512 square (shown at 44). */
export const EMAIL_ICON_URL = `${ASSET_BASE}/planted-app-icon-512.png`;

export const EMAIL_FONT = "'Hanken Grotesk','Helvetica Neue',Helvetica,Arial,sans-serif";

/** The forest header with the lockup: the top of every PLANTED. email (render.ts and enquiry-notice.ts). */
export function emailHeader(): string {
  return `<td style="background:${C.forest};padding:36px 36px 32px;border-radius:28px 28px 0 0;">
                <img src="${EMAIL_LOCKUP_URL}" width="360" height="35" alt="${BRAND_LINE}" style="display:block;border:0;outline:none;width:360px;max-width:100%;height:auto;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:35px;letter-spacing:1px;color:${C.ivory};" />
              </td>`;
}

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

/** The signature as the brand shows it: "Name · Role" in ink, then the business in muted text; the business alone when there is no sender. */
function signatureHtml(senderName: string, senderRole: string | null): string {
  const name = line(senderName);
  const role = line(senderRole);
  const first = name ? [name, role].filter(Boolean).join(" · ") : BRAND_LINE;
  const second = name ? `<br /><span style="color:${C.muted};">${escapeHtml(BRAND_LINE)}</span>` : "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-top:1px solid ${C.line};width:100%;">
                      <tr>
                        <td width="44" style="padding-top:22px;vertical-align:middle;"><img src="${EMAIL_ICON_URL}" width="44" height="44" alt="" style="display:block;border:0;outline:none;width:44px;height:44px;border-radius:10px;" /></td>
                        <td style="padding:22px 0 0 14px;vertical-align:middle;font-size:15px;line-height:1.5;color:${C.ink};"><span style="font-weight:600;">${escapeHtml(first)}</span>${second}</td>
                      </tr>
                    </table>`;
}

export function renderHtml(input: RenderInput): string {
  const subject = escapeHtml(line(input.subject));
  const paras = paragraphs(input.body)
    .map(
      (p) =>
        `<tr><td style="font-size:16px;line-height:1.6;padding-bottom:16px;color:${C.ink};">${p.map((l) => escapeHtml(l)).join("<br />")}</td></tr>`,
    )
    .join("\n                  ");
  const footer = escapeHtml(footerText(input.senderName));

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;padding:0;background:${C.ivory};font-family:${EMAIL_FONT};color:${C.ink};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${C.ivory};">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font-family:${EMAIL_FONT};">
            <tr>
              ${emailHeader()}
            </tr>
            <tr>
              <td style="background:${C.white};border-radius:0 0 28px 28px;padding:36px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${paras}
                  <tr><td style="padding-top:8px;">${signatureHtml(input.senderName, input.senderRole)}</td></tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 36px 0;font-size:12px;line-height:1.6;color:${C.muted};">${footer}</td>
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
