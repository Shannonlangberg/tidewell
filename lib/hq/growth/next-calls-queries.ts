/*
 * Reads for "Your next calls" (lib/hq/growth/next-calls.ts), shared by Today's Grow workspace and the chat
 * tools (next_calls, who_to_contact, daily_brief), so the screen and the chat recommend the same people for
 * the same reasons. Every query runs as the signed-in person: row level security decides what comes back
 * (growth.read). Only records the person owns are ranked; partner contacts with no owner are counted.
 * No "server-only" import: the MCP smoke script loads this under plain Node.
 */

import type { HqClient } from "../db";
import type { CallOutcome, InteractionType, OpportunityStage, Priority, RelationshipStatus } from "../constants";
import { todayIn } from "../format";
import { nextCalls, type CallContact, type CallLead, type LastTouch, type NextCallsResult } from "./next-calls";

type Db = HqClient;
// The views are typed loosely here on purpose: only the columns named below are used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const from = (db: Db, rel: string) => (db as any).from(rel);
const s = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const logErr = (where: string, e: { code?: string } | null | undefined) => console.error(`[hq] next calls ${where} failed:`, e?.code ?? "unknown");

export type Loaded<T> = { ok: true; data: T } | { ok: false };

export type NextCallsData = NextCallsResult & {
  /** Partner contacts (not inactive) with no relationship owner: not ranked, only counted. */
  unowned: number;
};

/** A timestamp as the local calendar date in `timezone`. */
function localDate(ts: string | null, timezone: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : todayIn(timezone, d);
}

const CHUNK = 150;
function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/**
 * Everyone the person should call next, in order, with the reason. `today` is the business day (hq.today());
 * `timezone` turns last-contact moments into days.
 */
export async function loadNextCalls(db: Db, opts: { staffId: string; today: string; timezone: string }): Promise<Loaded<NextCallsData>> {
  const { staffId, today, timezone } = opts;
  const [contactsQ, leadsQ, enquiriesQ, unownedQ] = await Promise.all([
    from(db, "contact_directory")
      .select("id, full_name, organisation_name, phone, contact_kind, relationship_status, priority, last_contact_at, next_follow_up_date, created_at")
      .eq("relationship_owner_id", staffId)
      .or("relationship_status.is.null,relationship_status.neq.inactive")
      .limit(3000),
    from(db, "opportunity_overview")
      .select("id, ref, prospect_name, prospect_phone, property_suburb, stage, next_action, next_action_due, last_activity_at, created_at, owner_contact_id")
      .eq("assigned_to", staffId)
      .eq("is_open", true)
      .limit(2000),
    from(db, "enquiry_overview").select("ref, opportunity_id").eq("status", "new").is("handled_at", null).not("opportunity_id", "is", null).limit(500),
    from(db, "contact_directory")
      .select("id", { count: "exact", head: true })
      .is("relationship_owner_id", null)
      .eq("contact_kind", "partner")
      .or("relationship_status.is.null,relationship_status.neq.inactive"),
  ]);
  const bad = [contactsQ, leadsQ, enquiriesQ, unownedQ].find((r) => r.error);
  if (bad) {
    logErr("load", bad.error);
    return { ok: false };
  }

  const enquiryRef = new Map<string, string>();
  for (const e of (enquiriesQ.data ?? []) as Record<string, unknown>[]) {
    const opp = s(e.opportunity_id);
    const ref = s(e.ref);
    if (opp && ref && !enquiryRef.has(opp)) enquiryRef.set(opp, ref);
  }

  const contacts: CallContact[] = ((contactsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    name: s(r.full_name) ?? "Unnamed contact",
    organisation: s(r.organisation_name),
    phone: s(r.phone),
    kind: (s(r.contact_kind) as CallContact["kind"]) ?? null,
    status: s(r.relationship_status) as RelationshipStatus | null,
    priority: s(r.priority) as Priority | null,
    lastContact: localDate(s(r.last_contact_at), timezone),
    nextFollowUp: s(r.next_follow_up_date),
    added: localDate(s(r.created_at), timezone) ?? today,
  }));
  const leads: CallLead[] = ((leadsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    ref: s(r.ref),
    name: s(r.prospect_name) ?? "Unnamed lead",
    phone: s(r.prospect_phone),
    suburb: s(r.property_suburb),
    stage: r.stage as OpportunityStage,
    nextAction: s(r.next_action),
    nextActionDue: s(r.next_action_due),
    lastActivity: localDate(s(r.last_activity_at), timezone),
    added: localDate(s(r.created_at), timezone) ?? today,
    contactId: s(r.owner_contact_id),
    newEnquiryRef: enquiryRef.get(r.id as string) ?? null,
  }));

  // The latest interaction per person: on a lead (opportunity_id) or with a contact (any).
  const lastTouch: Record<string, LastTouch> = {};
  const cols = "contact_id, opportunity_id, interaction_type, occurred_at, outcome, callback_promised, follow_up_date, next_action";
  const take = (rows: Record<string, unknown>[], keyOf: (r: Record<string, unknown>) => string | null) => {
    for (const r of rows) {
      const key = keyOf(r);
      if (!key || lastTouch[key]) continue;
      lastTouch[key] = {
        date: localDate(s(r.occurred_at), timezone) ?? today,
        type: r.interaction_type as InteractionType,
        outcome: s(r.outcome) as CallOutcome | null,
        callbackPromised: r.callback_promised === true,
        followUpDate: s(r.follow_up_date),
        nextAction: s(r.next_action),
      };
    }
  };
  const reads: Promise<boolean>[] = [];
  for (const ids of chunks(leads.map((l) => l.id))) {
    reads.push(
      from(db, "interactions").select(cols).is("deleted_at", null).in("opportunity_id", ids).order("occurred_at", { ascending: false }).limit(2000)
        .then((r: { data: Record<string, unknown>[] | null; error: { code?: string } | null }) => {
          if (r.error) return logErr("lead touches", r.error), false;
          take(r.data ?? [], (x) => (s(x.opportunity_id) ? `lead:${x.opportunity_id}` : null));
          return true;
        }),
    );
  }
  for (const ids of chunks(contacts.map((c) => c.id))) {
    reads.push(
      from(db, "interactions").select(cols).is("deleted_at", null).in("contact_id", ids).order("occurred_at", { ascending: false }).limit(3000)
        .then((r: { data: Record<string, unknown>[] | null; error: { code?: string } | null }) => {
          if (r.error) return logErr("contact touches", r.error), false;
          take(r.data ?? [], (x) => (s(x.contact_id) ? `contact:${x.contact_id}` : null));
          return true;
        }),
    );
  }
  if ((await Promise.all(reads)).some((ok) => !ok)) return { ok: false };

  return { ok: true, data: { ...nextCalls({ today, contacts, leads, lastTouch }), unowned: unownedQ.count ?? 0 } };
}
