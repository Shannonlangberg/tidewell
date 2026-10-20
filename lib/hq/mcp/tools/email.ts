/*
 * Branded email over MCP: draft an email to someone HQ holds an address for, list and open drafts,
 * change or discard a draft, and send an APPROVED one. Drafting needs email.draft; sending needs
 * email.send. Every query runs as the person (RLS) and every write goes through the hq email RPCs
 * (create_email_draft, update_email_draft, discard_email_draft, begin_email_send, finish_email_send),
 * which check the capability again, enforce the recipient rules, the status machine, the hourly draft
 * limit and the daily send limit, and write the audit trail.
 *
 * NOT possible through chat (deliberately): approving an email (a person taps Approve and send in HQ;
 * the database refuses an approval from a connected app), typing an address to send to, cc or bcc,
 * attachments, sending to several people, or sending an unapproved draft unless a director has
 * switched chat sending on (then only drafts this person made through this app in the last 30
 * minutes, after confirming the address).
 */
import { ROLE_LABEL, type StaffRole } from "../../constants";
import { getEmail, getEmailByRef, listEmails, loadEmailSettings, type EmailRow } from "../../email/queries";
import { renderText } from "../../email/render";
import {
  CHAT_SEND_WINDOW_MINUTES,
  EMAIL_STATUS_LABEL,
  EMAIL_TEMPLATE_LABEL,
  emailDbMessage,
  parseEmailRef,
  sendErrorText,
  validateEmailFields,
  type EmailStatus,
} from "../../email/rules";
import { sendDraft } from "../../email/send";
import { LIMITS, candidatesText, clean, compose, decideResolution, isUuid, result, rowLimit, type Candidate } from "./core";
import { can, dbFailure, defineTool, link, logDb, resolveContact, resolveStaff, respond, when, type ToolContext, type ToolResult } from "./kit";
import { discardEmailDraftShape, draftEmailShape, getEmailDraftShape, listEmailDraftsShape, sendEmailDraftShape, updateEmailDraftShape } from "./email-schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const path = (id: string) => `/hq/email/${id}`;
const roleLabel = (role: string) => (Object.hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role as StaffRole] : null);
const NOT_SENT = "Not sent. It needs approval: open it in HQ and tap Approve and send.";

const ECONOMY =
  "Use one call per step; do not call get_email_draft after draft_email (the result already holds the preview).";

// ── finding a draft ──────────────────────────────────────────

type Found = { ok: true; email: EmailRow } | { ok: false; result: ToolResult };

async function findDraft(ctx: ToolContext, input: string): Promise<Found> {
  const q = input.trim();
  const n = parseEmailRef(q);
  const tagged = /^email:([0-9a-f-]{36})$/i.exec(q);
  const id = tagged ? tagged[1] : isUuid(q) ? q : null;
  if (n === null && !id) {
    return { ok: false, result: result("invalid", `Not done: give the email's number (for example EML-0007) or its id. Use list_email_drafts to find it.`) };
  }
  const loaded = n !== null ? await getEmailByRef(ctx.db, n) : await getEmail(ctx.db, id!.toLowerCase());
  if (!loaded.ok) return { ok: false, result: result("error", "Something went wrong reading HQ, and nothing was changed. Try again in a moment.") };
  if (!loaded.data) return { ok: false, result: result("not_found", `No email "${clean(q, 40)}" that you can see was found in HQ. Nothing was changed.`) };
  return { ok: true, email: loaded.data };
}

function preview(ctx: ToolContext, e: { subject: string; body: string; senderName: string; senderRole: string | null }): string[] {
  const text = renderText({ subject: e.subject, body: e.body, senderName: e.senderName, senderRole: e.senderRole });
  return [`Subject: ${clean(e.subject)}`, "", ...clean(text, 9000, { multiline: true }).split("\n")];
}

