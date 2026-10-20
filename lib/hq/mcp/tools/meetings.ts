/*
 * Meetings over MCP: the way a meeting gets into HQ from ChatGPT or Claude. The person talks about a
 * meeting (or pastes notes or a transcript from a recording tool); the ASSISTANT writes the minutes and
 * a short summary and saves them here. HQ records no audio, has no AI of its own, and never stores the
 * transcript: only the minutes, summary, decisions, attendees, links and action tasks.
 *
 *   read  (meetings.read):   list_meetings, search_meetings, get_meeting, meeting_digest
 *   write (meetings.write):  create_meeting, update_meeting, add_meeting_action
 *   write (decisions.write, and meetings.write): promote_meeting_decision
 *
 * Every query runs as the person (RLS): a confidential meeting is invisible to anyone but its team
 * attendees, its recorder and directors and administrators, in every list here too. Every write goes
 * through the hq meeting RPCs (create_meeting, update_meeting, add/remove_meeting_attendee,
 * link/unlink_meeting, add_meeting_action, promote_decision_to_register), which check the capability
 * again, write the history and the audit trail, create action items as real tasks and log one
 * touch-point interaction per linked contact, organisation, lead or contractor. Names are resolved
 * BEFORE anything is written: several matches return candidates and nothing is saved. Nothing here
 * archives or deletes a meeting (that is an HQ screen).
 */
import { applyEdit, sectionText, type EditOp } from "../../knowledge/edits";
import { normaliseName } from "../../growth/params";
import {
  ATTENDEE_MAX,
  MEETING_TYPE_LABEL,
  dedupeAttendees,
  digestText,
  dueDateProblem,
  durationLabel,
  heldAtProblem,
  linksWithAttendees,
  parseMeetingRef,
  parseWhen,
  searchWords,
  summaryExcerpt,
  sinceDaysIso,
  type AttendeePick,
  type LinkKind,
  type LinkPick,
  type MeetingType,
} from "../../meetings/rules";
import { LIST_COLUMNS, getMeeting as loadMeeting, listMeetings as queryMeetings, meetingIdsForContact, openMeetingActions, recentMeetings, rowsOf, type MeetingRow } from "../../meetings/queries";
import { LIMITS, candidatesText, changeLine, clean, compose, decideResolution, isUuid, notFoundText, plural, result, rowLimit, type Candidate } from "./core";
import { can, day, dbFailure, defineTool, link, logDb, resolveContact, resolveContractor, resolveOpportunity, resolveOrganisation, resolveStaff, respond, today, when, type ToolContext, type ToolResult } from "./kit";
import {
  addMeetingActionShape,
  createMeetingShape,
  getMeetingShape,
  listMeetingsShape,
  meetingDigestShape,
  promoteMeetingDecisionShape,
  searchMeetingsShape,
  updateMeetingShape,
} from "./meeting-schemas";

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const path = (id: string) => `/hq/meetings/${id}`;
const typeLabel = (t: MeetingType) => MEETING_TYPE_LABEL[t] ?? t;

const NEVER_INVENT =
  "Use ONLY what the person said or pasted: never invent attendees, dates, times, figures, decisions or actions. If something material is missing (who was there, when it was), ask before saving.";

/** One list line (record content: goes inside the data block). */
function line(ctx: ToolContext, m: MeetingRow): string {
  const parts = [
    `${m.ref} ${clean(m.title)}`,
    typeLabel(m.type),
    when(ctx, m.heldAt),
    m.attendeeNames ? `with ${clean(m.attendeeNames, 200)}` : null,
    m.openActions > 0 ? plural(m.openActions, "open action") : null,
    m.confidential ? "confidential" : null,
  ].filter(Boolean);
  return `- ${parts.join(" · ")} [id: ${m.id}] ${link(ctx, path(m.id))}`;
}

// ── resolving "MTG-0001", an id or title words ───────────────

type Found = { ok: true; meeting: MeetingRow; note: string | null } | { ok: false; result: ToolResult };

async function overview(ctx: ToolContext, build: (q: ReturnType<typeof base>) => ReturnType<typeof base>, max: number): Promise<MeetingRow[]> {
  const { data, error } = await build(base(ctx)).limit(max);
  if (error) {
    logDb("meeting lookup", error);
    throw new Error(`meeting lookup ${error.code ?? ""}`);
  }
  return rowsOf(data);
}
const base = (ctx: ToolContext) => ctx.db.from("meeting_overview").select(`${LIST_COLUMNS}, minutes`).is("deleted_at", null);

const candidate = (ctx: ToolContext, m: MeetingRow): Candidate => ({ id: m.id, label: `${m.ref} ${m.title}`, detail: day(ctx, m.heldAt) });

/** The meeting a person named; several matches -> candidates, never a guess (a single close match must be confirmed for a write). */
export async function resolveMeeting(ctx: ToolContext, query: string, mode: "read" | "write"): Promise<Found> {
  const q = query.trim();
  const n = parseMeetingRef(q);
  const tagged = /^meeting:([0-9a-f-]{36})$/i.exec(q);
  const id = tagged ? tagged[1] : isUuid(q) ? q : null;
  if (n !== null || id) {
    const hit = (await overview(ctx, (b) => (n !== null ? b.eq("ref_number", n) : b.eq("id", id!.toLowerCase())), 1))[0];
    if (hit) return { ok: true, meeting: hit, note: null };
    return { ok: false, result: result("not_found", notFoundText("meeting", q)) };
  }
  const words = searchWords(q);
  if (words.length < 2) return { ok: false, result: result("not_found", notFoundText("meeting", q)) };
  const close = await overview(ctx, (b) => b.ilike("title", `%${words}%`).order("held_at", { ascending: false }), LIMITS.candidates + 1);
  const exact = close.filter((m) => m.title.trim().toLowerCase() === q.toLowerCase());
  const byId = new Map(close.map((m) => [m.id, m]));
  const r = decideResolution({ exact: exact.map((m) => candidate(ctx, m)), close: close.map((m) => candidate(ctx, m)), mode });
  if (r.kind === "one") {
    const m = byId.get(r.record.id)!;
    return { ok: true, meeting: m, note: r.how === "close" ? `No meeting is titled exactly "${clean(q, 80)}"; this is the only close match (${m.ref}).` : null };
  }
  if (r.kind === "none") return { ok: false, result: result("not_found", notFoundText("meeting", q)) };
  const t = candidatesText("meeting", q, r);
  return { ok: false, result: result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates.map((c) => ({ id: c.id, label: c.label, detail: c.detail ?? null })) }) };
}

