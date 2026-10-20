/*
 * Input schemas for the email MCP tools (zod raw shapes). Kept apart from schemas.ts so email could be
 * built in parallel with the leads and portfolio tools. Imports only zod: the enum lists are written out
 * and pinned to lib/hq/email/rules.ts by email-schemas.test.mts.
 *
 * There is deliberately NO field for an email address to send to, and no cc or bcc: the recipient is
 * always a person HQ already holds an address for. The only address a chat app may pass is
 * confirm_recipient_email, which must equal the address already on the draft.
 */
import { z } from "zod";

export const EMAIL_TEMPLATE_VALUES = ["thank_you", "follow_up", "introduction", "general"] as const;
export const EMAIL_LIST_STATUS_VALUES = ["waiting", "sent", "not_sent", "discarded", "all"] as const;

const draftRef = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .describe("The email: its number as HQ shows it (EML-0001), or its id from an earlier result.");

const subject = z.string().trim().min(1).max(200).describe("The subject line (one line, at most 200 characters).");
const body = z
  .string()
  .trim()
  .min(1)
  .max(8000)
  .describe(
    "The message in plain text (at most 8000 characters); a blank line starts a new paragraph. Start with a greeting such as 'Hi Tim,'. Do NOT add a signature or sign-off block: HQ adds the person's name, role and the PLANTED. footer. Use only what the person actually said: never invent promises, prices, fees, dates, times, figures or claims.",
  );

export const draftEmailShape = {
  recipient: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      "Who it is to: a contact or a member of HQ staff, by name as people say it, or an id from an earlier result (contact:<uuid> or staff:<uuid>). Never an email address: HQ uses the address already on that person's record. If several people match you get candidates to choose from.",
    ),
  recipient_kind: z.enum(["contact", "staff", "any"]).optional().describe("Optional. contact, staff, or any (default): where to look for the recipient."),
  template: z.enum(EMAIL_TEMPLATE_VALUES).describe("The kind of email: thank_you, follow_up, introduction or general."),
  subject,
  body,
};

export const listEmailDraftsShape = {
  status: z
    .enum(EMAIL_LIST_STATUS_VALUES)
    .optional()
    .describe("Optional. waiting (default: drafts waiting for approval, approved and sending), sent, not_sent (a send failed), discarded, or all."),
  limit: z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10)."),
};

export const getEmailDraftShape = { draft: draftRef };

export const updateEmailDraftShape = {
  draft: draftRef,
  subject: subject.optional().describe("Optional. The new subject line (at most 200 characters)."),
  body: body.optional().describe("Optional. The new message in plain text (at most 8000 characters), with the same rules as draft_email: only what the person said, no invented promises, prices, dates or claims, no sign-off."),
  template: z.enum(EMAIL_TEMPLATE_VALUES).optional().describe("Optional. thank_you, follow_up, introduction or general."),
};

export const discardEmailDraftShape = {
  draft: draftRef,
  reason: z.string().trim().max(300).optional().describe("Optional. Why it is being discarded (at most 300 characters)."),
};

export const sendEmailDraftShape = {
  draft: draftRef,
  confirm_recipient_email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .describe(
      "Only for sending an UNAPPROVED draft when chat sending is switched on: the recipient's address exactly as the draft shows it, after the person has confirmed it. It is compared with the draft; it never changes where the email goes.",
    ),
};