function summaryLines(ctx: ToolContext, e: EmailRow): string[] {
  return [
    `${e.ref}: ${clean(e.subject)}`,
    `To: ${clean(e.toName)} <${clean(e.toEmail)}> (the address on their HQ record)`,
    `Status: ${EMAIL_STATUS_LABEL[e.status]}${e.status === "failed" && e.errorCode ? ` (${sendErrorText(e.errorCode)})` : ""}`,
    `Template: ${EMAIL_TEMPLATE_LABEL[e.template]}`,
    `Drafted ${when(ctx, e.createdAt)}${e.createdByName ? ` by ${clean(e.createdByName)}` : ""}${e.createdVia === "mcp" ? " through a connected app" : ""}`,
    e.approvedAt ? `Approved ${when(ctx, e.approvedAt)}${e.approvedByName ? ` by ${clean(e.approvedByName)}` : ""}` : null,
    e.sentAt ? `Sent ${when(ctx, e.sentAt)}${e.sendVia === "chat" ? " from a connected app" : ""}` : null,
    `Replies go to: ${clean(e.replyTo)}`,
  ].filter((l): l is string => !!l);
}

/** What to say about sending, for this person and this draft. */
async function sendHint(ctx: ToolContext, e: { status: EmailStatus; createdVia: "hq" | "mcp"; createdBy: string; createdAt: string }): Promise<string> {
  if (e.status === "approved") return can(ctx, "email.send") ? "It is approved: say if you want it sent now (send_email_draft), or tap Send in HQ." : "It is approved and will be sent from HQ.";
  if (e.status !== "draft") return "";
  if (!can(ctx, "email.send")) return `${NOT_SENT} Your role cannot approve emails, so ask a director, an administrator or a business development manager to approve it.`;
  const settings = await loadEmailSettings(ctx.db);
  const fresh = Date.now() - Date.parse(e.createdAt) < CHAT_SEND_WINDOW_MINUTES * 60_000;
  if (settings.ok && settings.data.chatSend && e.createdVia === "mcp" && e.createdBy === ctx.staff.id && fresh) {
    return `Not sent yet. Chat sending is switched on in HQ, so it can be sent from here within ${CHAT_SEND_WINDOW_MINUTES} minutes of drafting: show the person the recipient (name and address), the subject and the FULL email text, then ask "Send it?". When they say yes or send, call send_email_draft with confirm_recipient_email set to the exact address you showed: their yes is the confirmation, so do not make them retype the address or approve in HQ. If they ask for changes, use update_email_draft and show the new version first. Otherwise they can open it in HQ and tap Approve and send.`;
  }
  return NOT_SENT;
}

function rpcRefusal(where: string, error: { code?: string | null; message?: string | null; hint?: string | null } | null): ToolResult {
  const code = error?.code ?? "";
  if (["22023", "23514", "54000", "P0002"].includes(code) || (code === "42501" && error?.hint)) {
    logDb(where, error);
    const outcome = code === "P0002" ? "not_found" : code === "42501" ? "refused" : "invalid";
    return result(outcome, `Not done: ${emailDbMessage(error, "HQ refused that.")} Nothing was sent or changed.`, { code, hint: error?.hint ?? null });
  }
  return dbFailure(where, error);
}

// ── resolving the recipient (contact or staff, never an address) ──

type Recipient = { kind: "contact" | "staff"; id: string; name: string; email: string | null };

