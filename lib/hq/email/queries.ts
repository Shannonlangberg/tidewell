import type { HqClient } from "@/lib/hq/db";
import { EMAIL_VIEW_STATUSES, emailRef, isEmailStatus, isEmailTemplate, readEmailSettings, type EmailStatus, type EmailTemplate, type EmailView } from "./rules";

/*
 * Reads for the email screens, the Today card and the MCP tools. Every query runs as the person
 * (their own session): row level security returns their own emails, or everyone's for audit.read
 * holders (directors, administrators). A draft the person may not see is "not found".
 */

export type EmailRow = {
  id: string;
  ref: string;
  status: EmailStatus;
  template: EmailTemplate;
  toName: string;
  toEmail: string;
  recipientContactId: string | null;
  recipientStaffId: string | null;
  subject: string;
  body: string;
  replyTo: string;
  createdBy: string;
  createdByName: string | null;
  createdVia: "hq" | "mcp";
  createdAt: string;
  updatedAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sendStartedAt: string | null;
  sentBy: string | null;
  sendVia: "hq" | "chat" | null;
  sentAt: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  interactionId: string | null;
  discardedAt: string | null;
};

export const EMAIL_COLUMNS =
  "id, ref_number, status, template, to_name, to_email, recipient_contact_id, recipient_staff_id, subject, body_text, reply_to_email, created_by, created_via, created_at, updated_at, approved_by, approved_at, send_started_at, sent_by, send_via, sent_at, provider_message_id, error_code, interaction_id, discarded_at";

type Raw = {
  id: string;
  ref_number: number;
  status: string;
  template: string;
  to_name: string;
  to_email: string;
  recipient_contact_id: string | null;
  recipient_staff_id: string | null;
  subject: string;
  body_text: string;
  reply_to_email: string;
  created_by: string;
  created_via: string;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  send_started_at: string | null;
  sent_by: string | null;
  send_via: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  error_code: string | null;
  interaction_id: string | null;
  discarded_at: string | null;
};

export function toEmailRow(r: Raw, names: ReadonlyMap<string, string> = new Map()): EmailRow | null {
  if (!isEmailStatus(r.status)) return null;
  return {
    id: r.id,
    ref: emailRef(r.ref_number),
    status: r.status,
    template: isEmailTemplate(r.template) ? r.template : "general",
    toName: r.to_name,
    toEmail: r.to_email,
    recipientContactId: r.recipient_contact_id,
    recipientStaffId: r.recipient_staff_id,
    subject: r.subject,
    body: r.body_text,
    replyTo: r.reply_to_email,
    createdBy: r.created_by,
    createdByName: names.get(r.created_by) ?? null,
    createdVia: r.created_via === "mcp" ? "mcp" : "hq",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    approvedBy: r.approved_by,
    approvedByName: r.approved_by ? (names.get(r.approved_by) ?? null) : null,
    approvedAt: r.approved_at,
    sendStartedAt: r.send_started_at,
    sentBy: r.sent_by,
    sendVia: r.send_via === "chat" ? "chat" : r.send_via === "hq" ? "hq" : null,
    sentAt: r.sent_at,
    providerMessageId: r.provider_message_id,
    errorCode: r.error_code,
    interactionId: r.interaction_id,
    discardedAt: r.discarded_at,
  };
}

type Loaded<T> = { ok: true; data: T } | { ok: false };

async function staffNames(db: HqClient, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("staff_profiles").select("id, full_name").in("id", unique);
  if (error) console.error("[hq] email staff names failed:", error.code);
  return new Map((data ?? []).map((s) => [s.id, s.full_name]));
}

export const EMAIL_PAGE_SIZE = 25;

export async function listEmails(
  db: HqClient,
  opts: { view?: EmailView; statuses?: readonly EmailStatus[]; mine?: string | null; page?: number; limit?: number; query?: string | null },
): Promise<Loaded<{ rows: EmailRow[]; total: number }>> {
  const limit = opts.limit ?? EMAIL_PAGE_SIZE;
  const from = ((opts.page ?? 1) - 1) * limit;
  const statuses = opts.statuses ?? EMAIL_VIEW_STATUSES[opts.view ?? "waiting"];
  let q = db.from("email_drafts").select(EMAIL_COLUMNS, { count: "exact" }).in("status", [...statuses]);
  if (opts.mine) q = q.eq("created_by", opts.mine);
  const term = (opts.query ?? "").replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (term) q = q.or(`to_name.ilike.*${term}*,subject.ilike.*${term}*`);
  const { data, error, count } = await q.order("updated_at", { ascending: false }).order("ref_number", { ascending: false }).range(from, from + limit - 1);
  if (error) {
    console.error("[hq] listing emails failed:", error.code);
    return { ok: false };
  }
  const raw = (data ?? []) as Raw[];
  const names = await staffNames(db, raw.flatMap((r) => [r.created_by, r.approved_by]));
  return { ok: true, data: { rows: raw.map((r) => toEmailRow(r, names)).filter((r): r is EmailRow => r !== null), total: count ?? raw.length } };
}

