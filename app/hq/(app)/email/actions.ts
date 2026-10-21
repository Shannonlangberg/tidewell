"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { COMMS_TAB_PATH } from "@/lib/hq/communications";
import { fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { parseDailyLimit, emailDbMessage, sendErrorText, validateEmailFields, validateNewRecipient } from "@/lib/hq/email/rules";
import { sendDraft } from "@/lib/hq/email/send";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for email. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff(capability) FIRST (email.draft to draft, edit and discard; email.send to
 *      approve and send; settings.admin for the settings), so a forged request from a role without it
 *      is redirected out before anything is read or written;
 *   2. takes identity from the session only (the database stamps who drafted, approved and sent);
 *   3. validates every input on the server; the recipient is an id of a contact or staff record, or (only
 *      for roles holding growth.write) one typed address and name, which the database adds to Contacts
 *      as needing a check before it drafts to that contact;
 *   4. writes ONLY through the hq email RPCs, which check the capability again, enforce the recipient
 *      rules, the status machine and the limits, and audit. Sending goes through sendDraft()
 *      (begin_email_send -> provider -> finish_email_send), so a double send is impossible.
 * People see plain messages; only error codes are logged (never an address or the message).
 */

// An email's own pages stay at /hq/email/<id>; the list is Communications > Emails.
const EMAIL = `${HQ_BASE}/email`;
const LIST = COMMS_TAB_PATH.emails;
const GENERIC = "Something went wrong and nothing was changed. Try again in a moment.";
const CHECK = "Please check the highlighted fields and try again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(LIST);
  revalidatePath(EMAIL);
  revalidatePath(HQ_BASE);
  if (id) revalidatePath(`${EMAIL}/${id}`);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

/** Only paths inside HQ are honoured as a place to come back to. */
function backTo(formData: FormData, fallback: string): string {
  const raw = formData.get("return_to");
  return typeof raw === "string" && /^\/hq(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_.%-]*)?$/.test(raw) && !raw.startsWith("//") ? raw : fallback;
}

const str = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

// ── draft ────────────────────────────────────────────────────

export async function createEmailDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, can } = await requireStaff("email.draft");
  const kind = str(formData, "recipient_kind");
  const recipient = idFrom(formData, "recipient_id");
  const v = validateEmailFields({ subject: str(formData, "subject"), body: str(formData, "body"), template: str(formData, "template") });
  const errors = { ...v.errors };
  let to: { p_contact?: string; p_staff?: string; p_to_email?: string; p_to_name?: string };
  if (kind === "new") {
    // someone HQ does not hold yet: a typed address and name, added to Contacts by the database
    if (!can("growth.write")) return withValues(fail("Your role can email people HQ already holds. Adding someone new to Contacts needs permission to edit contacts."), formData);
    const t = validateNewRecipient({ email: str(formData, "to_email"), name: str(formData, "to_name") });
    Object.assign(errors, t.errors);
    to = { p_to_email: t.values.email, p_to_name: t.values.name };
  } else {
    if (!recipient || (kind !== "contact" && kind !== "staff")) errors.recipient_id = "Choose who it is to.";
    to = kind === "contact" ? { p_contact: recipient ?? undefined } : { p_staff: recipient ?? undefined };
  }
  if (Object.keys(errors).length > 0) return withValues(fail(CHECK, errors), formData);

  const { data, error } = await db.rpc("create_email_draft", { p_template: v.values.template, p_subject: v.values.subject, p_body: v.values.body, ...to });
  const out = data as { draft_id?: string; ref?: string; new_contact?: boolean; to_name?: string } | null;
  if (error || !out?.draft_id) {
    logged("createEmailDraft", error);
    return withValues(fail(emailDbMessage(error, GENERIC)), formData);
  }
  refresh(out.draft_id);
  if (out.new_contact) revalidatePath(`${HQ_BASE}/growth/contacts`);
  const saved = `Draft ${out.ref ?? ""} saved. It is not sent until it is approved.`.replace(/\s+/g, " ");
  redirect(withToast(`${EMAIL}/${out.draft_id}`, out.new_contact ? `${saved} ${out.to_name ?? "They"} was added to Contacts, marked as needing a check.` : saved));
}