async function resolveRecipient(ctx: ToolContext, input: string, kind: "contact" | "staff" | "any"): Promise<{ ok: true; r: Recipient } | { ok: false; result: ToolResult }> {
  const q = input.trim();
  if (/@/.test(q)) {
    return { ok: false, result: result("invalid", "Not done: an email can only go to someone HQ already holds an address for. Give the person's name (a contact or a member of staff), not an address. To email someone new, add them as a contact in HQ first.") };
  }
  const tagged = /^(contact|staff):([0-9a-f-]{36})$/i.exec(q);
  const wantContact = (tagged ? tagged[1].toLowerCase() === "contact" : kind !== "staff") && can(ctx, "growth.read");
  const wantStaff = (tagged ? tagged[1].toLowerCase() === "staff" : kind !== "contact") && can(ctx, "people.read");
  const query = tagged ? tagged[2] : q;

  const [c, s] = await Promise.all([
    wantContact ? resolveContact(ctx, query, "write") : Promise.resolve(null),
    wantStaff ? resolveStaff(ctx, query, "write") : Promise.resolve(null),
  ]);
  const hits: Array<{ kind: "contact" | "staff"; record: Candidate }> = [];
  const cands: Candidate[] = [];
  for (const [k, res] of [["contact", c], ["staff", s]] as const) {
    if (!res) continue;
    if (res.ok) hits.push({ kind: k, record: res.record });
    else if (res.result.structured?.outcome === "ambiguous") {
      for (const x of (res.result.structured.candidates as Candidate[] | undefined) ?? []) cands.push({ id: `${k}:${x.id}`, label: x.label, detail: [k === "staff" ? "HQ staff" : "contact", x.detail].filter(Boolean).join(", ") });
    }
  }
  if (hits.length === 1 && cands.length === 0) {
    const h = hits[0];
    const email =
      h.kind === "contact"
        ? ((await ctx.db.from("contact_directory").select("email").eq("id", h.record.id).maybeSingle()).data?.email ?? null)
        : ((await ctx.db.from("staff_profiles").select("email").eq("id", h.record.id).maybeSingle()).data?.email ?? null);
    return { ok: true, r: { kind: h.kind, id: h.record.id, name: h.record.label, email } };
  }
  const all = [...hits.map((h) => ({ id: `${h.kind}:${h.record.id}`, label: h.record.label, detail: [h.kind === "staff" ? "HQ staff" : "contact", h.record.detail].filter(Boolean).join(", ") })), ...cands];
  if (all.length === 0) {
    const where = [wantContact ? "contacts" : null, wantStaff ? "active staff" : null].filter(Boolean).join(" or ") || "the records you can see";
    return { ok: false, result: result("not_found", `No one matching "${clean(q, 80)}" was found in ${where}. Nothing was drafted. Check the spelling, or search first.`) };
  }
  const r = decideResolution({ exact: [], close: all, mode: "write" });
  const t = r.kind === "many" ? candidatesText("person", q, r) : { head: `More than one person could be "${clean(q, 80)}".`, data: [] as string[] };
  return {
    ok: false,
    result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: all.slice(0, LIMITS.candidates).map((x) => ({ id: x.id, label: x.label, detail: x.detail ?? null })) }),
  };
}

// ── draft_email ──────────────────────────────────────────────

export const draftEmail = defineTool({
  name: "draft_email",
  title: "Draft an email",
  description:
    `Drafts ONE branded PLANTED. email to ONE person HQ already holds an email address for: a contact or a member of staff, found by name (several matches -> candidates, never a guess). It creates a DRAFT ONLY and sends nothing: the person approves it in HQ (Approve and send). The address always comes from the person's HQ record; there is no way to type an address, add cc or bcc, attach files or email several people. Write the body in plain text from what the person actually said: never invent promises, prices, fees, dates, times, figures or claims, and leave out any sign-off (HQ adds the signature and footer). Returns the EML number, a plain-text preview and the HQ link. ${ECONOMY}`,
  inputSchema: draftEmailShape,
  annotations: WRITE,
  capability: "email.draft",
  kind: "write",
  handler: async (args, ctx) => {
    const v = validateEmailFields({ subject: args.subject, body: args.body, template: args.template });
    if (Object.keys(v.errors).length > 0) return respond("invalid", `Not drafted: ${Object.values(v.errors).join(" ")}`);
    const who = await resolveRecipient(ctx, args.recipient, args.recipient_kind ?? "any");
    if (!who.ok) return who.result;
    const r = who.r;
    if (!r.email) {
      const where = r.kind === "contact" ? link(ctx, `/hq/growth/contacts/${r.id}`) : link(ctx, `/hq/people/${r.id}`);
      return respond("invalid", `Not drafted: there is no email address on record for ${clean(r.name)}. Add it to their record in HQ first (${where}); HQ only emails addresses it already holds.`);
    }
    const { data, error } = await ctx.db.rpc("create_email_draft", {
      p_template: v.values.template,
      p_subject: v.values.subject,
      p_body: v.values.body,
      p_contact: r.kind === "contact" ? r.id : undefined,
      p_staff: r.kind === "staff" ? r.id : undefined,
    });
    const out = data as { draft_id?: string; ref?: string; to_email?: string; created_at?: string } | null;
    if (error || !out?.draft_id) return rpcRefusal("create_email_draft", error);
    const url = link(ctx, path(out.draft_id));
    const hint = await sendHint(ctx, { status: "draft", createdVia: "mcp", createdBy: ctx.staff.id, createdAt: out.created_at ?? new Date().toISOString() });
    const lines = [
      `${out.ref}: draft to ${clean(r.name)} <${clean(out.to_email ?? r.email)}>`,
      ...preview(ctx, { subject: v.values.subject, body: v.values.body, senderName: ctx.staff.fullName, senderRole: roleLabel(ctx.staff.role) }),
    ];
    return respond("ok", `Drafted email ${out.ref} [id: ${out.draft_id}]: ${url}`, lines, { id: out.draft_id, ref: out.ref, url, status: "draft", sent: false }, hint);
  },
});