/** Counts per list view, for the tabs. */
export async function emailViewCounts(db: HqClient): Promise<Record<EmailView, number | null>> {
  const views = Object.keys(EMAIL_VIEW_STATUSES) as EmailView[];
  const counts = await Promise.all(
    views.map(async (v) => {
      const { count, error } = await db.from("email_drafts").select("id", { count: "exact", head: true }).in("status", [...EMAIL_VIEW_STATUSES[v]]);
      return error ? null : (count ?? 0);
    }),
  );
  return Object.fromEntries(views.map((v, i) => [v, counts[i]])) as Record<EmailView, number | null>;
}

export async function getEmail(db: HqClient, id: string): Promise<Loaded<EmailRow | null>> {
  const { data, error } = await db.from("email_drafts").select(EMAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] loading an email failed:", error.code);
    return { ok: false };
  }
  if (!data) return { ok: true, data: null };
  const raw = data as Raw;
  const names = await staffNames(db, [raw.created_by, raw.approved_by]);
  return { ok: true, data: toEmailRow(raw, names) };
}

export async function getEmailByRef(db: HqClient, n: number): Promise<Loaded<EmailRow | null>> {
  const { data, error } = await db.from("email_drafts").select("id").eq("ref_number", n).maybeSingle();
  if (error) {
    console.error("[hq] loading an email by number failed:", error.code);
    return { ok: false };
  }
  return data ? getEmail(db, data.id) : { ok: true, data: null };
}

export async function loadEmailSettings(db: HqClient): Promise<Loaded<{ dailyLimit: number; chatSend: boolean }>> {
  const { data, error } = await db.from("settings").select("key, value").in("key", ["email_daily_limit", "email_chat_send_enabled"]);
  if (error) {
    console.error("[hq] reading the email settings failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: readEmailSettings(new Map((data ?? []).map((s) => [s.key, s.value]))) };
}

export type RecipientOption = { kind: "contact" | "staff"; id: string; name: string; email: string; detail: string | null };

/** People HQ holds an address for, matching the words typed (contacts with growth.read; active staff). */
export async function searchRecipients(db: HqClient, query: string, opts: { contacts: boolean; staff: boolean; limit?: number }): Promise<RecipientOption[]> {
  const term = query.replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2) return [];
  const limit = opts.limit ?? 12;
  const [contacts, staff] = await Promise.all([
    opts.contacts
      ? db.from("contact_directory").select("id, full_name, email, organisation_name, position").not("email", "is", null).or(`full_name.ilike.*${term}*,email.ilike.*${term}*,organisation_name.ilike.*${term}*`).order("full_name").limit(limit)
      : Promise.resolve({ data: [], error: null }),
    opts.staff
      ? db.from("staff_profiles").select("id, full_name, email, role").eq("is_active", true).eq("employment_status", "active").ilike("full_name", `%${term}%`).order("full_name").limit(limit)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contacts.error) console.error("[hq] recipient search (contacts) failed:", contacts.error.code);
  if (staff.error) console.error("[hq] recipient search (staff) failed:", staff.error.code);
  const out: RecipientOption[] = [];
  for (const c of (contacts.data ?? []) as Array<{ id: string | null; full_name: string | null; email: string | null; organisation_name: string | null; position: string | null }>) {
    if (c.id && c.full_name && c.email) out.push({ kind: "contact", id: c.id, name: c.full_name, email: c.email, detail: [c.position, c.organisation_name].filter(Boolean).join(", ") || null });
  }
  for (const s of (staff.data ?? []) as Array<{ id: string; full_name: string; email: string; role: string }>) {
    out.push({ kind: "staff", id: s.id, name: s.full_name, email: s.email, detail: "HQ staff" });
  }
  return out;
}

/** One recipient by id, as the compose form shows it (null when not found or not visible). */
export async function recipientById(db: HqClient, kind: "contact" | "staff", id: string): Promise<RecipientOption | null> {
  if (kind === "contact") {
    const { data } = await db.from("contact_directory").select("id, full_name, email, organisation_name, position").eq("id", id).maybeSingle();
    if (!data?.id || !data.full_name) return null;
    return { kind, id: data.id, name: data.full_name, email: data.email ?? "", detail: [data.position, data.organisation_name].filter(Boolean).join(", ") || null };
  }
  const { data } = await db.from("staff_profiles").select("id, full_name, email").eq("id", id).eq("is_active", true).eq("employment_status", "active").maybeSingle();
  return data ? { kind, id: data.id, name: data.full_name, email: data.email, detail: "HQ staff" } : null;
}
