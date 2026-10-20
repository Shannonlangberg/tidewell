/*
 * Meetings: vocabulary and rules shared by the screens, the Server Actions and the MCP tools. They
 * mirror what the database enforces (migration 0140): the database is the control, these give people
 * the same answer earlier and in plain words.
 *
 * HOW MEETINGS ARRIVE: a person tells ChatGPT or Claude about a meeting (or pastes notes or a transcript
 * from a recording tool); the assistant writes the minutes and summary and saves them through the MCP
 * tool create_meeting. Or someone types them into the HQ form. HQ records no audio, has no AI inside,
 * and never stores a transcript: only the minutes.
 *
 * Pure, with NO value imports on purpose (Node's type-stripping test runner; see lib/hq/tasks/rules.ts).
 * The FormReader is passed in; only its type is imported.
 */
import type { FormReader } from "../forms";

// ── vocabulary (values MUST match hq.meeting_type) ───────────

export const MEETING_TYPES = ["partner_referral", "internal_team", "contractor", "landlord_owner", "supplier_other", "planning_strategy", "other"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  partner_referral: "Partner or referral",
  internal_team: "Team",
  contractor: "Contractor",
  landlord_owner: "Landlord or owner",
  supplier_other: "Supplier or other business",
  planning_strategy: "Planning and strategy",
  other: "Other",
};

export const isMeetingType = (v: unknown): v is MeetingType => typeof v === "string" && (MEETING_TYPES as readonly string[]).includes(v);