// ── resolving attendees, links and assignees (before anything is written) ──

type AttendeeInput = string | { name: string; kind?: "staff" | "contact" | "external"; id?: string };
type Picked<T> = { ok: true; value: T } | { ok: false; result: ToolResult };

type StaffLite = { id: string; full_name: string; first_name: string | null };

async function activeStaff(ctx: ToolContext): Promise<StaffLite[]> {
  const { data, error } = await ctx.db.from("staff_profiles").select("id, full_name, first_name").eq("is_active", true).eq("employment_status", "active").order("full_name").limit(500);
  if (error) {
    logDb("meeting staff", error);
    throw new Error("meeting staff");
  }
  return data ?? [];
}

/** A team member named EXACTLY (full name, or a first name only one active person has); several -> candidates. */
function staffExact(all: readonly StaffLite[], name: string): { kind: "one"; s: StaffLite } | { kind: "many"; list: StaffLite[] } | { kind: "none" } {
  const key = normaliseName(name);
  if (!key) return { kind: "none" };
  const full = all.filter((s) => normaliseName(s.full_name) === key);
  if (full.length === 1) return { kind: "one", s: full[0] };
  if (full.length > 1) return { kind: "many", list: full };
  const first = all.filter((s) => s.first_name && normaliseName(s.first_name) === key);
  if (first.length === 1) return { kind: "one", s: first[0] };
  if (first.length > 1) return { kind: "many", list: first };
  return { kind: "none" };
}

async function resolveAttendee(ctx: ToolContext, input: AttendeeInput, staff: readonly StaffLite[]): Promise<Picked<AttendeePick>> {
  const name = (typeof input === "string" ? input : input.name).trim();
  const kind = typeof input === "string" ? undefined : input.kind;
  const id = typeof input === "string" ? undefined : input.id?.trim();
  if (/^(me|myself|i)$/i.test(name) && kind !== "external" && kind !== "contact") return { ok: true, value: { staffId: ctx.staff.id, label: ctx.staff.fullName } };
  if (kind === "external") return { ok: true, value: { name: name.replace(/\s+/g, " "), label: name.replace(/\s+/g, " ") } };
  if (kind === "staff" || (id && staff.some((s) => s.id === id.toLowerCase()))) {
    const who = await resolveStaff(ctx, id ?? name, "write");
    return who.ok ? { ok: true, value: { staffId: who.record.id, label: who.record.label } } : { ok: false, result: who.result };
  }
  if (kind === "contact" || id) {
    const c = await resolveContact(ctx, id ?? name, "write");
    return c.ok ? { ok: true, value: { contactId: c.record.id, label: c.record.label } } : { ok: false, result: c.result };
  }
  const s = staffExact(staff, name);
  if (s.kind === "one") return { ok: true, value: { staffId: s.s.id, label: s.s.full_name } };
  if (s.kind === "many") {
    const r = { kind: "many" as const, how: "exact" as const, candidates: s.list.slice(0, LIMITS.candidates).map((x) => ({ id: x.id, label: x.full_name, detail: "team member" })) };
    const t = candidatesText("team member", name, r);
    return { ok: false, result: result("ambiguous", compose({ head: [t.head, 'Then send the attendee as {"name": ..., "id": ...}.'], data: t.data }), { candidates: r.candidates }) };
  }
  if (!can(ctx, "growth.read")) return { ok: true, value: { name, label: name } };
  const c = await resolveContact(ctx, name, "write");
  if (c.ok) return { ok: true, value: { contactId: c.record.id, label: c.record.label } };
  if (c.result.structured?.outcome === "not_found") return { ok: true, value: { name: name.replace(/\s+/g, " "), label: name.replace(/\s+/g, " ") } };
  // ambiguous: say how to pick one, or to save just the name
  return {
    ok: false,
    result: {
      ...c.result,
      text: `${c.result.text}\n\nNothing was saved. To use one of these contacts, send the attendee as {"name": "${clean(name, 60)}", "id": "<the id>"}; if it is someone else, send {"name": "${clean(name, 60)}", "kind": "external"} to save just the name.`,
    },
  };
}

type LinkInput = { kind: "contact" | "organisation" | "lead" | "contractor"; name: string };
const linkKind = (k: LinkInput["kind"]): LinkKind => (k === "lead" ? "opportunity" : k);

async function resolveLink(ctx: ToolContext, l: LinkInput): Promise<Picked<LinkPick>> {
  const r =
    l.kind === "contact"
      ? await resolveContact(ctx, l.name, "write")
      : l.kind === "organisation"
        ? await resolveOrganisation(ctx, l.name, "write")
        : l.kind === "lead"
          ? await resolveOpportunity(ctx, l.name, "write")
          : await resolveContractor(ctx, l.name, "write");
  return r.ok ? { ok: true, value: { kind: linkKind(l.kind), id: r.record.id, label: r.record.label } } : { ok: false, result: r.result };
}

type ActionInput = { title: string; assignee?: string; due?: string; priority?: "low" | "normal" | "high" | "urgent"; description?: string };
type ResolvedAction = { title: string; assigneeId: string; assigneeLabel: string; due: string | null; priority: string; description: string | null };

