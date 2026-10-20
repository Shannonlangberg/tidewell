import "server-only";

import { OPEN_TASK_STATUSES, type InteractionType, type TaskStatus } from "../constants";
import type { HqClient, ViewRow } from "../db";
import { listInteractions } from "../contacts/queries";
import { logTag } from "../growth/db-errors";
import type { InteractionItem, Loaded } from "../growth/types";
import type { Stage, StageHistoryItem } from "../referrals/types";
import type { ContactKind, LeadSource, LostReason } from "./rules";

/*
 * Reads for a lead's page, Today and a landlord's contact page. Everything runs as the signed-in
 * person (the `db` from requireStaff): row level security decides what comes back, so a person
 * without growth.read reads nothing. A failed read is logged by code only.
 */

export type Lead = {
  id: string;
  ref: string;
  displayNumber: number;
  prospectName: string;
  prospectPhone: string | null;
  prospectEmail: string | null;
  propertySuburb: string | null;
  propertyAddress: string | null;
  stage: Stage;
  stageChangedAt: string;
  daysInStage: number;
  open: boolean;
  source: LeadSource;
  assignedTo: string | null;
  assignedToName: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  nextActionOverdue: boolean;
  needsAttention: boolean;
  expectedCloseDate: string | null;
  estimateCents: number | null;
  lastActivityAt: string | null;
  ownerContactId: string | null;
  ownerContactName: string | null;
  signedAt: string | null;
  managementReference: string | null;
  lostReason: string | null;
  lostReasonCode: LostReason | null;
  notes: string | null;
  creditedReferralId: string | null;
  creditedRefLabel: string | null;
  partnerOrganisationId: string | null;
  partnerOrganisationName: string | null;
  partnerContactId: string | null;
  partnerContactName: string | null;
  otherClaims: number;
  updatedAt: string | null;
};

export function toLead(r: ViewRow<"opportunity_overview">): Lead | null {
  if (!r.id || !r.ref || !r.prospect_name || !r.stage || !r.stage_changed_at || r.display_number === null) return null;
  return {
    id: r.id,
    ref: r.ref,
    displayNumber: Number(r.display_number),
    prospectName: r.prospect_name,
    prospectPhone: r.prospect_phone,
    prospectEmail: r.prospect_email,
    propertySuburb: r.property_suburb,
    propertyAddress: r.property_address,
    stage: r.stage,
    stageChangedAt: r.stage_changed_at,
    daysInStage: Number(r.days_in_stage ?? 0),
    open: r.is_open ?? true,
    source: (r.source ?? "other") as LeadSource,
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to_name,
    nextAction: r.next_action,
    nextActionDue: r.next_action_due,
    nextActionOverdue: r.next_action_overdue ?? false,
    needsAttention: r.needs_attention ?? false,
    expectedCloseDate: r.expected_close_date,
    estimateCents: r.estimated_annual_value_cents === null ? null : Number(r.estimated_annual_value_cents),
    lastActivityAt: r.last_activity_at,
    ownerContactId: r.owner_contact_id,
    ownerContactName: r.owner_contact_name,
    signedAt: r.signed_at,
    managementReference: r.management_reference,
    lostReason: r.lost_reason,
    lostReasonCode: r.lost_reason_code as LostReason | null,
    notes: r.notes,
    creditedReferralId: r.credited_referral_id,
    creditedRefLabel: r.credited_ref_label,
    partnerOrganisationId: r.partner_organisation_id,
    partnerOrganisationName: r.partner_organisation_name,
    partnerContactId: r.partner_contact_id,
    partnerContactName: r.partner_contact_name,
    otherClaims: Number(r.other_claims ?? 0),
    updatedAt: r.updated_at,
  };
}

export async function getLead(db: HqClient, id: string): Promise<Loaded<Lead | null>> {
  const { data, error } = await db.from("opportunity_overview").select("*").eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getLead failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: data ? toLead(data) : null };
}

export type LeadContact = { id: string; fullName: string; kind: ContactKind; phone: string | null; email: string | null; needsVerification: boolean };

export type LeadTask = { id: string; title: string; dueDate: string | null; status: TaskStatus; assigneeName: string | null; completedAt: string | null };

/** One entry of a lead's activity timeline: a logged interaction, a stage change, or a task. */
export type LeadEvent =
  | { kind: "interaction"; at: string; item: InteractionItem }
  | { kind: "stage"; at: string; item: StageHistoryItem }
  | { kind: "task"; at: string; item: LeadTask };

export type LeadBundle = {
  contact: LeadContact | null;
  timeline: Loaded<LeadEvent[]>;
  openTasks: LeadTask[];
};

/**
 * The secondary parts of a lead's page: its landlord contact, and one timeline of the calls and
 * notes logged on it, its stage history and its tasks (newest first). Each part degrades quietly.
 */
