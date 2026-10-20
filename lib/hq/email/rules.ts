/*
 * Email drafting and sending: the vocabulary, limits and plain-language messages shared by the HQ
 * screens, the MCP tools and the send orchestrator. The database (0132) is the authority; these
 * mirror its rules so a person is told the same thing everywhere.
 *
 * Pure with NO value imports, so `node --test` can load it under type stripping.
 */

export const EMAIL_TEMPLATES = ["thank_you", "follow_up", "introduction", "general"] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
export const EMAIL_TEMPLATE_LABEL: Record<EmailTemplate, string> = {
  thank_you: "Thank you",
  follow_up: "Follow-up",
  introduction: "Introduction",
  general: "General",
};

export const EMAIL_STATUSES = ["draft", "approved", "sending", "sent", "failed", "discarded"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];
export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  draft: "Waiting for approval",
  approved: "Approved, not sent",
  sending: "Sending",
  sent: "Sent",
  failed: "Not sent",
  discarded: "Discarded",
};
export const EMAIL_STATUS_TONE: Record<EmailStatus, "neutral" | "info" | "success" | "warning" | "error"> = {
  draft: "warning",
  approved: "info",
  sending: "info",
  sent: "success",
  failed: "error",
  discarded: "neutral",
};

export const isEmailTemplate = (v: unknown): v is EmailTemplate => typeof v === "string" && (EMAIL_TEMPLATES as readonly string[]).includes(v);
export const isEmailStatus = (v: unknown): v is EmailStatus => typeof v === "string" && (EMAIL_STATUSES as readonly string[]).includes(v);

// ── limits (the database enforces each one) ─────────────────

export const SUBJECT_MAX = 200;
export const BODY_MAX = 8000;
export const DRAFTS_PER_HOUR = 30;
export const CHAT_SEND_WINDOW_MINUTES = 30;
export const DAILY_LIMIT_DEFAULT = 20;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 200;
/** A send that has not finished after this long may be discarded (the server stopped mid-send). */
export const STUCK_SENDING_MINUTES = 15;

/** EML-0001, as the database writes it. */
export function emailRef(n: number): string {
  const s = String(Math.trunc(n));
  return `EML-${s.padStart(Math.max(4, s.length), "0")}`;
}

/** "EML-0007" / "eml 7" -> 7, else null. */
export function parseEmailRef(input: string): number | null {
  const m = /^eml[-\s]?0*(\d{1,9})$/i.exec(input.trim());
  return m ? Number(m[1]) : null;
}

// ── cleaning what a person typed (the same rules as the database) ──

/** One line: control characters become spaces, repeated spaces collapse, trimmed. */
export function normaliseSubject(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Plain text with paragraphs: CR LF -> LF, other control characters out (tab kept), trimmed. */
export function normaliseBody(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f\u0000]/g, "")
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "");
}

export type EmailFields = { subject: string; body: string; template: EmailTemplate };

/** Checks the editable fields. Errors are keyed by form field name. */
export function validateEmailFields(input: { subject?: string | null; body?: string | null; template?: string | null }): { values: EmailFields; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const subject = normaliseSubject(input.subject);
  const body = normaliseBody(input.body);
  const template = isEmailTemplate(input.template) ? input.template : null;
  if (!subject) errors.subject = "Add a subject.";
  else if (subject.length > SUBJECT_MAX) errors.subject = `The subject must be ${SUBJECT_MAX} characters or fewer.`;
  if (!body) errors.body = "Write the message.";
  else if (body.length > BODY_MAX) errors.body = `The message must be ${BODY_MAX} characters or fewer.`;
  if (!template) errors.template = "Choose a template.";
  return { values: { subject, body, template: template ?? "general" }, errors };
}

/** The given name for a greeting: the first word of a full name. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * What a template fills in to start from: a suggested subject and a greeting, nothing more. A template
 * never adds facts (no dates, prices, promises or claims): the person writes what they want to say.
 */
