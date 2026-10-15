/*
 * One record, read in full and written out as plain lines: what `fetch`, `get_contact` and
 * `get_contractor` return. Each loader reads through the person's own session (RLS), returns null
 * when the record does not exist or is not theirs to see (the same answer for both), and THROWS on
 * a database error (the tool wrapper turns that into a generic message).
 *
 * The lines are record content: callers put them inside the labelled data block.
 */
import {
  CATEGORY_LABEL,
  CONTRACTOR_CATEGORY_LABEL,
  CONTRACTOR_EXPIRY_STATE_LABEL,
  CONTRACTOR_STATUS_LABEL,
  INTERACTION_LABEL,
  OPEN_TASK_STATUSES,
  PRIORITY_LABEL,
  RELATIONSHIP_LABEL,
  STAGE_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  VETTING_STEP_LABEL,
  isOneOf,
  OPPORTUNITY_STAGES,
  type ContractorCategory,
  type InteractionType,
  type PartnerCategory,
  type Priority,
  type RelationshipStatus,
  type TaskPriority,
  type TaskStatus,
  type VettingStep,
} from "../../constants";
import { getContractor, openTasksForContractor } from "../../contractors/queries";
import { formatRate } from "../../contractors/money";
import { listInteractions } from "../../contacts/queries";
import { formatAud, refNumber } from "../../format";
import { HQ_PATHS, LIMITS, clean, recordId, type RecordKind } from "./core";
import { can, day, link, logDb, today, when, type ToolContext } from "./kit";

export type RecordView = {
  kind: RecordKind;
  id: string;
  title: string;
  url: string;
  lines: string[];
  metadata: Record<string, unknown>;
};

const RECENT = 5;

const line = (label: string, value: unknown, max: number = LIMITS.short): string | null => {
  const v = clean(value, max);
  return v ? `${label}: ${v}` : null;
};
const longText = (label: string, value: unknown): string | null => {
  const v = clean(value, LIMITS.long, { multiline: true });
  return v ? `${label}:\n${v}` : null;
};
const compact = (list: (string | null | undefined)[]): string[] => list.filter((l): l is string => !!l);

function fail(where: string, error: { code?: string | null } | null): never {
  logDb(where, error);
  throw new Error(`read ${where} ${error?.code ?? ""}`);
}

const partnerCats = (cats: readonly string[] | null | undefined) =>
  (cats ?? []).map((c) => (isOneOf(Object.keys(CATEGORY_LABEL) as PartnerCategory[], c) ? CATEGORY_LABEL[c] : c)).join(", ");
const tradeCats = (cats: readonly string[] | null | undefined) =>
  (cats ?? []).map((c) => (isOneOf(Object.keys(CONTRACTOR_CATEGORY_LABEL) as ContractorCategory[], c) ? CONTRACTOR_CATEGORY_LABEL[c] : c)).join(", ");
export const relLabel = (s: string | null | undefined) => (s && s in RELATIONSHIP_LABEL ? RELATIONSHIP_LABEL[s as RelationshipStatus] : (s ?? ""));
export const taskStatusLabel = (s: string) => (s in TASK_STATUS_LABEL ? TASK_STATUS_LABEL[s as TaskStatus] : s);
export const taskPriorityLabel = (s: string) => (s in TASK_PRIORITY_LABEL ? TASK_PRIORITY_LABEL[s as TaskPriority] : s);
export const stageLabel = (s: string | null | undefined) => (s && isOneOf(OPPORTUNITY_STAGES, s) ? STAGE_LABEL[s] : (s ?? ""));
export const interactionLabel = (s: string) => (s in INTERACTION_LABEL ? INTERACTION_LABEL[s as InteractionType] : s);
export { partnerCats, tradeCats };

// ── contact ──────────────────────────────────────────────────