async function resolveAction(ctx: ToolContext, a: ActionInput): Promise<Picked<ResolvedAction>> {
  const who = await resolveStaff(ctx, a.assignee ?? "me", "write");
  if (!who.ok) return { ok: false, result: who.result };
  if (a.due) {
    const p = dueDateProblem(a.due, today(ctx));
    if (p) return { ok: false, result: result("invalid", `Not saved: the action "${clean(a.title, 80)}" has a due date that is not allowed. ${p} Nothing was changed.`) };
  }
  return { ok: true, value: { title: a.title, assigneeId: who.record.id, assigneeLabel: who.record.label, due: a.due ?? null, priority: a.priority ?? "normal", description: a.description ?? null } };
}

/** A refusal from the meeting RPCs, in words (their messages are plain English and name no record values). */
function rpcFailure(where: string, error: { code?: string | null; message?: string | null; hint?: string | null } | null): ToolResult {
  if (error?.hint === "meeting_stale") {
    logDb(where, error);
    return result("refused", `Not changed: ${error.message ?? "someone changed this meeting since you read it"}. Read it again with get_meeting, then make the change on the newest version.`, { code: "stale" });
  }
  if (error && (error.code === "22023" || error.code === "23514") && error.message) {
    logDb(where, error);
    return result("invalid", `Not saved: ${error.message}. Nothing was changed.`, { code: error.code });
  }
  if (error?.code === "42501" && error.hint === "meeting_confidential_owner") {
    logDb(where, error);
    return result("refused", `Refused: ${error.message}. Nothing was changed.`, { code: error.code });
  }
  return dbFailure(where, error, { notFound: "That meeting (or a record named in the request) could not be found. Nothing was changed." });
}

type TouchPoint = { kind: string; record_id: string; interaction_id: string | null; change: string };
const KIND_WORD: Record<string, string> = { contact: "contact", organisation: "organisation", opportunity: "lead", contractor: "contractor", decision: "decision", managed_property: "property" };

function touchLines(tp: readonly TouchPoint[], labels: Map<string, string>): string[] {
  const logged = tp.filter((t) => t.change === "created" || t.change === "updated");
  const covered = tp.filter((t) => t.change === "covered");
  const out: string[] = [];
  if (logged.length) out.push(`Logged on: ${logged.map((t) => `${clean(labels.get(t.record_id) ?? "a record")} (${KIND_WORD[t.kind] ?? t.kind}${t.change === "updated" ? ", updated" : ""})`).join("; ")}`);
  if (covered.length) out.push(`Also covers: ${covered.map((t) => clean(labels.get(t.record_id) ?? "an organisation")).join("; ")} (logged through its contact)`);
  return out;
}

// ── list_meetings ────────────────────────────────────────────

export const listMeetings = defineTool({
  name: "list_meetings",
  title: "List meetings",
  description:
    "Lists meetings saved in HQ, newest first: number (MTG-0001), title, kind, when, who was there, open actions, with HQ links. Filters: since/until dates, kind, with (a team member, contact or organisation by name), has_open_actions, mine. Use this, search_meetings or meeting_digest FIRST; it answers most questions in one call. Open one meeting with get_meeting only when the person asks about that meeting. Confidential meetings appear only to the people allowed to see them. Read-only.",
  inputSchema: listMeetingsShape,
  annotations: READ,
  capability: "meetings.read",
  kind: "read",
  handler: async (args, ctx) => {
    if (args.since && args.until && args.since > args.until) return respond("invalid", "Not done: since is after until. Swap the dates and try again.");
    let person: string | null = null;
    let org: string | null = null;
    let ids: string[] | undefined;
    let withLabel: string | null = null;
    if (args.with) {
      const all = await activeStaff(ctx);
      const s = /^(me|myself|i)$/i.test(args.with) ? { kind: "one" as const, s: { id: ctx.staff.id, full_name: ctx.staff.fullName, first_name: null } } : staffExact(all, args.with);
      if (s.kind === "one") {
        person = s.s.id;
        withLabel = s.s.full_name;
      } else if (s.kind === "many") {
        const r = { kind: "many" as const, how: "exact" as const, candidates: s.list.slice(0, LIMITS.candidates).map((x) => ({ id: x.id, label: x.full_name, detail: "team member" })) };
        const t = candidatesText("team member", args.with, r);
        return result("ambiguous", compose({ head: t.head, data: t.data }), { candidates: r.candidates });
      } else {
        const c = await resolveContact(ctx, args.with, "read");
        if (c.ok) {
          const found = await meetingIdsForContact(ctx.db, c.record.id);
          if (found === null) return dbFailure("list_meetings contact", { code: "lookup" });
          ids = found;
          withLabel = c.record.label;
        } else if (c.result.structured?.outcome === "ambiguous") return c.result;
        else {
          const o = await resolveOrganisation(ctx, args.with, "read");
          if (!o.ok) return o.result.structured?.outcome === "not_found" ? respond("not_found", `No team member, contact or organisation matching "${clean(args.with, 80)}" was found in HQ that you can see.`) : o.result;
          org = o.record.id;
          withLabel = o.record.label;
        }
      }
    }
    const max = rowLimit(args.limit);
    const r = await queryMeetings(
      ctx.db,
      { q: "", type: args.type ?? null, from: args.since ?? null, to: args.until ?? null, person, org, open: args.has_open_actions === true, mine: args.mine === true, ids },
      { offset: 0, limit: max },
      { staffId: ctx.staff.id, timeZone: ctx.staff.timezone },
    );
    if (!r.ok) return dbFailure("list_meetings", { code: "query" });
    const filters = [
      args.type ? typeLabel(args.type) : null,
      withLabel ? `with ${clean(withLabel)}` : null,
      args.since ? `from ${day(ctx, args.since)}` : null,
      args.until ? `to ${day(ctx, args.until)}` : null,
      args.has_open_actions ? "with open actions" : null,
      args.mine ? "yours" : null,
    ].filter(Boolean);
    const scope = filters.length ? ` (${filters.join(", ")})` : "";
    const { rows, total } = r.data;
    if (rows.length === 0) return respond("empty", `No meetings found${scope}. HQ holds only the meetings people have saved.`, null, { count: 0 });
    const head = `${total} meeting${total === 1 ? "" : "s"}${scope}, newest first${total > rows.length ? `; showing ${rows.length}` : ""}. All meetings: ${link(ctx, "/hq/meetings")}`;
    return respond("ok", head, rows.map((m) => line(ctx, m)), { count: rows.length, total, ids: rows.map((m) => m.id) });
  },
});

