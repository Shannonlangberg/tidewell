"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, TASK_PRIORITIES } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { FormReader, fail, isUuid, type ActionState } from "@/lib/hq/forms";
import { DECISION_CATEGORIES, OPEN_DECISION_STATUSES, TEXT_MAX } from "@/lib/hq/decisions/rules";
import {
  ATTENDEE_MAX,
  FORM_ACTION_ROWS,
  LINK_KINDS,
  NAME_MAX,
  NOTE_MAX,
  TITLE_MAX,
  ACTION_DESCRIPTION_MAX,
  attendeesJson,
  dueDateProblem,
  linksWithAttendees,
  parseNameList,
  readActionRows,
  readMeetingFields,
  uuidList,
  type AttendeePick,
  type LinkKind,
  type LinkPick,
} from "@/lib/hq/meetings/rules";
import { retainedValues } from "@/lib/hq/tasks/retain";
import { withToast } from "@/components/hq/flash";

/*
 * Server Actions for Meetings. Each is reachable by a direct POST, so every one:
 *   1. calls requireStaff("meetings.write") FIRST (a reader's forged request is redirected out before
 *      anything is read or written; adding to the Decisions register needs decisions.write as well),
 *   2. takes identity from the session only (the database stamps created_by, the history's edited_by
 *      and the audit actor),
 *   3. validates every input on the server (FormReader + the meeting rules),
 *   4. writes ONLY through the hq meeting RPCs, which check the capability and the confidential rule
 *      again, create action items as tasks, log the touch points, and write the history and audit.
 * People see plain messages; only error codes are logged.
 */

const MEETINGS = `${HQ_BASE}/meetings`;
const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";
const NOT_FOUND = "That meeting could not be found. It may have been archived.";
const CHECK = "Please check the highlighted fields and try again.";

type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