export async function contactRecord(ctx: ToolContext, id: string): Promise<RecordView | null> {
  const { data: c, error } = await ctx.db.from("contact_directory").select("*").eq("id", id).maybeSingle();
  if (error) fail("contact", error);
  if (!c?.id || !c.full_name) return null;

  const [interactions, tasks] = await Promise.all([
    listInteractions(ctx.db, { contactId: c.id }, RECENT),
    ctx.db
      .from("tasks")
      .select("id, title, due_date, status")
      .eq("related_contact_id", c.id)
      .in("status", [...OPEN_TASK_STATUSES])
      .is("deleted_at", null)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(RECENT),
  ]);
  if (!interactions.ok) throw new Error("read interactions");
  if (tasks.error) fail("contact tasks", tasks.error);

  const t = today(ctx);
  const followUp = c.next_follow_up_date ? `${day(ctx, c.next_follow_up_date)}${c.next_follow_up_date < t ? " (overdue)" : c.next_follow_up_date === t ? " (today)" : ""}` : null;
  const lines = compact([
    line("Name", c.full_name),
    line("Position", c.position),
    line("Organisation", c.organisation_name ?? "Independent (no organisation)"),
    c.org_contact_role === "primary" ? "Role at organisation: primary contact" : null,
    line("Categories", partnerCats(c.categories)),
    line("Phone", c.phone),
    line("Email", c.email),
    line("Website", c.website),
    line("Location", c.location),
    line("Service region", c.service_region),
    line("Relationship status", relLabel(c.relationship_status)),
    line("Priority", c.priority ? PRIORITY_LABEL[c.priority as Priority] : null),
    line("Relationship owner", c.relationship_owner_name ?? "Nobody"),
    line("Last contacted", c.last_contact_at ? when(ctx, c.last_contact_at) : "Never recorded"),
    line("Next follow-up", followUp ?? "None set"),
    line("Referrals", `${c.referrals_received ?? 0} received, ${c.referrals_sent ?? 0} sent`),
    c.needs_verification ? "Needs verifying: yes (imported or researched, not yet checked)" : null,
    longText("Notes", c.notes),
    interactions.data.items.length > 0 ? `Recent interactions (newest first, ${interactions.data.items.length}${interactions.data.more ? ` of more` : ""}):` : "Recent interactions: none logged",
    ...interactions.data.items.map(
      (i) =>
        `- ${when(ctx, i.occurredAt)}, ${interactionLabel(i.type)}${i.staffName ? ` by ${clean(i.staffName)}` : ""}: ${clean(i.summary, LIMITS.medium)}${i.nextAction ? ` | next: ${clean(i.nextAction)}` : ""}${i.followUpDate ? ` | follow up ${day(ctx, i.followUpDate)}` : ""}`,
    ),
    (tasks.data ?? []).length > 0 ? "Open tasks:" : null,
    ...(tasks.data ?? []).map((k) => `- ${clean(k.title)} (${taskStatusLabel(k.status)}${k.due_date ? `, due ${day(ctx, k.due_date)}` : ""}) [id: ${k.id}]`),
  ]);
  return {
    kind: "contact",
    id: c.id,
    title: c.organisation_name ? `${c.full_name} (${c.organisation_name})` : c.full_name,
    url: link(ctx, HQ_PATHS.contact(c.id)),
    lines,
    metadata: { type: "contact", relationship_status: c.relationship_status, next_follow_up_date: c.next_follow_up_date, organisation_id: c.organisation_id },
  };
}

// ── organisation ─────────────────────────────────────────────

export async function organisationRecord(ctx: ToolContext, id: string): Promise<RecordView | null> {
  const { data: o, error } = await ctx.db.from("organisation_directory").select("*").eq("id", id).maybeSingle();
  if (error) fail("organisation", error);
  if (!o?.id || !o.name) return null;

  const [people, perf] = await Promise.all([
    ctx.db.from("contact_directory").select("id, full_name, position, org_contact_role, relationship_status").eq("organisation_id", o.id).order("full_name").limit(15),
    ctx.db.from("partner_performance").select("received, sent, qualified, signed, conversion").eq("organisation_id", o.id).maybeSingle(),
  ]);
  if (people.error) fail("organisation contacts", people.error);
  if (perf.error) fail("organisation performance", perf.error);
  const p = perf.data;

  const lines = compact([
    line("Name", o.name),
    line("Categories", partnerCats(o.categories)),
    line("Website", o.website),
    line("Phone", o.phone),
    line("Email", o.email),
    line("Location", o.location),
    line("Service region", o.service_region),
    line("Relationship owner", o.relationship_owner_name ?? "Nobody"),
    line("Primary contact", o.primary_contact_name ?? "None set"),
    line("Last contacted", o.last_contact_at ? when(ctx, o.last_contact_at) : "Never recorded"),
    line("Next follow-up", o.next_follow_up_date ? day(ctx, o.next_follow_up_date) : "None set"),
    p ? line("Referrals", `${p.received ?? 0} received, ${p.sent ?? 0} sent, ${p.qualified ?? 0} reached qualified, ${p.signed ?? 0} managements signed`) : null,
    o.needs_verification ? "Needs verifying: yes" : null,
    longText("Notes", o.notes),
    (people.data ?? []).length > 0 ? `Contacts (${o.contact_count ?? people.data?.length}):` : "Contacts: none recorded",
    ...(people.data ?? []).map(
      (c) => `- ${clean(c.full_name)}${c.position ? `, ${clean(c.position)}` : ""}${c.org_contact_role === "primary" ? " (primary)" : ""} - ${relLabel(c.relationship_status)} [id: ${c.id}]`,
    ),
  ]);
  return {
    kind: "organisation",
    id: o.id,
    title: o.name,
    url: link(ctx, HQ_PATHS.organisation(o.id)),
    lines,
    metadata: { type: "organisation", categories: o.categories, contact_count: o.contact_count },
  };
}