// ── search_meetings ──────────────────────────────────────────

export const searchMeetings = defineTool({
  name: "search_meetings",
  title: "Search meetings",
  description:
    "Finds meetings whose title, summary, minutes, decisions, attendees or linked records contain the words given (or a number like MTG-0001), newest first, with the summary and HQ links. Use this or list_meetings FIRST; open one with get_meeting only when the person asks about that meeting. Read-only.",
  inputSchema: searchMeetingsShape,
  annotations: READ,
  capability: "meetings.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = parseMeetingRef(args.query);
    const words = searchWords(args.query);
    if (n === null && words.length < 2) return respond("invalid", "Not done: give at least two letters or a number like MTG-0001 to search for.");
    const r = await queryMeetings(ctx.db, { q: args.query, type: null, from: null, to: null, person: null, org: null, open: false, mine: false }, { offset: 0, limit: rowLimit(args.limit) }, { staffId: ctx.staff.id, timeZone: ctx.staff.timezone });
    if (!r.ok) return dbFailure("search_meetings", { code: "query" });
    const rows = r.data.rows;
    if (rows.length === 0) return respond("empty", `No meetings match "${clean(args.query, 80)}". Try other words, or list_meetings to see the latest.`, null, { count: 0 });
    const lines = rows.flatMap((m) => [line(ctx, m), ...(m.summary ? [`  Summary: ${clean(summaryExcerpt(m.summary, 300), 300)}`] : [])]);
    return respond("ok", `${rows.length} meeting${rows.length === 1 ? "" : "s"} match "${clean(args.query, 80)}", newest first.`, lines, { count: rows.length, ids: rows.map((m) => m.id) });
  },
});

// ── get_meeting ──────────────────────────────────────────────

export const getMeeting = defineTool({
  name: "get_meeting",
  title: "Open a meeting",
  description:
    "Opens ONE meeting in full, by its number (MTG-0001), id or title words: when, where, who was there, the records it is linked to, the summary, the minutes (or one section of them), the decisions, the action tasks you can see with their status, and recent history, with the HQ link and its current version (pass that as expected_version to update_meeting). Use only when the person asks about that meeting; for several, use list_meetings, search_meetings or meeting_digest. Read-only.",
  inputSchema: getMeetingShape,
  annotations: READ,
  capability: "meetings.read",
  kind: "read",
  handler: async (args, ctx) => {
    const found = await resolveMeeting(ctx, args.meeting, "read");
    if (!found.ok) return found.result;
    const full = await loadMeeting(ctx.db, found.meeting.id, { historyLimit: 6 });
    if (!full.ok) return dbFailure("get_meeting", { code: "query" });
    if (!full.data) return respond("not_found", notFoundText("meeting", args.meeting));
    const { meeting: m, attendees, links, actions, hiddenActionCount, history } = full.data;
    let minutes = m.minutes ?? "";
    let minutesNote = "";
    if (args.section && minutes) {
      const s = sectionText(minutes, args.section);
      if (!s.ok) return respond("invalid", `Not done: ${s.message}`);
      minutes = s.body;
      minutesNote = ` (section "${clean(args.section, 80)}" only)`;
    }
    const url = link(ctx, path(m.id));
    const lines = [
      `${m.ref}: ${clean(m.title)}`,
      `Kind: ${typeLabel(m.type)}${m.confidential ? " · CONFIDENTIAL" : ""}`,
      `When: ${when(ctx, m.heldAt)}${m.durationMinutes ? ` for ${durationLabel(m.durationMinutes)}` : ""}${m.location ? ` · ${clean(m.location)}` : ""}`,
      `Attendees: ${attendees.length ? attendees.map((a) => `${clean(a.name)}${a.kind === "name" ? " (not in HQ)" : a.kind === "contact" ? " (contact)" : ""}`).join(", ") : "none recorded"}`,
      `Linked to: ${links.length ? links.map((l) => `${clean(l.label ?? "a record you cannot open")} (${KIND_WORD[l.kind] ?? l.kind})`).join(", ") : "nothing"}`,
      `Summary: ${m.summary ? clean(m.summary, LIMITS.long, { multiline: true }) : "none"}`,
      `Decisions: ${m.decisionsText ? clean(m.decisionsText, LIMITS.long, { multiline: true }) : "none recorded"}`,
      actions.length
        ? `Actions: ${actions.map((a) => `${clean(a.title)} (${a.status.replace(/_/g, " ")}, ${a.assigneeName ? clean(a.assigneeName) : "unassigned"}${a.dueDate ? `, due ${day(ctx, a.dueDate)}` : ""}) [task id: ${a.id}]`).join("; ")}`
        : "Actions: none you can see",
      hiddenActionCount > 0 ? `(${hiddenActionCount} more action(s) are assigned to someone else or archived.)` : null,
      `Minutes${minutesNote}:`,
      minutes ? clean(minutes, 8000, { multiline: true }) : "(no minutes recorded)",
      "History (newest first):",
      ...history.map((h) => `  v${h.version} ${when(ctx, h.at)}${h.byName ? `, ${clean(h.byName)}` : ""}${h.via === "mcp" ? " (from a chat app)" : ""}: ${clean(h.summary)}${h.note ? ` (note: ${clean(h.note, 200)})` : ""}`),
    ].filter((l): l is string => !!l);
    return respond("ok", [`Meeting ${m.ref} [id: ${m.id}], version ${m.version}: ${url}`, found.note ?? ""], lines, { id: m.id, ref: m.ref, url, version: m.version });
  },
});

