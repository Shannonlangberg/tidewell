import type { HqClient, ViewRow } from "@/lib/hq/db";
import { isAckStatus, isEnquiryKind, isEnquiryStatus, type AckStatus, type EnquiryKindValue, type EnquiryStatus } from "./enquiry-rules";

/*
 * Reads for the website enquiry screens, the Today line and the MCP tools. Every query runs as the
 * person (their own session) against hq.enquiry_overview (security invoker), so row level security
 * decides: growth.read sees enquiries; anyone else sees none ("not found").
 *
 * Everything in an enquiry was typed by someone on the public internet. Callers render it as plain
 * text (React escapes it) and the MCP tools return it inside the labelled data block.
 */

export type EnquiryRow = {
  id: string;
  ref: string;
  refNumber: number;
  kind: EnquiryKindValue;
  status: EnquiryStatus;
  receivedAt: string;
  name: string;
  email: string;
  phone: string | null;
  suburb: string | null;
  message: string | null;
  details: unknown;
  sourcePage: string | null;
  opportunityId: string | null;
  leadRef: string | null;
  leadLive: boolean;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string | null;
  contactName: string | null;
  createdLead: boolean;
  createdContact: boolean;
  handledByName: string | null;
  handledAt: string | null;
  spamMarkedAt: string | null;
  statusNote: string | null;
  /** The automatic thank-you to the enquirer (0136). */
  ackStatus: AckStatus;
  ackAt: string | null;
  ackReason: string | null;
};

const COLUMNS =
  "id, ref, ref_number, kind, status, received_at, name, email, phone, suburb, message, details, source_page, opportunity_id, lead_ref, lead_live, owner_id, owner_name, contact_id, contact_name, created_lead, created_contact, handled_by_name, handled_at, spam_marked_at, status_note, auto_reply_status, auto_reply_at, auto_reply_reason";

type Raw = Pick<
  ViewRow<"enquiry_overview">,
  | "id" | "ref" | "ref_number" | "kind" | "status" | "received_at" | "name" | "email" | "phone" | "suburb" | "message" | "details" | "source_page"
  | "opportunity_id" | "lead_ref" | "lead_live" | "owner_id" | "owner_name" | "contact_id" | "contact_name" | "created_lead" | "created_contact"
  | "handled_by_name" | "handled_at" | "spam_marked_at" | "status_note" | "auto_reply_status" | "auto_reply_at" | "auto_reply_reason"
>;

function toRow(r: Raw): EnquiryRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !isEnquiryKind(r.kind) || !isEnquiryStatus(r.status) || !r.received_at || !r.name || !r.email) return null;
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    kind: r.kind,
    status: r.status,
    receivedAt: r.received_at,
    name: r.name,
    email: r.email,
    phone: r.phone,
    suburb: r.suburb,
    message: r.message,
    details: r.details,
    sourcePage: r.source_page,
    opportunityId: r.opportunity_id,
    leadRef: r.lead_ref,
    leadLive: r.lead_live === true,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    contactId: r.contact_id,
    contactName: r.contact_name,
    createdLead: r.created_lead === true,
    createdContact: r.created_contact === true,
    handledByName: r.handled_by_name,
    handledAt: r.handled_at,
    spamMarkedAt: r.spam_marked_at,
    statusNote: r.status_note,
    ackStatus: isAckStatus(r.auto_reply_status) ? r.auto_reply_status : "none",
    ackAt: r.auto_reply_at,
    ackReason: r.auto_reply_reason,
  };
}

type Loaded<T> = { ok: true; data: T } | { ok: false };

export const ENQUIRY_PAGE_SIZE = 25;

export type EnquiryListQuery = {
  status?: EnquiryStatus | null;
  kind?: EnquiryKindValue | null;
  /** ISO timestamp or YYYY-MM-DD: received on or after. */
  since?: string | null;
  page?: number;
  limit?: number;
};

export async function listEnquiries(db: HqClient, q: EnquiryListQuery): Promise<Loaded<{ rows: EnquiryRow[]; total: number }>> {
  const limit = Math.max(1, Math.min(q.limit ?? ENQUIRY_PAGE_SIZE, 100));
  const page = Math.max(1, q.page ?? 1);
  let query = db.from("enquiry_overview").select(COLUMNS, { count: "exact" });
  if (q.status) query = query.eq("status", q.status);
  if (q.kind) query = query.eq("kind", q.kind);
  if (q.since) query = query.gte("received_at", q.since);
  const { data, error, count } = await query
    .order("received_at", { ascending: false })
    .order("ref_number", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (error) {
    console.error("[hq] listEnquiries failed:", error.code);
    return { ok: false };
  }
  const rows = ((data ?? []) as Raw[]).map(toRow).filter((r): r is EnquiryRow => r !== null);
  return { ok: true, data: { rows, total: count ?? rows.length } };
}

/** One enquiry by id, or null when it does not exist or the person may not see it. */
export async function getEnquiry(db: HqClient, id: string): Promise<Loaded<EnquiryRow | null>> {
  const { data, error } = await db.from("enquiry_overview").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getEnquiry failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data ? toRow(data as Raw) : null };
}

/** One enquiry by its ENQ number. */
export async function getEnquiryByNumber(db: HqClient, n: number): Promise<Loaded<EnquiryRow | null>> {
  const { data, error } = await db.from("enquiry_overview").select(COLUMNS).eq("ref_number", n).maybeSingle();
  if (error) {
    console.error("[hq] getEnquiryByNumber failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data ? toRow(data as Raw) : null };
}

/** How many enquiries are still New and not handled by anyone: one head-only count (no rows come back). Used by Today and the Communications badge. */
export async function countNewEnquiries(db: HqClient): Promise<Loaded<number>> {
  const { count, error } = await db.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new").is("handled_at", null);
  if (error) {
    console.error("[hq] countNewEnquiries failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: count ?? 0 };
}

export type LeadEnquiry = {
  id: string;
  ref: string;
  receivedAt: string;
  ackStatus: AckStatus;
  ackAt: string | null;
  ackReason: string | null;
  /** The enquiry's message on the lead's timeline, and the thank-you's entry (sent only). */
  interactionId: string | null;
  ackInteractionId: string | null;
};

/** The enquiries that created or joined a lead (newest first), with their thank-you, for the lead's page. */
export async function enquiriesForLead(db: HqClient, opportunityId: string): Promise<Loaded<LeadEnquiry[]>> {
  const { data, error } = await db
    .from("enquiry_overview")
    .select("id, ref, received_at, auto_reply_status, auto_reply_at, auto_reply_reason, interaction_id, auto_reply_interaction_id")
    .eq("opportunity_id", opportunityId)
    .order("received_at", { ascending: false })
    .limit(10);
  if (error) {
    console.error("[hq] enquiriesForLead failed:", error.code);
    return { ok: false };
  }
  const rows: LeadEnquiry[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.ref || !r.received_at) continue;
    rows.push({
      id: r.id,
      ref: r.ref,
      receivedAt: r.received_at,
      ackStatus: isAckStatus(r.auto_reply_status) ? r.auto_reply_status : "none",
      ackAt: r.auto_reply_at,
      ackReason: r.auto_reply_reason,
      interactionId: r.interaction_id,
      ackInteractionId: r.auto_reply_interaction_id,
    });
  }
  return { ok: true, data: rows };
}