// ── contractor ───────────────────────────────────────────────

const expiryLine = (label: string, state: string, expires: string | null, days: number | null, ctx: ToolContext) => {
  const s = state in CONTRACTOR_EXPIRY_STATE_LABEL ? CONTRACTOR_EXPIRY_STATE_LABEL[state as keyof typeof CONTRACTOR_EXPIRY_STATE_LABEL] : state;
  const tail = expires ? `, expires ${day(ctx, expires)}${days !== null ? (days < 0 ? ` (${-days} days ago)` : ` (in ${days} days)`) : ""}` : "";
  return `${label}: ${s}${tail}`;
};

export async function contractorRecord(ctx: ToolContext, id: string): Promise<RecordView | null> {
  const loaded = await getContractor(ctx.db, id);
  if (!loaded.ok) throw new Error("read contractor");
  const c = loaded.data;
  if (!c) return null;

  const [steps, reviews, contacts, tasks] = await Promise.all([
    ctx.db.from("contractor_vetting_steps").select("step, status, note").eq("contractor_id", c.id),
    ctx.db
      .from("contractor_reviews")
      .select("id, job_date, job_reference, response_time, communication, work_quality, invoice_accuracy, tenant_feedback, rework_required, notes, created_at")
      .eq("contractor_id", c.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
    ctx.db.from("interactions").select("occurred_at, interaction_type, summary").eq("contractor_id", c.id).is("deleted_at", null).order("occurred_at", { ascending: false }).limit(3),
    openTasksForContractor(ctx.db, c.id),
  ]);
  if (steps.error) fail("contractor steps", steps.error);
  if (reviews.error) fail("contractor reviews", reviews.error);
  if (contacts.error) fail("contractor contacts", contacts.error);
  const stepOrder = Object.keys(VETTING_STEP_LABEL) as VettingStep[];
  const stepRows = [...(steps.data ?? [])].sort((a, b) => stepOrder.indexOf(a.step) - stepOrder.indexOf(b.step));

  const rating =
    c.rating !== null && c.ratedReviewCount >= c.ratingThreshold
      ? `${(Math.round(c.rating * 10) / 10).toFixed(1)} out of 5 from ${c.ratedReviewCount} rated reviews`
      : `Not enough feedback yet (${c.ratedReviewCount} of ${c.ratingThreshold} rated reviews)`;
  const emergency = c.emergencyAvailable === null ? "Not known" : c.emergencyAvailable ? "Yes" : "No";

  const lines = compact([
    line("Business", c.businessName),
    line("Status", `${CONTRACTOR_STATUS_LABEL[c.status]}${c.statusReason ? ` (${clean(c.statusReason)})` : ""}`),
    c.status === "approved" || c.status === "preferred" ? line("Approved", `${day(ctx, c.approvedAt)}${c.approvedByName ? ` by ${c.approvedByName}` : ""}`) : null,
    line("Trades", tradeCats(c.categories)),
    line("Contact person", c.primaryContactName ?? "Not recorded"),
    line("Phone", c.phone ?? "Not recorded"),
    line("Email", c.email ?? "Not recorded"),
    line("Website", c.website),
    line("ABN", c.abn ?? "Not recorded"),
    line("Suburbs serviced", c.serviceSuburbs.length ? c.serviceSuburbs.join(", ") : "Not recorded", LIMITS.medium),
    line("Regions serviced", c.serviceRegions.length ? c.serviceRegions.join(", ") : "Not recorded"),
    line("Emergency call-outs", emergency),
    line("Business hours", c.businessHours ?? "Not recorded"),
    `Rates: hourly ${formatRate(c.hourlyRateCents)}; call-out ${formatRate(c.calloutFeeCents)}; after hours ${formatRate(c.afterHoursFeeCents)}; minimum charge ${formatRate(c.minimumChargeCents)}`,
    line("Invoice terms", c.invoiceTerms),
    expiryLine("Insurance", c.insuranceState, c.insuranceExpiresOn, c.insuranceDaysRemaining, ctx),
    expiryLine("Licence", c.licenceState, c.licenceExpiresOn, c.licenceDaysRemaining, ctx),
    line("Documents on file", String(c.documentCount)),
    line("Relationship owner", c.ownerName ?? "Nobody"),
    line("Last contacted", c.lastContactedAt ? when(ctx, c.lastContactedAt) : "Never recorded"),
    line("Last job", c.lastJobDate ? day(ctx, c.lastJobDate) : "Not recorded"),
    line("Rating", rating),
    c.needsVerification ? "Needs verifying: yes (details not yet checked by a person)" : null,
    `Vetting checklist: ${c.vettingDoneCount} of 9 done`,
    ...stepRows.map((s) => `- ${VETTING_STEP_LABEL[s.step]}: ${s.status.replace(/_/g, " ")}${s.note ? ` (${clean(s.note)})` : ""}`),
    longText("Internal notes", c.internalNotes),
    (reviews.data ?? []).length > 0 ? "Latest feedback:" : "Feedback: none recorded",
    ...(reviews.data ?? []).map((r) => {
      const scores = [
        r.response_time ? `response ${r.response_time}` : null,
        r.communication ? `communication ${r.communication}` : null,
        r.work_quality ? `quality ${r.work_quality}` : null,
        r.invoice_accuracy ? `invoice ${r.invoice_accuracy}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${r.job_date ? day(ctx, r.job_date) : day(ctx, r.created_at)}${r.job_reference ? ` (${clean(r.job_reference)})` : ""}: ${scores || "no ratings"}${r.rework_required ? ", rework needed" : ""}${r.notes ? ` - ${clean(r.notes, LIMITS.medium)}` : ""}`;
    }),
    (contacts.data ?? []).length > 0 ? "Recent contact:" : null,
    ...(contacts.data ?? []).map((i) => `- ${when(ctx, i.occurred_at)}, ${interactionLabel(i.interaction_type)}: ${clean(i.summary, LIMITS.medium)}`),
    tasks.ok && tasks.data.length > 0 ? "Open tasks:" : null,
    ...(tasks.ok ? tasks.data : []).map((k) => `- ${clean(k.title)} (${taskStatusLabel(k.status)}${k.dueDate ? `, due ${day(ctx, k.dueDate)}` : ""}) [id: ${k.id}]`),
  ]);
  return {
    kind: "contractor",
    id: c.id,
    title: c.businessName,
    url: link(ctx, HQ_PATHS.contractor(c.id)),
    lines,
    metadata: { type: "contractor", status: c.status, trades: c.categories, insurance_state: c.insuranceState, licence_state: c.licenceState, vetting_done: c.vettingDoneCount },
  };
}

// ── task ─────────────────────────────────────────────────────

export async function taskRecord(ctx: ToolContext, id: string): Promise<RecordView | null> {
  const { data: t, error } = await ctx.db
    .from("tasks")
    .select("id, title, description, status, priority, due_date, assigned_to, created_by, completed_at, related_contact_id, related_organisation_id, related_contractor_id, related_referral_id, created_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("task", error);
  if (!t) return null;
  const ids = [t.assigned_to, t.created_by].filter((v): v is string => !!v);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const s = await ctx.db.from("staff_profiles").select("id, full_name").in("id", ids);
    if (s.error) fail("task staff", s.error);
    for (const r of s.data ?? []) names.set(r.id, r.full_name);
  }
  const related: string[] = [];
  if (can(ctx, "growth.read") && t.related_contact_id) {
    const r = await ctx.db.from("contacts").select("full_name").eq("id", t.related_contact_id).maybeSingle();
    if (r.data) related.push(`contact ${clean(r.data.full_name)} [id: ${t.related_contact_id}]`);
  }
  if (can(ctx, "growth.read") && t.related_organisation_id) {
    const r = await ctx.db.from("organisations").select("name").eq("id", t.related_organisation_id).maybeSingle();
    if (r.data) related.push(`organisation ${clean(r.data.name)} [id: ${t.related_organisation_id}]`);
  }
  if (can(ctx, "contractors.read") && t.related_contractor_id) {
    const r = await ctx.db.from("contractors").select("business_name").eq("id", t.related_contractor_id).maybeSingle();
    if (r.data) related.push(`contractor ${clean(r.data.business_name)} [id: ${t.related_contractor_id}]`);
  }
  const td = today(ctx);
  const overdue = t.due_date && t.due_date < td && (OPEN_TASK_STATUSES as readonly string[]).includes(t.status);
  const lines = compact([
    line("Title", t.title),
    line("Status", taskStatusLabel(t.status)),
    line("Priority", taskPriorityLabel(t.priority)),
    line("Due", t.due_date ? `${day(ctx, t.due_date)}${overdue ? " (overdue)" : ""}` : "No due date"),
    line("Assigned to", t.assigned_to ? (names.get(t.assigned_to) ?? "someone") : "Nobody"),
    line("Created by", t.created_by ? (names.get(t.created_by) ?? "someone") : null),
    t.completed_at ? line("Completed", when(ctx, t.completed_at)) : null,
    related.length ? `Linked to: ${related.join("; ")}` : null,
    longText("Description", t.description),
  ]);
  return { kind: "task", id: t.id, title: t.title, url: link(ctx, HQ_PATHS.task(t.id)), lines, metadata: { type: "task", status: t.status, due_date: t.due_date, priority: t.priority } };
}

// ── referral ─────────────────────────────────────────────────

export async function referralRecord(ctx: ToolContext, id: string): Promise<RecordView | null> {
  const { data: r, error } = await ctx.db.from("referral_overview").select("*").eq("id", id).maybeSingle();
  if (error) fail("referral", error);
  if (!r?.id) return null;
  const label = r.ref_label ?? refNumber(r.ref_number);
  const lines = compact([
    line("Referral", label),
    line("Direction", r.direction === "received" ? "Received (a partner introduced a prospect)" : "Sent (Planted referred someone out)"),
    line("Date", day(ctx, r.referral_date)),
    line("Partner", [r.partner_contact_name, r.partner_organisation_name].filter(Boolean).join(", ") || "Not recorded"),
    line("Prospect", r.prospect_name),
    line("Prospect phone", r.prospect_phone),
    line("Prospect email", r.prospect_email),
    line("Property", [r.property_address, r.property_suburb].filter(Boolean).join(", ")),
    r.direction === "received" ? line("Pipeline stage", stageLabel(r.stage)) : line("Outcome", r.sent_outcome?.replace(/_/g, " ")),
    r.direction === "received" ? line("Credited source", r.is_attributed ? "Yes (this referral is credited)" : "No (a further claim; the credit is with another referral)") : null,
    r.estimated_annual_value_cents !== null ? line("Estimated annual value", formatAud(r.estimated_annual_value_cents)) : null,
    r.signed_at ? line("Signed", day(ctx, r.signed_at)) : null,
    line("Assigned to", r.assigned_to_name ?? "Nobody"),
    longText("Notes", r.notes),
  ]);
  return {
    kind: "referral",
    id: r.id,
    title: `${label}${r.prospect_name ? ` ${r.prospect_name}` : ""}`,
    url: link(ctx, HQ_PATHS.referral(r.id)),
    lines,
    metadata: { type: "referral", direction: r.direction, stage: r.stage, referral_date: r.referral_date },
  };
}

export async function loadRecord(ctx: ToolContext, kind: RecordKind, id: string): Promise<RecordView | null> {
  switch (kind) {
    case "contact":
      return can(ctx, "growth.read") ? contactRecord(ctx, id) : null;
    case "organisation":
      return can(ctx, "growth.read") ? organisationRecord(ctx, id) : null;
    case "contractor":
      return can(ctx, "contractors.read") ? contractorRecord(ctx, id) : null;
    case "task":
      return taskRecord(ctx, id);
    case "referral":
      return can(ctx, "growth.read") ? referralRecord(ctx, id) : null;
  }
}

export { recordId };