// ── meeting_digest ───────────────────────────────────────────

export const meetingDigest = defineTool({
  name: "meeting_digest",
  title: "Meetings this week",
  description:
    "Answers 'what happened in meetings this week?' in ONE call: the meetings saved in the last 7 days (or `days`), each with its summary, and every open action from meetings with who has it and when it is due (overdue flagged). Use this first for any 'this week' or catch-up question about meetings. Read-only.",
  inputSchema: meetingDigestShape,
  annotations: READ,
  capability: "meetings.read",
  kind: "read",
  handler: async (args, ctx) => {
    const days = args.days ?? 7;
    const t = today(ctx);
    const since = sinceDaysIso(t, days, ctx.staff.timezone);
    const [recent, acts] = await Promise.all([recentMeetings(ctx.db, since, 25), openMeetingActions(ctx.db, { limit: 20, mine: args.mine ? ctx.staff.id : null })]);
    if (!recent.ok || !acts.ok) return dbFailure("meeting_digest", { code: "query" });
    const mine = (m: MeetingRow) => m.createdBy === ctx.staff.id || m.staffAttendeeIds.includes(ctx.staff.id);
    const meetings = recent.data.rows.filter((m) => !args.mine || mine(m));
    const d = digestText(
      meetings.map((m) => ({ ref: m.ref, title: clean(m.title), heldAt: m.heldAt, type: m.type, summary: m.summary ? clean(m.summary, 600, { multiline: true }) : null, attendees: clean(m.attendeeNames, 200), openActions: m.openActions, confidential: m.confidential })),
      acts.data.rows.map((a) => ({ title: clean(a.title), assignee: a.assigneeName ? clean(a.assigneeName) : null, dueDate: a.dueDate, meetingRef: a.meetingRef })),
      { today: t, days, day: (v) => day(ctx, v) },
    );
    const more = acts.data.total > acts.data.rows.length ? ` Showing ${acts.data.rows.length} of ${acts.data.total} open actions.` : "";
    return respond(meetings.length || acts.data.rows.length ? "ok" : "empty", `${d.head}${more} Meetings in HQ: ${link(ctx, "/hq/meetings")}`, d.lines, { meetings: meetings.length, open_actions: acts.data.total });
  },
});

// ── create_meeting ───────────────────────────────────────────