/** The RPCs' own messages are plain English and name no record values; show them for rule refusals only. */
function messageFor(error: DbError): string {
  const code = error?.code ?? "";
  if (error?.hint === "meeting_stale") return "This meeting was changed by someone else while you were editing. Reload the page to see their changes, then edit again.";
  if (code === "42501" && error?.hint === "meeting_confidential_owner") return "Only the person who recorded this meeting, or a director or administrator, can change whether it is confidential.";
  if (code === "42501") return FORBIDDEN;
  if (code === "P0002" || code === "PGRST116") return NOT_FOUND;
  if ((code === "22023" || code === "23514") && error?.message) {
    const m = error.message.trim();
    return `${m.charAt(0).toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
  }
  return GENERIC;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh(id?: string) {
  revalidatePath(MEETINGS);
  if (id) revalidatePath(`${MEETINGS}/${id}`);
  revalidatePath(HQ_BASE);
}

const withValues = (base: ActionState, formData: FormData): ActionState => ({ ...base, data: { values: retainedValues(formData) } });

function idFrom(formData: FormData, name = "id"): string | null {
  const raw = formData.get(name);
  return typeof raw === "string" && isUuid(raw) ? raw.toLowerCase() : null;
}

const back = (id: string, hash = "") => `${MEETINGS}/${id}${hash}`;

// ── create ───────────────────────────────────────────────────

export async function createMeeting(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("meetings.write");
  const reader = new FormReader(formData);
  const v = readMeetingFields(reader, formData, staff.timezone);

  const staffIds = uuidList(formData, "staff_ids", ATTENDEE_MAX);
  const contactIds = uuidList(formData, "contact_ids", ATTENDEE_MAX);
  const names = parseNameList(String(formData.get("external_names") ?? ""));
  if (names.tooLong) reader.errors.external_names = `Each name must be ${NAME_MAX} characters or fewer.`;
  if (staffIds.length + contactIds.length + names.names.length > ATTENDEE_MAX) reader.errors.external_names = `A meeting can have at most ${ATTENDEE_MAX} attendees.`;
  const attendees: AttendeePick[] = [
    ...staffIds.map((id) => ({ staffId: id, label: "" })),
    ...contactIds.map((id) => ({ contactId: id, label: "" })),
    ...names.names.map((n) => ({ name: n, label: n })),
  ];
  const links: LinkPick[] = [
    ...uuidList(formData, "link_organisation", 5).map((id) => ({ kind: "organisation" as const, id, label: "" })),
    ...uuidList(formData, "link_opportunity", 5).map((id) => ({ kind: "opportunity" as const, id, label: "" })),
    ...uuidList(formData, "link_contractor", 5).map((id) => ({ kind: "contractor" as const, id, label: "" })),
  ];
  const allLinks = linksWithAttendees(links, attendees, formData.get("link_contacts") === "on");
  const actions = readActionRows(formData, FORM_ACTION_ROWS, todayIn(staff.timezone), reader.errors);
  if (actions.length > 0 && !can("tasks.write")) reader.errors.action_title_1 = "Your role cannot create tasks. Leave the actions empty.";
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  const { data, error } = await db.rpc("create_meeting", {
    p_title: v.title,
    p_type: v.meetingType!,
    p_held_at: v.heldAt!,
    p_duration_minutes: v.durationMinutes ?? undefined,
    p_location: v.location ?? undefined,
    p_summary: v.summary ?? undefined,
    p_minutes: v.minutes ?? undefined,
    p_decisions_text: v.decisionsText ?? undefined,
    p_confidential: v.confidential,
    p_attendees: attendeesJson(attendees),
    p_links: allLinks.map((l) => ({ kind: l.kind, id: l.id })),
    p_actions: actions.map((a) => ({ title: a.title, assignee_id: a.assigneeId ?? staff.id, due_date: a.dueDate })),
  });
  const out = data as { meeting_id?: string; ref?: string } | null;
  if (error || !out?.meeting_id) {
    logged("createMeeting", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(out.meeting_id);
  redirect(withToast(back(out.meeting_id), `Meeting ${out.ref ?? ""} saved`.replace(/\s+/g, " ")));
}

// ── edit ─────────────────────────────────────────────────────

export async function updateMeeting(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  if (!id) return withValues(fail(NOT_FOUND), formData);
  const version = Number(formData.get("version"));
  if (!Number.isInteger(version) || version < 1) return withValues(fail(GENERIC), formData);

  const reader = new FormReader(formData);
  const v = readMeetingFields(reader, formData, staff.timezone);
  const note = reader.text("change_note", { max: NOTE_MAX, label: "The note" });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);

  // An emptied optional field is cleared (null would leave it as it was).
  const clear = [
    v.durationMinutes === null ? "duration_minutes" : null,
    v.location === null ? "location" : null,
    v.minutes === null ? "minutes" : null,
    v.decisionsText === null ? "decisions_text" : null,
  ].filter((x): x is string => x !== null);
  const { data, error } = await db.rpc("update_meeting", {
    p_meeting: id,
    p_expected_version: version,
    p_title: v.title,
    p_type: v.meetingType!,
    p_held_at: v.heldAt!,
    p_duration_minutes: v.durationMinutes ?? undefined,
    p_location: v.location ?? undefined,
    p_summary: v.summary ?? undefined,
    p_minutes: v.minutes ?? undefined,
    p_decisions_text: v.decisionsText ?? undefined,
    p_confidential: formData.get("confidential_shown") === "1" ? v.confidential : undefined,
    p_clear: clear.length ? clear : undefined,
    p_change_note: note ?? "Edited in HQ",
  });
  if (error) {
    logged("updateMeeting", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(back(id), changed ? "Meeting saved" : "Nothing changed", changed ? "success" : "info"));
}

// ── attendees and links (small forms on the meeting page) ────

export async function addAttendee(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const staffId = idFrom(formData, "staff_id");
  const contactId = idFrom(formData, "contact_id");
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX + 1);
  const chosen = [staffId, contactId, name || null].filter(Boolean).length;
  if (chosen !== 1) redirect(withToast(back(id, "#attendees"), "Choose one person: a team member, a contact, or type a name.", "error"));
  if (name.length > NAME_MAX) redirect(withToast(back(id, "#attendees"), `A name must be ${NAME_MAX} characters or fewer.`, "error"));
  const { data, error } = await db.rpc("add_meeting_attendee", {
    p_meeting: id,
    p_staff: staffId ?? undefined,
    p_contact: contactId ?? undefined,
    p_name: staffId || contactId ? undefined : name,
  });
  if (error) {
    logged("addAttendee", error);
    redirect(withToast(back(id, "#attendees"), messageFor(error), "error"));
  }
  // a contact who attended is also linked, so the meeting is logged on their record
  if (contactId) {
    const link = await db.rpc("link_meeting", { p_meeting: id, p_kind: "contact", p_id: contactId });
    if (link.error) logged("addAttendee link", link.error);
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(back(id, "#attendees"), changed ? "Attendee added" : "They are already an attendee", changed ? "success" : "info"));
}

export async function removeAttendee(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  const attendee = Number(formData.get("attendee_id"));
  if (!id || !Number.isSafeInteger(attendee) || attendee < 1) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const { error } = await db.rpc("remove_meeting_attendee", { p_meeting: id, p_attendee: attendee });
  if (error) {
    logged("removeAttendee", error);
    redirect(withToast(back(id, "#attendees"), messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(back(id, "#attendees"), "Attendee removed"));
}

const isLinkKind = (v: unknown): v is LinkKind => typeof v === "string" && (LINK_KINDS as readonly string[]).includes(v);

export async function linkRecord(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const kind = formData.get("kind");
  const recordId = idFrom(formData, "record_id");
  if (!isLinkKind(kind) || !recordId) redirect(withToast(back(id, "#links"), "Choose a record to link.", "error"));
  const { data, error } = await db.rpc("link_meeting", { p_meeting: id, p_kind: kind, p_id: recordId });
  if (error) {
    logged("linkRecord", error);
    redirect(withToast(back(id, "#links"), error.code === "P0002" ? "That record could not be found." : messageFor(error), "error"));
  }
  refresh(id);
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  redirect(withToast(back(id, "#links"), changed ? "Linked" : "That record is already linked", changed ? "success" : "info"));
}

export async function unlinkRecord(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  const kind = formData.get("kind");
  const recordId = idFrom(formData, "record_id");
  if (!id || !isLinkKind(kind) || !recordId) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const { error } = await db.rpc("unlink_meeting", { p_meeting: id, p_kind: kind, p_id: recordId });
  if (error) {
    logged("unlinkRecord", error);
    redirect(withToast(back(id, "#links"), messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(back(id, "#links"), "Unlinked"));
}

// ── actions (tasks) ──────────────────────────────────────────

export async function addAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff, can } = await requireStaff("meetings.write");
  if (!can("tasks.write")) return fail(FORBIDDEN);
  const id = idFrom(formData);
  if (!id) return fail(NOT_FOUND);
  const reader = new FormReader(formData);
  const title = reader.requiredText("title", { max: TITLE_MAX, label: "The action" });
  const assignee = reader.uuid("assignee_id", { label: "Who" });
  const due = reader.date("due_date");
  if (due) {
    const p = dueDateProblem(due, todayIn(staff.timezone));
    if (p) reader.errors.due_date = p;
  }
  const priority = reader.oneOf("priority", TASK_PRIORITIES, { fallback: "normal" });
  const description = reader.text("description", { max: ACTION_DESCRIPTION_MAX, label: "The detail" });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);
  const { error } = await db.rpc("add_meeting_action", {
    p_meeting: id,
    p_title: title,
    p_assignee: assignee ?? staff.id,
    p_due_date: due ?? undefined,
    p_priority: priority ?? "normal",
    p_description: description ?? undefined,
  });
  if (error) {
    logged("addAction", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  redirect(withToast(back(id, "#actions"), "Action added as a task"));
}

// ── Decisions register ───────────────────────────────────────

export async function promoteDecision(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, can } = await requireStaff("decisions.write");
  if (!can("meetings.write")) return fail(FORBIDDEN);
  const id = idFrom(formData);
  if (!id) return fail(NOT_FOUND);
  const reader = new FormReader(formData);
  const title = reader.requiredText("title", { max: TITLE_MAX, label: "The decision" });
  const category = reader.oneOf("category", DECISION_CATEGORIES, { required: true });
  const status = reader.oneOf("status", OPEN_DECISION_STATUSES, { fallback: "decided" });
  const rationale = reader.text("rationale", { max: TEXT_MAX, label: "Why" });
  if (!reader.ok) return withValues(reader.fail(CHECK), formData);
  const { data, error } = await db.rpc("promote_decision_to_register", {
    p_meeting: id,
    p_title: title,
    p_category: category!,
    p_rationale: rationale ?? undefined,
    p_status: status ?? "decided",
  });
  const out = data as { decision?: { ref?: string } } | null;
  if (error || !out?.decision) {
    logged("promoteDecision", error);
    return withValues(fail(messageFor(error)), formData);
  }
  refresh(id);
  revalidatePath(`${HQ_BASE}/decisions`);
  redirect(withToast(back(id, "#decisions"), `Added to the Decisions register as ${out.decision.ref ?? "a new decision"}`));
}

// ── archive and restore ──────────────────────────────────────

export async function archiveMeeting(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const { error } = await db.rpc("archive_record", { p_entity: "meeting", p_id: id, p_reason: "Archived from the meeting page" });
  if (error) {
    logged("archiveMeeting", error);
    redirect(withToast(back(id), messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(MEETINGS, "Meeting archived"));
}

export async function restoreMeeting(formData: FormData): Promise<void> {
  const { db } = await requireStaff("meetings.write");
  const id = idFrom(formData);
  if (!id) redirect(withToast(MEETINGS, NOT_FOUND, "error"));
  const { error } = await db.rpc("restore_record", { p_entity: "meeting", p_id: id });
  if (error) {
    logged("restoreMeeting", error);
    redirect(withToast(back(id), messageFor(error), "error"));
  }
  refresh(id);
  redirect(withToast(back(id), "Meeting restored"));
}
