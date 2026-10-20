import "server-only";

import type { HqClient } from "../db";
import { LINK_KINDS, addDays, parseMeetingRef, searchWords, sortActions, zonedIso, type LinkKind, type MeetingListQuery, type MeetingType } from "./rules";

/*
 * Reads for the meeting screens (and the MCP tools). Every query runs as the signed-in person, so row
 * level security is the control: without meetings.read nothing comes back; a confidential meeting
 * reaches only its staff attendees, its recorder and audit.read holders, and every list, count and
 * linked-record block below reads through the same rules. Action tasks are read through hq.tasks under
 * the reader's own task rules, so a task they may not see is never named or counted.
 *
 * Nothing here logs more than an error code.
 */

export type Result<T> = { ok: true; data: T } | { ok: false };

export type MeetingRow = {
  id: string;
  ref: string;
  refNumber: number;
  title: string;
  type: MeetingType;
  heldAt: string;
  durationMinutes: number | null;
  location: string | null;
  summary: string | null;
  minutes: string | null;
  decisionsText: string | null;
  confidential: boolean;
  version: number;
  staffAttendeeIds: string[];
  attendeeNames: string;
  attendeeCount: number;
  linkedNames: string;
  openActions: number;
  doneActions: number;
  actions: number;
  createdBy: string | null;
  createdByName: string | null;
  createdVia: "hq" | "mcp";
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export const OVERVIEW_COLUMNS =
  "id, ref, ref_number, title, meeting_type, held_at, duration_minutes, location, summary, minutes, decisions_text, confidential, version, staff_attendee_ids, attendee_names, attendee_count, linked_names, open_action_count, done_action_count, action_count, created_by, created_by_name, created_via, created_at, updated_at, deleted_at";
/** The list columns without the minutes (a list never needs the long text). */
export const LIST_COLUMNS = OVERVIEW_COLUMNS.replace(", minutes, ", ", ");

type OverviewRow = {
  id: string | null;
  ref: string | null;
  ref_number: number | null;
  title: string | null;
  meeting_type: MeetingType | null;
  held_at: string | null;
  duration_minutes: number | null;
  location: string | null;
  summary: string | null;
  minutes?: string | null;
  decisions_text: string | null;
  confidential: boolean | null;
  version: number | null;
  staff_attendee_ids: string[] | null;
  attendee_names: string | null;
  attendee_count: number | null;
  linked_names: string | null;
  open_action_count: number | null;
  done_action_count: number | null;
  action_count: number | null;
  created_by: string | null;
  created_by_name: string | null;
  created_via: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toMeetingRow(r: OverviewRow): MeetingRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !r.title || !r.meeting_type || !r.held_at || !r.created_at || !r.updated_at) return null;
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    title: r.title,
    type: r.meeting_type,
    heldAt: r.held_at,
    durationMinutes: r.duration_minutes,
    location: r.location,
    summary: r.summary,
    minutes: r.minutes ?? null,
    decisionsText: r.decisions_text,
    confidential: r.confidential === true,
    version: Number(r.version ?? 1),
    staffAttendeeIds: r.staff_attendee_ids ?? [],
    attendeeNames: r.attendee_names ?? "",
    attendeeCount: Number(r.attendee_count ?? 0),
    linkedNames: r.linked_names ?? "",
    openActions: Number(r.open_action_count ?? 0),
    doneActions: Number(r.done_action_count ?? 0),
    actions: Number(r.action_count ?? 0),
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdVia: r.created_via === "mcp" ? "mcp" : "hq",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.deleted_at !== null,
  };
}

export const rowsOf = (data: unknown): MeetingRow[] => ((data ?? []) as OverviewRow[]).map(toMeetingRow).filter((r): r is MeetingRow => r !== null);

export type MeetingFilters = Pick<MeetingListQuery, "q" | "type" | "from" | "to" | "person" | "org" | "open" | "mine"> & {
  /** Only these meetings (a chat tool's "with a contact" filter). */
  ids?: readonly string[];
};