export const createMeeting = defineTool({
  name: "create_meeting",
  title: "Save a meeting",
  description:
    "Saves ONE meeting to Planted HQ from what the person told you or pasted (notes, or a transcript from a recording tool): a title, the kind, when (resolve 'today' or 'last Tuesday' to a real date yourself), how long, where, a TIGHT 2 to 3 line summary, structured minutes (## Agenda, ## Discussion, ## Decisions, ## Next steps), the decisions as short lines, who was there (team members and HQ contacts are matched by name; anyone else is saved as a name), the records it was about (a contact, organisation, lead or contractor: each gets one interaction logged, so 'last contacted' updates), and action items (each becomes a real HQ task, assigned and dated). " +
    NEVER_INVENT +
    " HQ stores the minutes, NOT the transcript: do not paste a raw transcript into the minutes. Recording a conversation can need everyone's consent; that is for the person, not you, to manage. Before calling, show the person the summary, decisions and actions you will save and make sure they want it. If a name matches several people you get candidates and nothing is saved; ask, then call again. Returns the MTG number, the HQ link, the tasks created and where the meeting was logged.",
  inputSchema: createMeetingShape,
  annotations: WRITE,
  capability: "meetings.write",
  kind: "write",
  handler: async (args, ctx) => {
    const w = parseWhen(args.held_at, ctx.staff.timezone);
    if (!w) return respond("invalid", "Not saved: held_at must be a date (YYYY-MM-DD), a local date and time (YYYY-MM-DDTHH:MM) or an ISO time. Nothing was changed.");
    const whenProblem = heldAtProblem(w.iso);
    if (whenProblem) return respond("invalid", `Not saved: ${whenProblem} Nothing was changed.`);
    if ((args.actions?.length ?? 0) > 0 && !can(ctx, "tasks.write")) return respond("refused", "Refused: your HQ role cannot create tasks, so the actions cannot be saved. Save the meeting without actions, or ask a colleague. Nothing was changed.");

    // every name first: nothing is written unless all of them resolve
    const staff = await activeStaff(ctx);
    const attendees: AttendeePick[] = [];
    for (const a of args.attendees ?? []) {
      const r = await resolveAttendee(ctx, a, staff);
      if (!r.ok) return r.result;
      attendees.push(r.value);
    }
    const people = dedupeAttendees(attendees);
    const links: LinkPick[] = [];
    for (const l of args.linked ?? []) {
      const r = await resolveLink(ctx, l);
      if (!r.ok) return r.result;
      links.push(r.value);
    }
    const allLinks = linksWithAttendees(links, people, args.link_attendee_contacts !== false);
    const actions: ResolvedAction[] = [];
    for (const a of args.actions ?? []) {
      const r = await resolveAction(ctx, a);
      if (!r.ok) return r.result;
      actions.push(r.value);
    }
    if (people.length > ATTENDEE_MAX) return respond("invalid", `Not saved: at most ${ATTENDEE_MAX} attendees. Nothing was changed.`);

    const { data, error } = await ctx.db.rpc("create_meeting", {
      p_title: args.title,
      p_type: args.type,
      p_held_at: w.iso,
      p_duration_minutes: args.duration_minutes ?? undefined,
      p_location: args.location ?? undefined,
      p_summary: args.summary,
      p_minutes: args.minutes ?? undefined,
      p_decisions_text: args.decisions?.length ? args.decisions.map((d) => `- ${d}`).join("\n") : undefined,
      p_confidential: args.confidential === true,
      p_attendees: people.map((p) => ("staffId" in p ? { staff_id: p.staffId } : "contactId" in p ? { contact_id: p.contactId } : { name: p.name })),
      p_links: allLinks.map((l) => ({ kind: l.kind, id: l.id })),
      p_actions: actions.map((a) => ({ title: a.title, assignee_id: a.assigneeId, due_date: a.due, priority: a.priority, description: a.description })),
    });
    const out = data as { meeting_id?: string; ref?: string; tasks?: Array<{ task_id: string; title: string; due_date: string | null }>; touch_points?: TouchPoint[] } | null;
    if (error || !out?.meeting_id) return rpcFailure("create_meeting", error);

    const url = link(ctx, path(out.meeting_id));
    const labels = new Map(allLinks.map((l) => [l.id, l.label]));
    const lines = [
      `${out.ref}: ${clean(args.title)}`,
      `Kind: ${typeLabel(args.type)}${args.confidential ? " · CONFIDENTIAL" : ""}`,
      `When: ${when(ctx, w.iso)}${w.timeGiven ? "" : " (no time given: saved at 9:00 am)"}${args.duration_minutes ? ` for ${durationLabel(args.duration_minutes)}` : ""}${args.location ? ` · ${clean(args.location)}` : ""}`,
      `Attendees: ${people.length ? people.map((p) => `${clean(p.label)}${"name" in p ? " (saved as a name, not in HQ)" : "contactId" in p ? " (contact)" : ""}`).join(", ") : "none recorded"}`,
      `Summary: ${clean(args.summary, LIMITS.medium, { multiline: true })}`,
      args.decisions?.length ? `Decisions: ${args.decisions.map((d) => clean(d, 200)).join("; ")}` : null,
      ...(actions.length ? [`Tasks created: ${actions.map((a) => `${clean(a.title)} (${clean(a.assigneeLabel)}${a.due ? `, due ${day(ctx, a.due)}` : ""})`).join("; ")}`] : ["Tasks created: none"]),
      ...touchLines(out.touch_points ?? [], labels),
    ].filter((l): l is string => !!l);
    return respond(
      "ok",
      `Saved meeting ${out.ref} [id: ${out.meeting_id}]${args.confidential ? " as CONFIDENTIAL" : ""}: ${url}`,
      lines,
      { id: out.meeting_id, ref: out.ref, url, created: "meeting", task_ids: (out.tasks ?? []).map((t) => t.task_id), touch_points: (out.touch_points ?? []).filter((t) => t.change === "created").length },
      "Tell the person what was saved. Only the minutes and summary were stored, not any transcript.",
    );
  },
});

// ── update_meeting ───────────────────────────────────────────

const NONE = /^(none|clear|remove)$/i;