// ── list_email_drafts ────────────────────────────────────────

const LIST_STATUSES: Record<string, readonly EmailStatus[]> = {
  waiting: ["draft", "approved", "sending"],
  sent: ["sent"],
  not_sent: ["failed"],
  discarded: ["discarded"],
  all: ["draft", "approved", "sending", "sent", "failed", "discarded"],
};

export const listEmailDrafts = defineTool({
  name: "list_email_drafts",
  title: "List email drafts",
  description:
    "Lists emails drafted in HQ, newest first: EML number, recipient, subject, status and when, with HQ links. By default the ones waiting for approval; status sent, not_sent, discarded or all for others. You see your own emails (directors and administrators see everyone's). Use this to find a draft's number; open one with get_email_draft only when the person asks about it. Read-only.",
  inputSchema: listEmailDraftsShape,
  annotations: READ,
  capability: "email.draft",
  kind: "read",
  handler: async (args, ctx) => {
    const key = args.status ?? "waiting";
    const loaded = await listEmails(ctx.db, { statuses: LIST_STATUSES[key], limit: rowLimit(args.limit), page: 1 });
    if (!loaded.ok) return result("error", "Something went wrong reading HQ. Try again in a moment.");
    const { rows, total } = loaded.data;
    const scope = key === "waiting" ? "waiting for approval or sending" : key === "not_sent" ? "not sent (the send failed)" : key;
    if (rows.length === 0) return respond("empty", `No emails ${scope === "all" ? "" : `${scope} `}that you can see.`.replace("  ", " "), null, { count: 0 });
    const lines = rows.map(
      (e) => `- ${e.ref} to ${clean(e.toName)}: ${clean(e.subject)} · ${EMAIL_STATUS_LABEL[e.status]} · ${when(ctx, e.sentAt ?? e.updatedAt)}${e.createdByName && e.createdBy !== ctx.staff.id ? ` · by ${clean(e.createdByName)}` : ""} [id: ${e.id}] ${link(ctx, path(e.id))}`,
    );
    return respond("ok", `${total} email${total === 1 ? "" : "s"} (${scope}), newest first${total > rows.length ? `; showing ${rows.length}` : ""}. All emails: ${link(ctx, "/hq/communications/emails")}`, lines, { count: rows.length, total, ids: rows.map((e) => e.id) });
  },
});

// ── get_email_draft ──────────────────────────────────────────