export function templateStart(template: EmailTemplate, recipientName: string | null | undefined): { subject: string; body: string } {
  const first = firstNameOf(recipientName);
  const greeting = first ? `Hi ${first},\n\n` : "Hi,\n\n";
  const subject: Record<EmailTemplate, string> = {
    thank_you: "Thank you",
    follow_up: "Following up",
    introduction: "An introduction",
    general: "",
  };
  return { subject: subject[template], body: greeting };
}

// ── settings ─────────────────────────────────────────────────

/** A whole number from 1 to 200, or null. */
export function parseDailyLimit(input: unknown): number | null {
  const s = typeof input === "number" ? String(input) : typeof input === "string" ? input.trim() : "";
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= DAILY_LIMIT_MIN && n <= DAILY_LIMIT_MAX ? n : null;
}

/** The two email settings from hq.settings values (missing or malformed -> the database defaults). */
export function readEmailSettings(byKey: ReadonlyMap<string, unknown>): { dailyLimit: number; chatSend: boolean } {
  return {
    dailyLimit: parseDailyLimit(byKey.get("email_daily_limit")) ?? DAILY_LIMIT_DEFAULT,
    chatSend: byKey.get("email_chat_send_enabled") === true,
  };
}

// ── failed sends ─────────────────────────────────────────────

/** The short codes a failed send is stored with (provider.ts produces them). */
export const SEND_ERROR_TEXT: Record<string, string> = {
  timeout: "The email service did not answer in time. The email may or may not have been delivered: check with the recipient before sending again.",
  network_error: "HQ could not reach the email service. Nothing was delivered.",
  provider_rejected: "The email service refused this email.",
  provider_auth: "The email service refused HQ's credentials. A director needs to check the email set-up.",
  provider_rate_limited: "The email service is busy (too many emails at once). Try again later.",
  provider_unavailable: "The email service had a problem. Try again later.",
  provider_error: "The email service had a problem sending this email.",
  not_configured: "Email sending is not set up on this server.",
};

export function sendErrorText(code: string | null | undefined): string {
  return (code && SEND_ERROR_TEXT[code]) || SEND_ERROR_TEXT.provider_error;
}

// ── database refusals, in words ──────────────────────────────

export type DbErrorLike = { code?: string | null; message?: string | null; hint?: string | null } | null | undefined;

/**
 * The email RPCs' own messages are plain English and name no addresses or record text (for example
 * "this email has not been approved: open it in HQ and tap Approve and send"). They are shown for
 * rule refusals; anything else becomes `generic`.
 */
export function emailDbMessage(error: DbErrorLike, generic: string): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").trim();
  const sentence = (m: string) => `${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
  if (code === "P0002" || code === "PGRST116") return "That email could not be found.";
  if (code === "42501") return error?.hint && message && message !== "permission denied" ? sentence(message) : "You don't have permission to do that.";
  if ((code === "22023" || code === "23514" || code === "54000") && message) return sentence(message);
  return generic;
}

// ── the list views ───────────────────────────────────────────

export const EMAIL_VIEWS = ["waiting", "sent", "other"] as const;
export type EmailView = (typeof EMAIL_VIEWS)[number];
export const EMAIL_VIEW_LABEL: Record<EmailView, string> = { waiting: "Drafts", sent: "Sent", other: "Not sent or discarded" };
export const EMAIL_VIEW_STATUSES: Record<EmailView, readonly EmailStatus[]> = {
  waiting: ["draft", "approved", "sending"],
  sent: ["sent"],
  other: ["failed", "discarded"],
};

export function parseEmailView(value: string | string[] | undefined): EmailView {
  const v = Array.isArray(value) ? value[0] : value;
  return (EMAIL_VIEWS as readonly string[]).includes(v ?? "") ? (v as EmailView) : "waiting";
}

/** True when a send began more than STUCK_SENDING_MINUTES ago and never finished. */
export function sendingIsStuck(status: EmailStatus, sendStartedAt: string | null, now: number = Date.now()): boolean {
  return status === "sending" && sendStartedAt !== null && now - Date.parse(sendStartedAt) > STUCK_SENDING_MINUTES * 60_000;
}