export const updateMeeting = defineTool({
  name: "update_meeting",
  title: "Update a meeting",
  description:
    "Changes ONE meeting, found by its number (MTG-0001), id or exact title: its summary, minutes (whole, or one targeted minutes_edit such as append_section or replace_text, so you do not resend long minutes), decisions, title, kind, when, duration, location, attendees (add or remove), linked records (add or remove), or whether it is confidential. A change_note is required; every change is a new version in the meeting's history (old minutes stay readable). Read it first with get_meeting and pass its version as expected_version. " +
    NEVER_INVENT +
    " Before calling, say what will change and make sure the person wants it. It never archives or deletes a meeting.",
  inputSchema: updateMeetingShape,
  annotations: WRITE,
  capability: "meetings.write",
  kind: "write",
  handler: async (args, ctx) => {
    const found = await resolveMeeting(ctx, args.meeting, "write");
    if (!found.ok) return found.result;
    const cur = found.meeting;
    const url = link(ctx, path(cur.id));
    if (args.expected_version !== undefined && args.expected_version !== cur.version) {
      return respond("refused", `Not changed: ${cur.ref} is now at version ${cur.version}, not version ${args.expected_version}: someone changed it since. Read it again with get_meeting, then make the change on the newest version. ${url}`, null, { code: "stale", version: cur.version });
    }
    if (args.minutes !== undefined && args.minutes_edit) return respond("invalid", "Not changed: send either minutes (the whole text) or minutes_edit (one change), not both.");

    let minutes: string | undefined;
    if (args.minutes !== undefined) minutes = args.minutes;
    else if (args.minutes_edit) {
      const e = args.minutes_edit;
      const r = applyEdit(cur.minutes ?? "", { op: e.op as EditOp, heading: e.heading, text: e.text, oldText: e.old_text, newText: e.new_text });
      if (!r.ok) return respond("invalid", `Not changed: ${r.message}`, null, { code: "edit" });
      minutes = r.body;
    }
    let held: string | undefined;
    if (args.held_at) {
      const w = parseWhen(args.held_at, ctx.staff.timezone);
      if (!w) return respond("invalid", "Not changed: held_at must be a date (YYYY-MM-DD), a local date and time (YYYY-MM-DDTHH:MM) or an ISO time.");
      const p = heldAtProblem(w.iso);
      if (p) return respond("invalid", `Not changed: ${p}`);
      held = w.iso;
    }

    // resolve every name before writing anything
    const staff = args.add_attendees?.length ? await activeStaff(ctx) : [];
    const addPeople: AttendeePick[] = [];
    for (const a of args.add_attendees ?? []) {
      const r = await resolveAttendee(ctx, a, staff);
      if (!r.ok) return r.result;
      addPeople.push(r.value);
    }
    const addLinks: LinkPick[] = [];
    for (const l of args.add_links ?? []) {
      const r = await resolveLink(ctx, l);
      if (!r.ok) return r.result;
      addLinks.push(r.value);
    }
    const removeLinks: LinkPick[] = [];
    for (const l of args.remove_links ?? []) {
      const r = await resolveLink(ctx, l);
      if (!r.ok) return r.result;
      removeLinks.push(r.value);
    }
    let detail = null as Awaited<ReturnType<typeof loadMeeting>> | null;
    const removeIds: Array<{ id: number; name: string }> = [];
    const notAttendees: string[] = [];
    if (args.remove_attendees?.length) {
      detail = await loadMeeting(ctx.db, cur.id, { historyLimit: 1 });
      if (!detail.ok || !detail.data) return dbFailure("update_meeting attendees", { code: "query" });
      for (const n of args.remove_attendees) {
        const k = normaliseName(n);
        const hits = detail.data.attendees.filter((a) => normaliseName(a.name) === k || (/^(me|myself|i)$/i.test(n) && a.recordId === ctx.staff.id));
        if (hits.length === 0) notAttendees.push(n);
        else removeIds.push(...hits.map((h) => ({ id: h.id, name: h.name })));
      }
    }

    const clear: string[] = [];
    const location = args.location === undefined ? undefined : NONE.test(args.location) ? (clear.push("location"), undefined) : args.location;
    let decisions: string | undefined;
    if (args.decisions !== undefined) {
      if (args.decisions.length === 0) clear.push("decisions_text");
      else decisions = args.decisions.map((d) => `- ${d}`).join("\n");
    }
    const content =
      args.title !== undefined || args.type !== undefined || held !== undefined || args.duration_minutes !== undefined || location !== undefined || args.summary !== undefined ||
      minutes !== undefined || decisions !== undefined || args.confidential !== undefined || clear.length > 0;
    if (!content && !addPeople.length && !removeIds.length && !addLinks.length && !removeLinks.length) {
      return respond(notAttendees.length ? "invalid" : "unchanged", notAttendees.length ? `Not changed: ${plural(notAttendees.length, "name")} given to remove ${notAttendees.length === 1 ? "is" : "are"} not an attendee of ${cur.ref}.` : `Nothing to change on ${cur.ref}. ${url}`, notAttendees.length ? [`Not attendees: ${notAttendees.map((n) => clean(n, 80)).join(", ")}`] : null, { id: cur.id });
    }

    const done: string[] = [];
    let changedFields: string[] = [];
    if (content) {
      const { data, error } = await ctx.db.rpc("update_meeting", {
        p_meeting: cur.id,
        p_expected_version: args.expected_version ?? cur.version,
        p_title: args.title ?? undefined,
        p_type: args.type ?? undefined,
        p_held_at: held,
        p_duration_minutes: args.duration_minutes ?? undefined,
        p_location: location,
        p_summary: args.summary ?? undefined,
        p_minutes: minutes,
        p_decisions_text: decisions,
        p_confidential: args.confidential ?? undefined,
        p_clear: clear.length ? clear : undefined,
        p_change_note: args.change_note,
      });
      if (error) return rpcFailure("update_meeting", error);
      const out = data as { changed?: boolean; changed_fields?: string[] } | null;
      changedFields = out?.changed_fields ?? [];
      if (changedFields.includes("title")) done.push(changeLine("Title", cur.title, args.title));
      if (changedFields.includes("summary")) done.push(changeLine("Summary", summaryExcerpt(cur.summary, 200), summaryExcerpt(args.summary, 200)));
      if (changedFields.includes("minutes")) done.push(`Minutes: changed (${(cur.minutes ?? "").length} -> ${(minutes ?? "").length} characters; the old minutes stay in the history)`);
      if (changedFields.includes("decisions_text")) done.push("Decisions: replaced");
      if (changedFields.includes("held_at")) done.push(changeLine("When", when(ctx, cur.heldAt), held ? when(ctx, held) : ""));
      if (changedFields.includes("meeting_type")) done.push(changeLine("Kind", typeLabel(cur.type), args.type ? typeLabel(args.type) : ""));
      if (changedFields.includes("location")) done.push(changeLine("Where", cur.location, location ?? null));
      if (changedFields.includes("duration_minutes")) done.push(changeLine("Duration", durationLabel(cur.durationMinutes), durationLabel(args.duration_minutes)));
      if (changedFields.includes("confidential")) done.push(args.confidential ? "Now CONFIDENTIAL" : "Now visible to the team");
    }
    const step = async (fn: string, params: Record<string, unknown>, label: string): Promise<ToolResult | null> => {
      const { data, error } = await (ctx.db.rpc as unknown as (f: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string | null; message?: string | null; hint?: string | null } | null }>)(fn, params);
      if (error) {
        const r = rpcFailure(fn, error);
        return { ...r, text: done.length ? `${r.text}\n\nAlready saved before this: ${done.join("; ")}.` : r.text };
      }
      if ((data as { changed?: boolean } | null)?.changed !== false) done.push(label);
      return null;
    };
    for (const p of addPeople) {
      const f = await step("add_meeting_attendee", "staffId" in p ? { p_meeting: cur.id, p_staff: p.staffId } : "contactId" in p ? { p_meeting: cur.id, p_contact: p.contactId } : { p_meeting: cur.id, p_name: p.name }, `Added attendee ${clean(p.label)}`);
      if (f) return f;
      if ("contactId" in p) {
        const g = await step("link_meeting", { p_meeting: cur.id, p_kind: "contact", p_id: p.contactId }, `Linked contact ${clean(p.label)}`);
        if (g) return g;
      }
    }
    for (const a of removeIds) {
      const f = await step("remove_meeting_attendee", { p_meeting: cur.id, p_attendee: a.id }, `Removed attendee ${clean(a.name)}`);
      if (f) return f;
    }
    for (const l of addLinks) {
      const f = await step("link_meeting", { p_meeting: cur.id, p_kind: l.kind, p_id: l.id }, `Linked ${KIND_WORD[l.kind]} ${clean(l.label)} (one interaction logged)`);
      if (f) return f;
    }
    for (const l of removeLinks) {
      const f = await step("unlink_meeting", { p_meeting: cur.id, p_kind: l.kind, p_id: l.id }, `Unlinked ${KIND_WORD[l.kind]} ${clean(l.label)}`);
      if (f) return f;
    }
    if (done.length === 0) return respond("unchanged", `Nothing to change: ${cur.ref} already has those values. ${url}`, [`Meeting: ${cur.ref} ${clean(cur.title)}`], { id: cur.id, url });
    const lines = [`Meeting: ${cur.ref} ${clean(args.title ?? cur.title)}`, ...done, `Change note: ${clean(args.change_note, 300)}`, ...(notAttendees.length ? [`Not attendees, so not removed: ${notAttendees.map((n) => clean(n, 80)).join(", ")}`] : [])];
    return respond("ok", `Updated meeting ${cur.ref} [id: ${cur.id}]: ${url}`, lines, { id: cur.id, ref: cur.ref, url, changed: changedFields });
  },
});