export async function updateEmailDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("email.draft");
  const id = idFrom(formData);
  if (!id) return fail("That email could not be found.");
  const v = validateEmailFields({ subject: str(formData, "subject"), body: str(formData, "body"), template: str(formData, "template") });
  if (Object.keys(v.errors).length > 0) return withValues(fail(CHECK, v.errors), formData);

  const { data, error } = await db.rpc("update_email_draft", { p_id: id, p_subject: v.values.subject, p_body: v.values.body, p_template: v.values.template });
  if (error) {
    logged("updateEmailDraft", error);
    return withValues(fail(emailDbMessage(error, GENERIC)), formData);
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(`${EMAIL}/${id}`, changed ? "Draft saved" : "Nothing changed", changed ? "success" : "info"));
}

export async function discardEmailDraftAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("email.draft");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIST, "That email could not be found.", "error"));
  const { error } = await db.rpc("discard_email_draft", { p_id: id, p_reason: "Discarded in HQ" });
  const back = backTo(formData, `${EMAIL}/${id}`);
  if (error) {
    logged("discardEmailDraft", error);
    redirect(withToast(back, emailDbMessage(error, GENERIC), "error"));
  }
  refresh(id);
  redirect(withToast(back, "Email discarded. It will not be sent."));
}

// ── approve and send ─────────────────────────────────────────

async function send(db: Awaited<ReturnType<typeof requireStaff>>["db"], id: string, back: string): Promise<never> {
  const r = await sendDraft(db, id, "hq");
  refresh(id);
  if (r.status === "sent") redirect(withToast(back, `Email ${r.ref} sent`));
  if (r.status === "sent_unrecorded") redirect(withToast(back, `Email ${r.ref} was sent, but HQ could not record it. Do not send it again.`, "info"));
  if (r.status === "failed") redirect(withToast(back, `Not sent. ${sendErrorText(r.code)}`, "error"));
  if (r.reason === "not_configured") redirect(withToast(back, "Not sent. Email sending is not set up on this server.", "error"));
  logged("sendDraft", r.error);
  redirect(withToast(back, `Not sent. ${emailDbMessage(r.error, GENERIC)}`, "error"));
}

/** Approve (as the person tapping) and send at once. The confirmation dialog named the recipient and address. */
export async function approveAndSendAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("email.send");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIST, "That email could not be found.", "error"));
  const back = backTo(formData, `${EMAIL}/${id}`);
  const { error } = await db.rpc("approve_email_draft", { p_id: id });
  if (error) {
    logged("approveEmailDraft", error);
    redirect(withToast(back, `Not approved. ${emailDbMessage(error, GENERIC)}`, "error"));
  }
  await send(db, id, back);
}

/** Send an email that is already approved (for example one held back by the daily limit). */
export async function sendApprovedAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("email.send");
  const id = idFrom(formData);
  if (!id) redirect(withToast(LIST, "That email could not be found.", "error"));
  await send(db, id, backTo(formData, `${EMAIL}/${id}`));
}

// ── settings (directors) ─────────────────────────────────────

export async function setEmailChatSendAction(enabled: boolean): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  if (typeof enabled !== "boolean") return fail("We could not change that setting.");
  const { data, error } = await db.from("settings").update({ value: enabled }).eq("key", "email_chat_send_enabled").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing email_chat_send_enabled failed:", error?.code);
    return fail("We could not change that setting. Try again in a moment.");
  }
  revalidatePath(`${HQ_BASE}/settings/ai`);
  return {
    ok: true,
    message: enabled
      ? "Chat sending is on: a chat app can send a draft it just made, after the person confirms the address."
      : "Chat sending is off: every email needs Approve and send in HQ.",
  };
}

export async function updateEmailDailyLimitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  const typed = str(formData, "dailyLimit").trim().slice(0, 12);
  const limit = parseDailyLimit(typed);
  if (limit === null) return { ...fail("Check the daily limit and try again.", { dailyLimit: "Enter a whole number from 1 to 200." }), data: { values: { dailyLimit: typed } } };
  const { data, error } = await db.from("settings").update({ value: limit }).eq("key", "email_daily_limit").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing email_daily_limit failed:", error?.code);
    return { ...fail("We could not save the daily limit. Try again in a moment."), data: { values: { dailyLimit: typed } } };
  }
  redirect(withToast(`${HQ_BASE}/settings/ai`, "Daily email limit saved."));
}
