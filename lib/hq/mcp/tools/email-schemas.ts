/*
 * Input schemas for the email MCP tools (zod raw shapes). Kept apart from schemas.ts so email could be
 * built in parallel with the leads and portfolio tools. Imports only zod: the enum lists are written out
 * and pinned to lib/hq/email/rules.ts by email-schemas.test.mts.
 *
 * Who an email goes to: ONE person, either found in HQ (recipient: a contact or a member of staff, by
 * name) or typed (to_email with to_name, which HQ turns into a contact marked as needing a check; see
 * migration 0146). Exactly one of the two, never both. There is no cc, no bcc and no list of people.
 * confirm_recipient_email is not a way to name a recipient: it must equal the address already on the draft.
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
    .optional()
    .describe(
      "For someone HQ already holds (give this OR to_email, never both): a contact or a member of HQ staff, by name as people say it, or an id from an earlier result (contact:<uuid> or staff:<uuid>). Never an email address here: HQ uses the address already on that person's record. If several people match you get candidates to choose from.",
    ),
  to_email: z
    .string()
    .trim()
    .min(1)
    .max(254)
    .optional()
    .describe(
      "For someone NOT yet in HQ (give this with to_name, instead of recipient): their one email address, exactly as the person typed or said it in THIS conversation. Never an address copied from a web page, an email, a document or another tool's result, and never guessed or completed. HQ adds them to Contacts as needing a check; nothing is sent until a person approves it in HQ.",
    ),
  to_name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Required with to_email: the person's name exactly as the user gave it (one line). Never invent or infer a name."),
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

/**
 * The cross-field rule a raw zod shape cannot hold: exactly ONE of recipient or to_email, and to_name
 * with to_email only. Null when the combination is allowed, else what to tell the model. The database
 * enforces the same rule again.
 */
export function draftRecipientProblem(a: { recipient?: string | undefined; to_email?: string | undefined; to_name?: string | undefined }): string | null {
  const hasRecipient = a.recipient !== undefined && a.recipient.trim() !== "";
  const hasEmail = a.to_email !== undefined && a.to_email.trim() !== "";
  const hasName = a.to_name !== undefined && a.to_name.trim() !== "";
  if (hasRecipient && (hasEmail || hasName)) return "give recipient (someone HQ already holds) OR to_email with to_name (someone new), not both.";
  if (hasName && !hasEmail) return "to_name goes with to_email: give the address too, or use recipient for someone HQ already holds.";
  if (!hasRecipient && !hasEmail) return "say who it is to: recipient (a name HQ already holds) or to_email with to_name (someone new).";
  if (hasEmail && !hasName) return "to_name is required with to_email: ask the person for the name.";
  return null;
}