export const getEmailDraft = defineTool({
  name: "get_email_draft",
  title: "Open an email draft",
  description:
    "Opens ONE email by its number (EML-0001) or id: recipient and the address on their record, status, who drafted and approved it, and the full plain-text preview exactly as it will be sent (signature and footer included), with the HQ link. You can open your own emails (directors and administrators: anyone's). Read-only.",
  inputSchema: getEmailDraftShape,
  annotations: READ,
  capability: "email.draft",
  kind: "read",
  handler: async (args, ctx) => {
    const found = await findDraft(ctx, args.draft);
    if (!found.ok) return found.result;
    const e = found.email;
    const senderRole =
      e.createdBy === ctx.staff.id ? roleLabel(ctx.staff.role) : roleLabel((await ctx.db.from("staff_profiles").select("role").eq("id", e.createdBy).maybeSingle()).data?.role ?? "");
    const url = link(ctx, path(e.id));
    const lines = [...summaryLines(ctx, e), "", ...preview(ctx, { subject: e.subject, body: e.body, senderName: e.createdByName ?? ctx.staff.fullName, senderRole })];
    return respond("ok", `Email ${e.ref} [id: ${e.id}]: ${url}`, lines, { id: e.id, ref: e.ref, url, status: e.status }, await sendHint(ctx, e));
  },
});

// ── update_email_draft ───────────────────────────────────────

export const updateEmailDraft = defineTool({
  name: "update_email_draft",
  title: "Change an email draft",
  description:
    "Changes the subject, message or template of ONE of your own drafts that is still waiting for approval (by EML number or id). The recipient cannot change: discard it and draft a new one. Same writing rules as draft_email: only what the person said, no invented promises, prices, dates or claims, no sign-off. Returns what changed and the new preview. Sends nothing.",
  inputSchema: updateEmailDraftShape,
  annotations: WRITE,
  capability: "email.draft",
  kind: "write",
  handler: async (args, ctx) => {
    if (args.subject === undefined && args.body === undefined && args.template === undefined) return respond("invalid", "Not changed: say what to change (subject, body or template).");
    const found = await findDraft(ctx, args.draft);
    if (!found.ok) return found.result;
    const cur = found.email;
    const v = validateEmailFields({ subject: args.subject ?? cur.subject, body: args.body ?? cur.body, template: args.template ?? cur.template });
    if (Object.keys(v.errors).length > 0) return respond("invalid", `Not changed: ${Object.values(v.errors).join(" ")}`);
    const { data, error } = await ctx.db.rpc("update_email_draft", {
      p_id: cur.id,
      p_subject: args.subject !== undefined ? v.values.subject : undefined,
      p_body: args.body !== undefined ? v.values.body : undefined,
      p_template: args.template ?? undefined,
    });
    if (error) return rpcRefusal("update_email_draft", error);
    const out = data as { changed?: boolean; changed_fields?: string[] } | null;
    const url = link(ctx, path(cur.id));
    if (out?.changed === false) return respond("unchanged", `Nothing to change: ${cur.ref} already says that. ${url}`);
    const fields = (out?.changed_fields ?? []).join(", ");
    const lines = [`${cur.ref} to ${clean(cur.toName)}: changed ${fields}`, "", ...preview(ctx, { subject: v.values.subject, body: v.values.body, senderName: ctx.staff.fullName, senderRole: roleLabel(ctx.staff.role) })];
    return respond("ok", `Updated email draft ${cur.ref} [id: ${cur.id}]: ${url}`, lines, { id: cur.id, ref: cur.ref, url, changed: out?.changed_fields ?? [] }, await sendHint(ctx, cur));
  },
});

// ── discard_email_draft ──────────────────────────────────────

export const discardEmailDraft = defineTool({
  name: "discard_email_draft",
  title: "Discard an email draft",
  description:
    "Discards ONE of your own emails that has not been sent (by EML number or id), so it can never be sent. It stays in HQ's record as discarded; nothing is deleted. Before calling, make sure the person wants it discarded.",
  inputSchema: discardEmailDraftShape,
  annotations: WRITE,
  capability: "email.draft",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await findDraft(ctx, args.draft);
    if (!found.ok) return found.result;
    const e = found.email;
    const { error } = await ctx.db.rpc("discard_email_draft", { p_id: e.id, p_reason: args.reason ?? undefined });
    if (error) return rpcRefusal("discard_email_draft", error);
    return respond("ok", `Discarded email ${e.ref} [id: ${e.id}]. It will not be sent. ${link(ctx, path(e.id))}`, [`${e.ref} to ${clean(e.toName)}: ${clean(e.subject)}`], { id: e.id, ref: e.ref, status: "discarded" });
  },
});