/** The kinds of record a meeting can be linked to (hq.meeting_links). */
export const LINK_KINDS = ["contact", "organisation", "opportunity", "contractor", "decision", "managed_property"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABEL: Record<LinkKind, string> = {
  contact: "Contact",
  organisation: "Organisation",
  opportunity: "Lead",
  contractor: "Contractor",
  decision: "Decision",
  managed_property: "Property",
};
/** Linked kinds that log a touch-point interaction on the record. */
export const TOUCH_POINT_KINDS: readonly LinkKind[] = ["contact", "organisation", "opportunity", "contractor"];

export const TITLE_MAX = 200;
export const SUMMARY_MAX = 2000;
export const MINUTES_MAX = 50000;
export const DECISIONS_MAX = 5000;
export const LOCATION_MAX = 200;
export const NAME_MAX = 120;
export const NOTE_MAX = 300;
export const DURATION_MAX = 1440;
export const ATTENDEE_MAX = 40;
export const LINK_MAX = 20;
export const ACTION_MAX = 20;
export const ACTION_DESCRIPTION_MAX = 2000;
/** Action rows on the HQ form (more can be added on the meeting page). */
export const FORM_ACTION_ROWS = 4;
/** Contact attendee pickers on the HQ form. */
export const FORM_CONTACT_ROWS = 4;
export const LIST_PAGE_SIZE = 25;
/** An action's due date can be at most this many days ahead (as hq_private.meeting_add_task). */
export const ACTION_DUE_DAYS = 730;

// ── refs: MTG-0001 ───────────────────────────────────────────

/** "MTG-0007"; never truncates a long number ("MTG-123456"). */
export function meetingRef(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "";
  return `MTG-${String(n).padStart(4, "0")}`;
}

/** The number in "MTG-0007", "mtg 7" or "meeting 7"; null when it is not a ref. */
export function parseMeetingRef(input: string | null | undefined): number | null {
  const m = /^\s*(?:mtg|meeting)[-\s#]*0*(\d{1,9})\s*$/i.exec(input ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// ── dates and times ──────────────────────────────────────────

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** YYYY-MM-DD plus n days. */
export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

function isRealDate(v: string): boolean {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** The wall-clock parts of an instant in `timeZone`. */
function wallParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/**
 * A local date and time in `timeZone` as an ISO instant ("2026-10-20T09:30" in Adelaide ->
 * "2026-10-19T23:00:00.000Z"). null when the date or time is not valid. A time in a daylight-saving gap
 * moves forward to the next valid minute, as clocks do.
 */
export function zonedIso(date: string, time: string, timeZone: string): string | null {
  if (!isRealDate(date) || !TIME.test(time)) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i += 1) {
    const p = wallParts(guess, timeZone);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (seen === want) break;
    guess += want - seen;
  }
  return new Date(guess).toISOString();
}

/** The start of "the last `days` days" (today included) in `timeZone`, as an ISO instant. */
export function sinceDaysIso(today: string, days: number, timeZone: string): string {
  return zonedIso(addDays(today, -(days - 1)), "00:00", timeZone) ?? `${addDays(today, -days)}T00:00:00.000Z`;
}

/** The local date (YYYY-MM-DD) and time (HH:MM) of an instant in `timeZone`, for a form's defaults. */
export function localParts(iso: string | null | undefined, timeZone: string): { date: string; time: string } {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) return { date: "", time: "" };
  const p = wallParts(ms, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${two(p.mo)}-${two(p.d)}`, time: `${two(p.h)}:${two(p.mi)}` };
}

/**
 * When a meeting was held, as a chat app gives it: "2026-10-20" (a day: saved at 9:00 am local, and
 * `timeGiven` is false), "2026-10-20T14:30" or "2026-10-20 14:30" (local time in `timeZone`), or a full
 * ISO instant with Z or an offset. null when it cannot be read.
 */
export function parseWhen(input: string | null | undefined, timeZone: string): { iso: string; timeGiven: boolean } | null {
  const v = (input ?? "").trim();
  if (isRealDate(v)) {
    const iso = zonedIso(v, "09:00", timeZone);
    return iso ? { iso, timeGiven: false } : null;
  }
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/.exec(v);
  if (local) {
    const iso = zonedIso(local[1], local[2], timeZone);
    return iso ? { iso, timeGiven: true } : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), timeGiven: true };
  }
  return null;
}

/** A plain reason a meeting time is not allowed (as hq_private.meeting_when_check), or null. */
export function heldAtProblem(iso: string, nowMs: number = Date.now()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Enter a valid date and time.";
  if (t < Date.parse("2000-01-01T00:00:00Z")) return "That date is too far in the past.";
  if (t > nowMs + 86_400_000) return "Meetings are recorded after they happen: the date can be at most a day ahead.";
  return null;
}

/** A plain reason an action's due date is not allowed, or null. */
export function dueDateProblem(date: string, today: string): string | null {
  if (!isRealDate(date)) return "Enter a valid date.";
  if (date < "2000-01-01" || date > addDays(today, ACTION_DUE_DAYS)) return "A due date must be within the next two years.";
  return null;
}

/** The touch-point interaction type a meeting logs (as hq_private.meeting_sync_touchpoints). */
export function touchPointType(location: string | null | undefined): "coffee_meeting" | "phone_call" | "office_meeting" {
  const l = location ?? "";
  if (/(coffee|caf[eé])/i.test(l)) return "coffee_meeting";
  if (/\b(phone|call)\b/i.test(l)) return "phone_call";
  return "office_meeting";
}

/** "45 min", "1 hr", "1 hr 30 min". */
export function durationLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes < 1) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

// ── text ─────────────────────────────────────────────────────

/** Line breaks kept (CR LF -> LF), other control characters out, trimmed. As hq_private.meeting_text. */
export function normaliseText(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/^[ \t\n]+|[ \t\n]+$/g, "");
}

/** Up to `lines` lines and `max` characters of a summary, for a card (markdown marks removed). */
export function summaryExcerpt(summary: string | null | undefined, max = 240, lines = 3): string {
  const plain = normaliseText(summary)
    .split("\n")
    .map((l) => l.replace(/^#{1,6}\s+/, "").replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").replace(/\*\*|__/g, "").trim())
    .filter(Boolean)
    .slice(0, lines)
    .join(" ");
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/**
 * Names typed one per line (or separated by commas or semicolons), for attendees HQ does not hold:
 * trimmed, spaces collapsed, each at most 120 characters, duplicates (any case) dropped.
 */
export function parseNameList(text: string | null | undefined, max: number = ATTENDEE_MAX): { names: string[]; tooLong: boolean; tooMany: boolean } {
  const seen = new Set<string>();
  const names: string[] = [];
  let tooLong = false;
  for (const raw of (text ?? "").split(/[\n,;]+/)) {
    const n = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!n) continue;
    if (n.length > NAME_MAX) {
      tooLong = true;
      continue;
    }
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(n);
  }
  return { names: names.slice(0, max), tooLong, tooMany: names.length > max };
}

/** Search words made safe for a PostgREST `or=(...ilike...)` filter: wildcards and filter punctuation out. */
export function searchWords(q: string): string {
  return q.replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

// ── attendees and links (shared by the form and the chat tools) ──

export type AttendeePick = { staffId: string; label: string } | { contactId: string; label: string } | { name: string; label: string };

/** One key per person: the same staff member, contact or (any-case) name is one attendee. */
export function attendeeKey(a: AttendeePick): string {
  if ("staffId" in a) return `s:${a.staffId.toLowerCase()}`;
  if ("contactId" in a) return `c:${a.contactId.toLowerCase()}`;
  return `n:${a.name.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

/** Duplicates dropped (first wins), at most ATTENDEE_MAX. */
export function dedupeAttendees(list: readonly AttendeePick[]): AttendeePick[] {
  const seen = new Set<string>();
  const out: AttendeePick[] = [];
  for (const a of list) {
    const k = attendeeKey(a);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.slice(0, ATTENDEE_MAX);
}

/** The JSON hq.create_meeting takes for attendees. */
export function attendeesJson(list: readonly AttendeePick[]): Array<{ staff_id: string } | { contact_id: string } | { name: string }> {
  return dedupeAttendees(list).map((a) => ("staffId" in a ? { staff_id: a.staffId } : "contactId" in a ? { contact_id: a.contactId } : { name: a.name }));
}

export type LinkPick = { kind: LinkKind; id: string; label: string };

/** Duplicates dropped (same kind and id), at most LINK_MAX. */
export function dedupeLinks(list: readonly LinkPick[]): LinkPick[] {
  const seen = new Set<string>();
  const out: LinkPick[] = [];
  for (const l of list) {
    const k = `${l.kind}:${l.id.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out.slice(0, LINK_MAX);
}

/**
 * The links to save: those asked for, plus each contact who attended (so the meeting is logged on their
 * record and "last contacted" moves) unless `linkAttendeeContacts` is false.
 */
export function linksWithAttendees(links: readonly LinkPick[], attendees: readonly AttendeePick[], linkAttendeeContacts = true): LinkPick[] {
  const extra: LinkPick[] = linkAttendeeContacts
    ? attendees.flatMap((a) => ("contactId" in a ? [{ kind: "contact" as const, id: a.contactId, label: a.label }] : []))
    : [];
  return dedupeLinks([...links, ...extra]);
}

/** The word a person used for a record, as a link kind ("lead" -> opportunity, "partner" -> organisation ...), or null. */
export function linkKindFor(word: string | null | undefined): LinkKind | null {
  const w = (word ?? "").trim().toLowerCase().replace(/s$/, "");
  if (["contact", "person", "partner contact"].includes(w)) return "contact";
  if (["organisation", "organization", "org", "agency", "business", "company", "partner", "firm", "office"].includes(w)) return "organisation";
  if (["opportunity", "lead", "prospect", "landlord lead"].includes(w)) return "opportunity";
  if (["contractor", "trade", "tradie", "tradesperson"].includes(w)) return "contractor";
  if (["decision"].includes(w)) return "decision";
  if (["managed_property", "managed property", "property"].includes(w)) return "managed_property";
  return null;
}

// ── the HQ form ──────────────────────────────────────────────

export const MEETING_FORM_LABELS: Record<string, string> = {
  title: "Title",
  meeting_type: "Kind of meeting",
  held_date: "Date",
  held_time: "Time",
  duration_minutes: "Duration",
  location: "Where",
  summary: "Summary",
  minutes: "Minutes",
  decisions_text: "Decisions",
  external_names: "Other attendees",
  change_note: "What you changed",
};

export type MeetingFieldValues = {
  title: string;
  meetingType: MeetingType | null;
  heldAt: string | null;
  durationMinutes: number | null;
  location: string | null;
  summary: string | null;
  minutes: string | null;
  decisionsText: string | null;
  confidential: boolean;
};

/**
 * The meeting's own fields (create and edit). The date and time are read in `timeZone` (the person's)
 * and become one instant; no time means 9:00 am.
 */
export function readMeetingFields(reader: FormReader, formData: FormData, timeZone: string, nowMs: number = Date.now()): MeetingFieldValues {
  const title = reader.requiredText("title", { max: TITLE_MAX, label: "The title" });
  const meetingType = reader.oneOf("meeting_type", MEETING_TYPES, { required: true });
  const date = reader.date("held_date", { required: true });
  const rawTime = String(formData.get("held_time") ?? "").trim();
  let heldAt: string | null = null;
  if (rawTime && !TIME.test(rawTime)) reader.errors.held_time = "Enter a time like 09:30.";
  else if (date) {
    heldAt = zonedIso(date, rawTime || "09:00", timeZone);
    const problem = heldAt ? heldAtProblem(heldAt, nowMs) : "Enter a valid date.";
    if (problem) {
      reader.errors.held_date = problem;
      heldAt = null;
    }
  }
  const rawDuration = String(formData.get("duration_minutes") ?? "").trim();
  let durationMinutes: number | null = null;
  if (rawDuration) {
    const n = Number(rawDuration);
    if (!Number.isInteger(n) || n < 1 || n > DURATION_MAX) reader.errors.duration_minutes = "Enter the minutes, from 1 to 1440.";
    else durationMinutes = n;
  }
  const location = reader.text("location", { max: LOCATION_MAX, label: "Where" });
  const summary = reader.requiredText("summary", { max: SUMMARY_MAX, label: "The summary" }) || null;
  const minutesRaw = normaliseText(String(formData.get("minutes") ?? ""));
  let minutes: string | null = minutesRaw || null;
  if (minutesRaw.length > MINUTES_MAX) {
    reader.errors.minutes = `The minutes must be ${MINUTES_MAX} characters or fewer.`;
    minutes = null;
  }
  const decisionsText = reader.text("decisions_text", { max: DECISIONS_MAX, label: "The decisions" });
  return { title, meetingType, heldAt, durationMinutes, location, summary, minutes, decisionsText, confidential: reader.bool("confidential") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every valid id posted under `name` (checkboxes or several pickers), lower case, de-duplicated. */
export function uuidList(formData: FormData, name: string, max = 50): string[] {
  const out = new Set<string>();
  for (const v of formData.getAll(name)) if (typeof v === "string" && UUID.test(v.trim())) out.add(v.trim().toLowerCase());
  return [...out].slice(0, max);
}

export type ActionRow = { title: string; assigneeId: string | null; dueDate: string | null };

/**
 * The action rows of the form (action_title_1, action_assignee_1, action_due_1, ...). A row with no
 * title is skipped; a row with a title is checked (errors are keyed by the row's field names).
 */
export function readActionRows(formData: FormData, rows: number, today: string, errors: Record<string, string>): ActionRow[] {
  const out: ActionRow[] = [];
  for (let i = 1; i <= rows; i += 1) {
    const title = String(formData.get(`action_title_${i}`) ?? "").replace(/\s+/g, " ").trim();
    const assignee = String(formData.get(`action_assignee_${i}`) ?? "").trim();
    const due = String(formData.get(`action_due_${i}`) ?? "").trim();
    if (!title) {
      if (due || assignee) errors[`action_title_${i}`] = "Give the action a title, or clear the row.";
      continue;
    }
    if (title.length > TITLE_MAX) errors[`action_title_${i}`] = `An action must be ${TITLE_MAX} characters or fewer.`;
    if (assignee && !UUID.test(assignee)) errors[`action_assignee_${i}`] = "Choose one of the options.";
    if (due) {
      const p = dueDateProblem(due, today);
      if (p) errors[`action_due_${i}`] = p;
    }
    out.push({ title, assigneeId: assignee && UUID.test(assignee) ? assignee.toLowerCase() : null, dueDate: due || null });
  }
  return out;
}

// ── the list's URL ───────────────────────────────────────────

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

export type MeetingListQuery = {
  q: string;
  type: MeetingType | null;
  from: string | null;
  to: string | null;
  /** A member of staff who attended. */
  person: string | null;
  /** An organisation the meeting is linked to. */
  org: string | null;
  /** Only meetings with open actions. */
  open: boolean;
  /** Only meetings the person recorded or attended. */
  mine: boolean;
  page: number;
  filtered: boolean;
  moreActive: boolean;
};

export function parseMeetingListQuery(sp: Params): MeetingListQuery {
  const q = first(sp.q).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  const type = isMeetingType(first(sp.type)) ? (first(sp.type) as MeetingType) : null;
  let from = isRealDate(first(sp.from)) ? first(sp.from) : null;
  let to = isRealDate(first(sp.to)) ? first(sp.to) : null;
  if (from && to && from > to) [from, to] = [to, from];
  const person = UUID.test(first(sp.person)) ? first(sp.person).toLowerCase() : null;
  const org = UUID.test(first(sp.org)) ? first(sp.org).toLowerCase() : null;
  const open = first(sp.open) === "1";
  const mine = first(sp.mine) === "1";
  const pageN = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageN) ? Math.min(10_000, Math.max(1, pageN)) : 1;
  const moreActive = !!(type || from || to || person || org || open || mine);
  return { q, type, from, to, person, org, open, mine, page, filtered: moreActive || q !== "", moreActive };
}

// ── the digest ("what happened in meetings this week") ───────

export type DigestMeeting = { ref: string; title: string; heldAt: string; type: MeetingType; summary: string | null; attendees: string; openActions: number; confidential: boolean };
export type DigestAction = { title: string; assignee: string | null; dueDate: string | null; meetingRef: string };

/**
 * The week's meetings and open actions in plain words. `day` formats an instant or a date for the
 * person; `today` is YYYY-MM-DD. Record text goes in the returned `lines` (the caller puts them inside the
 * labelled data block); `head` holds only counts.
 */
export function digestText(meetings: readonly DigestMeeting[], actions: readonly DigestAction[], opts: { today: string; days: number; day: (v: string) => string }): { head: string; lines: string[] } {
  const span = opts.days === 7 ? "the last 7 days" : `the last ${opts.days} days`;
  const overdue = actions.filter((a) => a.dueDate !== null && a.dueDate < opts.today).length;
  const mCount = meetings.length === 1 ? "1 meeting" : `${meetings.length} meetings`;
  const aCount = actions.length === 1 ? "1 open action" : `${actions.length} open actions`;
  const head =
    meetings.length === 0 && actions.length === 0
      ? `No meetings recorded in ${span}, and no open actions from meetings.`
      : `${meetings.length === 0 ? "No meetings" : mCount} recorded in ${span}; ${actions.length === 0 ? "no open actions from meetings" : aCount + " from meetings"}${overdue > 0 ? ` (${overdue} overdue)` : ""}.`;
  const lines: string[] = [];
  if (meetings.length > 0) {
    lines.push("Meetings (newest first):");
    for (const m of meetings) {
      const who = m.attendees ? ` with ${m.attendees}` : "";
      const acts = m.openActions > 0 ? ` (${m.openActions === 1 ? "1 open action" : `${m.openActions} open actions`})` : "";
      lines.push(`- ${opts.day(m.heldAt)}: ${m.ref} ${m.title}${who}${acts}${m.confidential ? " [confidential]" : ""}`);
      if (m.summary) lines.push(`  ${summaryExcerpt(m.summary, 300)}`);
    }
  }
  if (actions.length > 0) {
    lines.push("Open actions (soonest due first):");
    for (const a of actions) {
      const due = a.dueDate ? (a.dueDate < opts.today ? `OVERDUE, was due ${opts.day(a.dueDate)}` : `due ${opts.day(a.dueDate)}`) : "no due date";
      lines.push(`- ${a.title} (${a.assignee ?? "unassigned"}, ${due}; from ${a.meetingRef})`);
    }
  }
  return { head, lines };
}

/** Soonest due first; no due date last; then by title. */
export function sortActions<T extends { dueDate: string | null; title: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    if (a.dueDate !== b.dueDate) {
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

// ── history ──────────────────────────────────────────────────

export const HISTORY_ACTIONS = ["create", "update", "add_attendee", "remove_attendee", "link", "unlink", "add_action", "promote_decision", "archive", "restore"] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const HISTORY_ACTION_LABEL: Record<HistoryAction, string> = {
  create: "Recorded",
  update: "Edited",
  add_attendee: "Attendee added",
  remove_attendee: "Attendee removed",
  link: "Linked",
  unlink: "Unlinked",
  add_action: "Action added",
  promote_decision: "Decision added to the register",
  archive: "Archived",
  restore: "Restored",
};

export const isHistoryAction = (v: unknown): v is HistoryAction => typeof v === "string" && (HISTORY_ACTIONS as readonly string[]).includes(v);