export async function loadLeadBundle(db: HqClient, lead: Lead): Promise<LeadBundle> {
  const [contactRes, interactions, history, tasks, names] = await Promise.all([
    lead.ownerContactId
      ? db.from("contact_directory").select("id, full_name, contact_kind, phone, email, needs_verification").eq("id", lead.ownerContactId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    listInteractions(db, { opportunityId: lead.id }, 50),
    db.from("opportunity_stage_history").select("id, from_stage, to_stage, changed_by, changed_at, note").eq("opportunity_id", lead.id).order("changed_at", { ascending: false }).limit(50),
    db
      .from("tasks")
      .select("id, title, due_date, status, completed_at, created_at, assignee:staff_profiles(full_name)")
      .eq("related_opportunity_id", lead.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("staff_profiles").select("id, full_name"),
  ]);
  if (contactRes.error) console.error("[hq] lead contact failed:", logTag(contactRes.error));
  if (history.error) console.error("[hq] lead history failed:", logTag(history.error));
  if (tasks.error) console.error("[hq] lead tasks failed:", logTag(tasks.error));

  const c = contactRes.data;
  const contact: LeadContact | null =
    c && c.id && c.full_name
      ? { id: c.id, fullName: c.full_name, kind: (c.contact_kind ?? "partner") as ContactKind, phone: c.phone, email: c.email, needsVerification: c.needs_verification ?? false }
      : null;

  const staffName = new Map((names.data ?? []).map((s) => [s.id, s.full_name]));
  type TaskRow = { id: string; title: string; due_date: string | null; status: TaskStatus; completed_at: string | null; created_at: string; assignee: { full_name: string } | null };
  const taskRows = (tasks.data ?? []) as unknown as TaskRow[];
  const leadTasks = taskRows.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, status: t.status, assigneeName: t.assignee?.full_name ?? null, completedAt: t.completed_at, createdAt: t.created_at }));

  let timeline: Loaded<LeadEvent[]>;
  if (!interactions.ok || history.error || tasks.error) {
    timeline = { ok: false };
  } else {
    const events: LeadEvent[] = [
      ...interactions.data.items.map((i) => ({ kind: "interaction" as const, at: i.occurredAt, item: i })),
      ...(history.data ?? []).map((h) => ({
        kind: "stage" as const,
        at: h.changed_at,
        item: { id: Number(h.id), fromStage: h.from_stage, toStage: h.to_stage, changedAt: h.changed_at, changedByName: h.changed_by ? (staffName.get(h.changed_by) ?? null) : null, note: h.note },
      })),
      ...leadTasks.map((t) => ({ kind: "task" as const, at: t.createdAt, item: t })),
    ];
    events.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
    timeline = { ok: true, data: events };
  }

  const open = new Set<string>(OPEN_TASK_STATUSES);
  return { contact, timeline, openTasks: leadTasks.filter((t) => open.has(t.status)) };
}

// ── Today ────────────────────────────────────────────────────

export type LeadFollowUp = {
  id: string;
  ref: string;
  name: string;
  suburb: string | null;
  phone: string | null;
  nextAction: string | null;
  dueDate: string;
};

/**
 * Lead follow-ups due today or earlier, oldest first: the person's own leads, or (mine: false)
 * everyone's. Open leads only.
 */
export async function loadLeadFollowUps(db: HqClient, ctx: { today: string; staffId: string; mine: boolean }, limit = 8): Promise<{ items: LeadFollowUp[]; total: number }> {
  let q = db
    .from("opportunity_overview")
    .select("id, ref, prospect_name, property_suburb, prospect_phone, next_action, next_action_due", { count: "exact" })
    .eq("is_open", true)
    .not("next_action_due", "is", null)
    .lte("next_action_due", ctx.today);
  if (ctx.mine) q = q.eq("assigned_to", ctx.staffId);
  const { data, error, count } = await q.order("next_action_due", { ascending: true }).order("prospect_name").limit(limit);
  if (error) throw new Error(`lead follow-ups ${error.code}`);
  const items: LeadFollowUp[] = [];
  for (const r of data ?? []) {
    if (!r.id || !r.ref || !r.prospect_name || !r.next_action_due) continue;
    items.push({ id: r.id, ref: r.ref, name: r.prospect_name, suburb: r.property_suburb, phone: r.prospect_phone, nextAction: r.next_action, dueDate: r.next_action_due });
  }
  return { items, total: count ?? items.length };
}

export type LeadAttention = { noOwner: number; noNextStep: number; overdue: number; total: number };

/** Open leads needing attention, by reason (hq.overdue_opportunities). An owner who has left counts as no owner. */
export async function loadLeadAttention(db: HqClient): Promise<LeadAttention> {
  const { data, error } = await db.from("overdue_opportunities").select("reason").limit(2000);
  if (error) throw new Error(`lead attention ${error.code}`);
  const out: LeadAttention = { noOwner: 0, noNextStep: 0, overdue: 0, total: 0 };
  for (const r of data ?? []) {
    out.total += 1;
    if (r.reason === "no_owner" || r.reason === "owner_inactive") out.noOwner += 1;
    else if (r.reason === "no_next_action") out.noNextStep += 1;
    else out.overdue += 1;
  }
  return out;
}

// ── a landlord's contact page ────────────────────────────────

export type ContactLead = { id: string; ref: string; stage: Stage; suburb: string | null; nextAction: string | null; nextActionDue: string | null; open: boolean };

/** The leads a contact is the landlord or owner on. */
export async function leadsForContact(db: HqClient, contactId: string): Promise<Loaded<ContactLead[]>> {
  const { data, error } = await db
    .from("opportunity_overview")
    .select("id, ref, stage, property_suburb, next_action, next_action_due, is_open")
    .eq("owner_contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[hq] leadsForContact failed:", logTag(error));
    return { ok: false };
  }
  return {
    ok: true,
    data: (data ?? [])
      .filter((r) => r.id && r.ref && r.stage)
      .map((r) => ({ id: r.id as string, ref: r.ref as string, stage: r.stage as Stage, suburb: r.property_suburb, nextAction: r.next_action, nextActionDue: r.next_action_due, open: r.is_open ?? true })),
  };
}

export type { InteractionType };