// ── send_email_draft ─────────────────────────────────────────

export const sendEmailDraft = defineTool({
  name: "send_email_draft",
  title: "Send an approved email",
  description:
    `Sends ONE email that has been APPROVED in HQ (by EML number or id), to the address on the recipient's HQ record, from HQ's own address with replies going to the person who drafted it. It refuses a draft that has not been approved: approval is a tap in HQ (Approve and send) and cannot be done from chat. The one exception: if a director has switched chat sending on, an unapproved draft that this person made through this app in the last ${CHAT_SEND_WINDOW_MINUTES} minutes may be sent, and only with confirm_recipient_email equal to the draft's address after the person confirmed it. It never retries: if a send fails, it must be approved again in HQ. Within the daily sending limit. Before calling, say exactly what will be sent and to whom, and make sure the person wants it sent now.`,
  inputSchema: sendEmailDraftShape,
  annotations: WRITE,
  capability: "email.send",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await findDraft(ctx, args.draft);
    if (!found.ok) return found.result;
    const e = found.email;
    const url = link(ctx, path(e.id));
    if (e.status === "sent") return respond("unchanged", `Not sent again: ${e.ref} was already sent${e.sentAt ? ` ${when(ctx, e.sentAt)}` : ""}. ${url}`);
    if (e.status === "sending") return respond("unchanged", `Not sent again: ${e.ref} is being sent right now. Check it in HQ in a minute. ${url}`);
    if (e.status === "discarded") return respond("invalid", `Not sent: ${e.ref} was discarded. Draft a new one.`);
    if (e.status === "failed") return respond("invalid", `Not sent: the last attempt to send ${e.ref} failed (${sendErrorText(e.errorCode)}). It must be approved again in HQ before it can be sent: ${url}`);
    if (e.status === "draft") {
      if (args.confirm_recipient_email === undefined) {
        return respond("refused", `Not sent: ${e.ref} has not been approved. ${NOT_SENT} ${url}`, [`To: ${clean(e.toName)} <${clean(e.toEmail)}>`]);
      }
      if (args.confirm_recipient_email.trim().toLowerCase() !== e.toEmail.trim().toLowerCase()) {
        return respond("refused", `Not sent: confirm_recipient_email does not match the address on the draft. Read the draft's address back to the person and ask them to confirm it. Nothing was sent.`, [`To: ${clean(e.toName)} <${clean(e.toEmail)}>`]);
      }
    }
    const r = await sendDraft(ctx.db, e.id, "chat");
    if (r.status === "refused") {
      if (r.reason === "not_configured") return result("error", "Not sent: email sending is not set up on this server. Nothing was sent.");
      return rpcRefusal("begin_email_send", r.error);
    }
    if (r.status === "failed") {
      return respond("error", `Not sent: ${sendErrorText(r.code)} ${r.ref} is marked "Not sent"; to try again it must be approved again in HQ. ${url}`, [`To: ${clean(r.toName)} <${clean(r.toEmail)}>`], { id: e.id, ref: r.ref, status: "failed", code: r.code, sent: false });
    }
    const lines = [
      `${r.ref}: ${clean(e.subject)}`,
      `To: ${clean(r.toName)} <${clean(r.toEmail)}>`,
      `From: ${clean(r.fromName)} <${clean(r.fromEmail)}>`,
      `Replies go to: ${clean(r.replyTo)}`,
    ];
    const head =
      r.status === "sent"
        ? `Sent email ${r.ref} [id: ${e.id}]: ${url}`
        : `Sent email ${r.ref}, but HQ could not record it; it shows as Sending in HQ. Do NOT send it again. ${url}`;
    return respond("ok", head, lines, { id: e.id, ref: r.ref, url, status: r.status === "sent" ? "sent" : "sending", sent: true, message_id: r.messageId }, e.recipientContactId ? "It is on the contact's timeline in HQ." : null);
  },
});