/** Ids of the live meetings linked to an organisation (directly, or through one of its contacts). */
export async function meetingIdsForOrganisation(db: HqClient, org: string): Promise<string[] | null> {
  const contacts = await db.from("contacts").select("id").eq("organisation_id", org).is("deleted_at", null).limit(500);
  if (contacts.error) return null;
  const cIds = (contacts.data ?? []).map((c) => c.id);
  const filter = cIds.length ? `organisation_id.eq.${org},contact_id.in.(${cIds.join(",")})` : `organisation_id.eq.${org}`;
  const links = await db.from("meeting_links").select("meeting_id").or(filter).limit(1000);
  if (links.error) return null;
  return [...new Set((links.data ?? []).map((l) => l.meeting_id))];
}

/** Ids of the meetings a contact attended or that are linked to them (null on a database error). */
export async function meetingIdsForContact(db: HqClient, contact: string): Promise<string[] | null> {
  const [links, att] = await Promise.all([
    db.from("meeting_links").select("meeting_id").eq("contact_id", contact).limit(1000),
    db.from("meeting_attendees").select("meeting_id").eq("contact_id", contact).limit(1000),
  ]);
  if (links.error || att.error) return null;
  return [...new Set([...(links.data ?? []), ...(att.data ?? [])].map((l) => l.meeting_id))];
}

/**
 * The meeting list, newest first. Search matches the title, summary, minutes, decisions, attendee and
 * linked names; an MTG-0001 ref finds that meeting. Dates are calendar days in `timeZone`.
 */