// ── add_meeting_action ───────────────────────────────────────

export const addMeetingAction = defineTool({
  name: "add_meeting_action",
  title: "Add an action to a meeting",
  description:
    "Adds ONE action item to a meeting (by MTG-0001, id or exact title) as a real HQ task: what to do, who does it (\"me\" by default, or an active team member by name), when it is due and how urgent. For example 'Add an action to MTG-0001: Courtney to call Tim next Tuesday'. Only actions the person stated; never guess who or when. Before calling, say what will be created.",
  inputSchema: addMeetingActionShape,
  annotations: WRITE,
  capability: "meetings.write",
  kind: "write",
  handler: async (args, ctx) => {
    if (!can(ctx, "tasks.write")) return respond("refused", "Refused: your HQ role cannot create tasks. Nothing was changed.");
    const found = await resolveMeeting(ctx, args.meeting, "write");
    if (!found.ok) return found.result;
    const a = await resolveAction(ctx, { title: args.title, assignee: args.assignee, due: args.due, priority: args.priority, description: args.description });
    if (!a.ok) return a.result;
    const m = found.meeting;
    const { data, error } = await ctx.db.rpc("add_meeting_action", {
      p_meeting: m.id,
      p_title: a.value.title,
      p_assignee: a.value.assigneeId,
      p_due_date: a.value.due ?? undefined,
      p_priority: a.value.priority as "low" | "normal" | "high" | "urgent",
      p_description: a.value.description ?? undefined,
    });
    const out = data as { task?: { task_id?: string } } | null;
    if (error || !out?.task?.task_id) return rpcFailure("add_meeting_action", error);
    const taskUrl = link(ctx, `/hq/operations/tasks/${out.task.task_id}`);
    return respond(
      "ok",
      `Added an action to ${m.ref} [task id: ${out.task.task_id}]: ${taskUrl}`,
      [`Meeting: ${m.ref} ${clean(m.title)}`, `Task: ${clean(a.value.title)}`, `Assigned to: ${clean(a.value.assigneeLabel)}`, `Due: ${a.value.due ? day(ctx, a.value.due) : "no due date"}`, `Priority: ${a.value.priority}`],
      { id: out.task.task_id, meeting_id: m.id, url: taskUrl, created: "task" },
    );
  },
});

// ── promote_meeting_decision ─────────────────────────────────

export const promoteMeetingDecision = defineTool({
  name: "promote_meeting_decision",
  title: "Add a meeting decision to the Decisions register",
  description:
    "Records ONE decision made at a meeting in the HQ Business Decisions Register (as create_decision does: title, category, optional detail and reasons; dated the meeting day unless given) and links it to the meeting. Only a decision the person actually stated. Needs the right to write decisions (directors and administrators). Before calling, say what will be recorded.",
  inputSchema: promoteMeetingDecisionShape,
  annotations: WRITE,
  capability: "decisions.write",
  kind: "write",
  handler: async (args, ctx) => {
    if (!can(ctx, "meetings.write")) return respond("refused", "Refused: your HQ role does not include meetings.write, which this needs as well. Nothing was changed.");
    const found = await resolveMeeting(ctx, args.meeting, "write");
    if (!found.ok) return found.result;
    const m = found.meeting;
    const { data, error } = await ctx.db.rpc("promote_decision_to_register", {
      p_meeting: m.id,
      p_title: args.title,
      p_category: args.category,
      p_description: args.description ?? undefined,
      p_rationale: args.rationale ?? undefined,
      p_decision_date: args.decision_date ?? undefined,
      p_status: args.status ?? undefined,
    });
    const out = data as { decision?: { decision_id?: string; ref?: string; decision_date?: string } } | null;
    if (error || !out?.decision?.decision_id) return rpcFailure("promote_decision_to_register", error);
    const url = link(ctx, `/hq/decisions/${out.decision.decision_id}`);
    return respond(
      "ok",
      `Recorded decision ${out.decision.ref} [id: ${out.decision.decision_id}] from ${m.ref}: ${url}`,
      [`Decision: ${out.decision.ref} ${clean(args.title)}`, `From meeting: ${m.ref} ${clean(m.title)}`, out.decision.decision_date ? `Dated: ${day(ctx, out.decision.decision_date)}` : null].filter((l): l is string => !!l),
      { id: out.decision.decision_id, ref: out.decision.ref, url, meeting_id: m.id, created: "decision" },
    );
  },
});