export async function listMeetings(
  db: HqClient,
  f: Partial<MeetingFilters>,
  page: { offset: number; limit: number },
  ctx: { staffId: string; timeZone: string },
): Promise<Result<{ rows: MeetingRow[]; total: number }>> {
  let q = db.from("meeting_overview").select(LIST_COLUMNS, { count: "exact" }).is("deleted_at", null);
  const ref = f.q ? parseMeetingRef(f.q) : null;
  if (ref !== null) q = q.eq("ref_number", ref);
  else if (f.q) {
    const w = searchWords(f.q);
    if (w) q = q.or(`title.ilike.*${w}*,summary.ilike.*${w}*,minutes.ilike.*${w}*,decisions_text.ilike.*${w}*,attendee_names.ilike.*${w}*,linked_names.ilike.*${w}*`);
  }
  if (f.type) q = q.eq("meeting_type", f.type);
  if (f.from) {
    const iso = zonedIso(f.from, "00:00", ctx.timeZone);
    if (iso) q = q.gte("held_at", iso);
  }
  if (f.to) {
    const iso = zonedIso(addDays(f.to, 1), "00:00", ctx.timeZone);
    if (iso) q = q.lt("held_at", iso);
  }
  if (f.person) q = q.contains("staff_attendee_ids", [f.person]);
  if (f.open) q = q.gt("open_action_count", 0);
  if (f.mine) q = q.or(`created_by.eq.${ctx.staffId},staff_attendee_ids.cs.{${ctx.staffId}}`);
  if (f.ids) {
    if (f.ids.length === 0) return { ok: true, data: { rows: [], total: 0 } };
    q = q.in("id", f.ids.slice(0, 500));
  }
  if (f.org) {
    const ids = await meetingIdsForOrganisation(db, f.org);
    if (ids === null) {
      console.error("[hq] listMeetings organisation filter failed");
      return { ok: false };
    }
    if (ids.length === 0) return { ok: true, data: { rows: [], total: 0 } };
    q = q.in("id", ids.slice(0, 500));
  }
  const { data, error, count } = await q
    .order("held_at", { ascending: false })
    .order("ref_number", { ascending: false })
    .range(page.offset, page.offset + page.limit - 1);
  if (error) {
    if (error.code === "PGRST103") return { ok: true, data: { rows: [], total: count ?? 0 } };
    console.error("[hq] listMeetings failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

/** Meetings held since `sinceIso`, newest first (the "This week" cards, Today, the digest). */
export async function recentMeetings(db: HqClient, sinceIso: string, limit = 12): Promise<Result<{ rows: MeetingRow[]; total: number }>> {
  const { data, error, count } = await db
    .from("meeting_overview")
    .select(LIST_COLUMNS, { count: "exact" })
    .is("deleted_at", null)
    .gte("held_at", sinceIso)
    .order("held_at", { ascending: false })
    .order("ref_number", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[hq] recentMeetings failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

export type OpenAction = {
  taskId: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  meetingId: string;
  meetingRef: string;
  meetingTitle: string;
};

/** Open action items from meetings the person can see (tasks they can see), soonest due first. */
export async function openMeetingActions(db: HqClient, opts: { limit?: number; mine?: string | null } = {}): Promise<Result<{ rows: OpenAction[]; total: number }>> {
  let q = db
    .from("open_meeting_actions")
    .select("task_id, title, status, priority, due_date, assigned_to, assignee_name, meeting_id, meeting_ref, meeting_title", { count: "exact" });
  if (opts.mine) q = q.eq("assigned_to", opts.mine);
  const { data, error, count } = await q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).limit(opts.limit ?? 8);
  if (error) {
    console.error("[hq] openMeetingActions failed:", error.code);
    return { ok: false };
  }
  const rows = (data ?? [])
    .filter((r) => r.task_id && r.title && r.meeting_id && r.meeting_ref && r.meeting_title)
    .map((r) => ({
      taskId: r.task_id as string,
      title: r.title as string,
      status: r.status ?? "to_do",
      priority: r.priority ?? "normal",
      dueDate: r.due_date,
      assigneeId: r.assigned_to,
      assigneeName: r.assignee_name,
      meetingId: r.meeting_id as string,
      meetingRef: r.meeting_ref as string,
      meetingTitle: r.meeting_title as string,
    }));
  return { ok: true, data: { rows: sortActions(rows), total: count ?? rows.length } };
}

// ── one meeting ──────────────────────────────────────────────

export type Attendee = { id: number; kind: "staff" | "contact" | "name"; recordId: string | null; name: string; href: string | null };
export type Link = { id: number; kind: LinkKind; recordId: string; label: string | null; href: string | null; hasTouchPoint: boolean };
export type ActionTask = { id: string; title: string; status: string; priority: string; dueDate: string | null; assigneeId: string | null; assigneeName: string | null };
export type HistoryEntry = {
  id: number;
  version: number;
  action: string;
  summary: string;
  byName: string | null;
  at: string;
  via: "hq" | "mcp";
  note: string | null;
  title: string;
  summarySnapshot: string | null;
  minutesSnapshot: string | null;
  decisionsSnapshot: string | null;
};

export type MeetingDetail = {
  meeting: MeetingRow;
  attendees: Attendee[];
  links: Link[];
  actions: ActionTask[];
  hiddenActionCount: number;
  history: HistoryEntry[];
};

export const linkHref = (kind: LinkKind, id: string): string | null => {
  switch (kind) {
    case "contact":
      return `/hq/growth/contacts/${id}`;
    case "organisation":
      return `/hq/growth/organisations/${id}`;
    case "opportunity":
      return `/hq/growth/opportunities/${id}`;
    case "contractor":
      return `/hq/partners/${id}`;
    case "decision":
      return `/hq/decisions/${id}`;
    case "managed_property":
      return `/hq/portfolio/${id}`;
  }
};

type LinkRowDb = {
  id: number;
  contact_id: string | null;
  organisation_id: string | null;
  opportunity_id: string | null;
  contractor_id: string | null;
  decision_id: string | null;
  managed_property_id: string | null;
  interaction_id: string | null;
};

const kindOf = (l: LinkRowDb): { kind: LinkKind; id: string } | null => {
  for (const k of LINK_KINDS) {
    const col = (k === "managed_property" ? "managed_property_id" : `${k}_id`) as keyof LinkRowDb;
    const v = l[col];
    if (typeof v === "string") return { kind: k, id: v };
  }
  return null;
};

/** Names for linked records, read under the reader's own rules (a record they cannot read has no name). */
async function linkLabels(db: HqClient, links: readonly { kind: LinkKind; id: string }[]): Promise<Map<string, string>> {
  const by = (k: LinkKind) => links.filter((l) => l.kind === k).map((l) => l.id);
  const out = new Map<string, string>();
  const [c, o, opp, ctr, d, mp] = await Promise.all([
    by("contact").length ? db.from("contacts").select("id, full_name").in("id", by("contact")) : null,
    by("organisation").length ? db.from("organisations").select("id, name").in("id", by("organisation")) : null,
    by("opportunity").length ? db.from("opportunities").select("id, prospect_name, display_number").in("id", by("opportunity")) : null,
    by("contractor").length ? db.from("contractors").select("id, business_name").in("id", by("contractor")) : null,
    by("decision").length ? db.from("decision_overview").select("id, ref, title").in("id", by("decision")) : null,
    by("managed_property").length ? db.from("managed_properties").select("id, property_address").in("id", by("managed_property")) : null,
  ]);
  for (const r of c?.data ?? []) out.set(`contact:${r.id}`, r.full_name);
  for (const r of o?.data ?? []) out.set(`organisation:${r.id}`, r.name);
  for (const r of opp?.data ?? []) out.set(`opportunity:${r.id}`, r.prospect_name ?? `LEAD-${String(r.display_number).padStart(4, "0")}`);
  for (const r of ctr?.data ?? []) out.set(`contractor:${r.id}`, r.business_name);
  for (const r of d?.data ?? []) if (r.id && r.ref) out.set(`decision:${r.id}`, `${r.ref} ${r.title ?? ""}`.trim());
  for (const r of mp?.data ?? []) out.set(`managed_property:${r.id}`, r.property_address);
  return out;
}

/**
 * One meeting with its attendees, links, action tasks and history; null when missing or not the
 * reader's to see (archived ones too, for people who may restore them).
 */
export async function getMeeting(db: HqClient, id: string, opts: { historyLimit?: number } = {}): Promise<Result<MeetingDetail | null>> {
  const one = await db.from("meeting_overview").select(OVERVIEW_COLUMNS).eq("id", id).maybeSingle();
  if (one.error) {
    console.error("[hq] getMeeting failed:", one.error.code);
    return { ok: false };
  }
  const meeting = one.data ? toMeetingRow(one.data as OverviewRow) : null;
  if (!meeting) return { ok: true, data: null };

  const [att, links, acts, hist] = await Promise.all([
    db.from("meeting_attendees").select("id, staff_id, contact_id, external_name").eq("meeting_id", id).order("id").limit(50),
    db.from("meeting_links").select("id, contact_id, organisation_id, opportunity_id, contractor_id, decision_id, managed_property_id, interaction_id").eq("meeting_id", id).order("id").limit(50),
    db.from("meeting_actions").select("task_id, created_at").eq("meeting_id", id).order("created_at").limit(100),
    db
      .from("meeting_history")
      .select("id, version, action, change_summary, edited_by_name, edited_at, via, change_note, title, summary, minutes, decisions_text")
      .eq("meeting_id", id)
      .order("version", { ascending: false })
      .limit(opts.historyLimit ?? 100),
  ]);
  if (att.error || links.error || acts.error || hist.error) {
    console.error("[hq] getMeeting parts failed:", att.error?.code ?? links.error?.code ?? acts.error?.code ?? hist.error?.code);
    return { ok: false };
  }

  const staffIds = (att.data ?? []).map((a) => a.staff_id).filter((x): x is string => !!x);
  const contactIds = (att.data ?? []).map((a) => a.contact_id).filter((x): x is string => !!x);
  const taskIds = (acts.data ?? []).map((a) => a.task_id);
  const [staff, contacts, tasks] = await Promise.all([
    staffIds.length ? db.from("staff_profiles").select("id, full_name").in("id", staffIds) : null,
    contactIds.length ? db.from("contacts").select("id, full_name").in("id", contactIds) : null,
    taskIds.length ? db.from("tasks").select("id, title, status, priority, due_date, assigned_to").in("id", taskIds).is("deleted_at", null) : null,
  ]);
  if (tasks?.error) {
    console.error("[hq] getMeeting tasks failed:", tasks.error.code);
    return { ok: false };
  }
  const staffName = new Map((staff?.data ?? []).map((s) => [s.id, s.full_name]));
  const contactName = new Map((contacts?.data ?? []).map((c) => [c.id, c.full_name]));

  const attendees: Attendee[] = (att.data ?? []).map((a) => {
    if (a.staff_id) return { id: a.id, kind: "staff", recordId: a.staff_id, name: staffName.get(a.staff_id) ?? "A colleague", href: null };
    if (a.contact_id) return { id: a.id, kind: "contact", recordId: a.contact_id, name: contactName.get(a.contact_id) ?? "A contact", href: contactName.has(a.contact_id) ? linkHref("contact", a.contact_id) : null };
    return { id: a.id, kind: "name", recordId: null, name: a.external_name ?? "", href: null };
  });

  const rawLinks = (links.data ?? []).map((l) => ({ row: l as LinkRowDb, k: kindOf(l as LinkRowDb) })).filter((x): x is { row: LinkRowDb; k: { kind: LinkKind; id: string } } => x.k !== null);
  const labels = await linkLabels(db, rawLinks.map((x) => x.k));
  const linkList: Link[] = rawLinks.map(({ row, k }) => {
    const label = labels.get(`${k.kind}:${k.id}`) ?? null;
    return { id: row.id, kind: k.kind, recordId: k.id, label, href: label ? linkHref(k.kind, k.id) : null, hasTouchPoint: row.interaction_id !== null };
  });

  const assignees = [...new Set((tasks?.data ?? []).map((t) => t.assigned_to).filter((x): x is string => !!x))].filter((x) => !staffName.has(x));
  if (assignees.length) {
    const s = await db.from("staff_profiles").select("id, full_name").in("id", assignees);
    for (const r of s.data ?? []) staffName.set(r.id, r.full_name);
  }
  const order = new Map(taskIds.map((t, i) => [t, i]));
  const actions: ActionTask[] = (tasks?.data ?? [])
    .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.due_date, assigneeId: t.assigned_to, assigneeName: t.assigned_to ? (staffName.get(t.assigned_to) ?? null) : null }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return {
    ok: true,
    data: {
      meeting,
      attendees,
      links: linkList,
      actions,
      hiddenActionCount: Math.max(0, taskIds.length - actions.length),
      history: (hist.data ?? []).map((h) => ({
        id: h.id,
        version: h.version,
        action: h.action,
        summary: h.change_summary,
        byName: h.edited_by_name,
        at: h.edited_at,
        via: h.via === "mcp" ? "mcp" : "hq",
        note: h.change_note,
        title: h.title,
        summarySnapshot: h.summary,
        minutesSnapshot: h.minutes,
        decisionsSnapshot: h.decisions_text,
      })),
    },
  };
}

/** Live meetings linked to one record (a contact, organisation, lead or contractor), newest first, only those the reader may see. */
export async function meetingsFor(db: HqClient, kind: "contact" | "organisation" | "opportunity" | "contractor", id: string, limit = 5): Promise<Result<{ rows: MeetingRow[]; total: number }>> {
  const col = `${kind}_id` as "contact_id" | "organisation_id" | "opportunity_id" | "contractor_id";
  const links = await db.from("meeting_links").select("meeting_id").eq(col, id).limit(500);
  if (links.error) {
    console.error("[hq] meetingsFor links failed:", links.error.code);
    return { ok: false };
  }
  const ids = [...new Set((links.data ?? []).map((l) => l.meeting_id))];
  if (ids.length === 0) return { ok: true, data: { rows: [], total: 0 } };
  const { data, error, count } = await db
    .from("meeting_overview")
    .select(LIST_COLUMNS, { count: "exact" })
    .in("id", ids)
    .is("deleted_at", null)
    .order("held_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[hq] meetingsFor failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: { rows: rowsOf(data), total: count ?? 0 } };
}

// ── pickers for the HQ form ──────────────────────────────────

export type PickerOption = { value: string; label: string };

/** Live leads for a picker (newest activity first), as "Name (LEAD-0007)". */
export async function leadOptions(db: HqClient, limit = 300): Promise<PickerOption[]> {
  const { data, error } = await db
    .from("opportunities")
    .select("id, prospect_name, display_number")
    .is("deleted_at", null)
    .order("stage_changed_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[hq] leadOptions failed:", error.code);
    return [];
  }
  return (data ?? []).map((o) => ({ value: o.id, label: `${o.prospect_name ?? "Lead"} (LEAD-${String(o.display_number).padStart(4, "0")})` }));
}
