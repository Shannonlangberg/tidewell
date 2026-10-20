// Run with: npm test   (node --test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FormReader } from "../forms.ts";
import { CAPABILITIES } from "../constants.ts";
import {
  MEETING_TYPES,
  MEETING_TYPE_LABEL,
  attendeeKey,
  attendeesJson,
  dedupeAttendees,
  dedupeLinks,
  digestText,
  dueDateProblem,
  durationLabel,
  heldAtProblem,
  linkKindFor,
  linksWithAttendees,
  localParts,
  meetingRef,
  parseMeetingListQuery,
  parseMeetingRef,
  parseNameList,
  parseWhen,
  readActionRows,
  readMeetingFields,
  sortActions,
  summaryExcerpt,
  touchPointType,
  uuidList,
  zonedIso,
  type AttendeePick,
} from "./rules.ts";

const MIGRATION = readFileSync(new URL("../../../supabase/migrations/0140_hq_meetings.sql", import.meta.url), "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const TZ = "Australia/Adelaide";

const form = (values: Record<string, string | string[]>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
};

test("the meeting types match hq.meeting_type in migration 0140, and every one has a label", () => {
  const m = /create type hq\.meeting_type as enum \(([^)]*)\)/.exec(MIGRATION);
  assert.ok(m);
  assert.deepEqual([...MEETING_TYPES], [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  for (const t of MEETING_TYPES) assert.ok(MEETING_TYPE_LABEL[t]);
  for (const c of ["meetings.read", "meetings.write"]) assert.ok((CAPABILITIES as readonly string[]).includes(c), c);
});

test("refs: MTG-0001 out, several spoken forms in, never a guess", () => {
  assert.equal(meetingRef(1), "MTG-0001");
  assert.equal(meetingRef(123456), "MTG-123456");
  assert.equal(meetingRef(null), "");
  assert.equal(parseMeetingRef("MTG-0007"), 7);
  assert.equal(parseMeetingRef(" mtg 7 "), 7);
  assert.equal(parseMeetingRef("meeting #12"), 12);
  assert.equal(parseMeetingRef("MTG-0"), null);
  assert.equal(parseMeetingRef("coffee with Tim"), null);
  assert.equal(parseMeetingRef("DEC-0001"), null);
});

test("local date and time in Adelaide become the right instant, both sides of daylight saving", () => {
  // 20 Oct 2026 is daylight time (UTC+10:30); 20 May 2026 is standard time (UTC+9:30)
  assert.equal(zonedIso("2026-10-20", "09:30", TZ), "2026-10-19T23:00:00.000Z");
  assert.equal(zonedIso("2026-05-20", "09:30", TZ), "2026-05-20T00:00:00.000Z");
  assert.deepEqual(localParts("2026-10-19T23:00:00.000Z", TZ), { date: "2026-10-20", time: "09:30" });
  assert.equal(zonedIso("2026-02-30", "09:00", TZ), null);
  assert.equal(zonedIso("2026-10-20", "25:00", TZ), null);
  assert.deepEqual(localParts("not a date", TZ), { date: "", time: "" });
});

test("parseWhen: a day, a local time, or an ISO instant; a day alone is saved at 9:00 am", () => {
  assert.deepEqual(parseWhen("2026-10-20", TZ), { iso: "2026-10-19T22:30:00.000Z", timeGiven: false });
  assert.deepEqual(parseWhen("2026-10-20T14:30", TZ), { iso: "2026-10-20T04:00:00.000Z", timeGiven: true });
  assert.deepEqual(parseWhen("2026-10-20 14:30", TZ), { iso: "2026-10-20T04:00:00.000Z", timeGiven: true });
  assert.deepEqual(parseWhen("2026-10-20T04:00:00Z", TZ), { iso: "2026-10-20T04:00:00.000Z", timeGiven: true });
  assert.deepEqual(parseWhen("2026-10-20T14:30:00+10:30", TZ), { iso: "2026-10-20T04:00:00.000Z", timeGiven: true });
  assert.equal(parseWhen("last Tuesday", TZ), null);
  assert.equal(parseWhen("", TZ), null);
});

test("a meeting is recorded after it happens: at most a day ahead, not before 2000", () => {
  const now = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(heldAtProblem("2026-10-20T12:00:00Z", now), null);
  assert.match(heldAtProblem("2026-10-22T00:00:00Z", now) ?? "", /at most a day ahead/);
  assert.match(heldAtProblem("1999-12-31T00:00:00Z", now) ?? "", /too far in the past/);
  assert.match(heldAtProblem("nonsense", now) ?? "", /valid date/);
  assert.equal(dueDateProblem("2026-10-24", "2026-10-20"), null);
  assert.match(dueDateProblem("2029-01-01", "2026-10-20") ?? "", /two years/);
  assert.match(dueDateProblem("2026-13-01", "2026-10-20") ?? "", /valid date/);
});

test("the touch-point type follows the location, as the database does", () => {
  assert.equal(touchPointType("Coffee at Kadina"), "coffee_meeting");
  assert.equal(touchPointType("Café Moonta"), "coffee_meeting");
  assert.equal(touchPointType("Phone"), "phone_call");
  assert.equal(touchPointType("Video call"), "phone_call");
  assert.equal(touchPointType("Zoom"), "office_meeting");
  assert.equal(touchPointType(null), "office_meeting");
  assert.match(MIGRATION, /coffee\|caf\[eé\]/);
  assert.match(MIGRATION, /\\m\(phone\|call\)\\M/);
});

test("durations and summaries read well", () => {
  assert.equal(durationLabel(45), "45 min");
  assert.equal(durationLabel(60), "1 hr");
  assert.equal(durationLabel(90), "1 hr 30 min");
  assert.equal(durationLabel(null), "");
  assert.equal(summaryExcerpt("## Summary\n- Alice will refer two landlords.\n- We send fees.\n- Third.\n- Fourth."), "Summary Alice will refer two landlords. We send fees.");
  assert.equal(summaryExcerpt("x".repeat(300), 20).length, 20);
  assert.equal(summaryExcerpt(null), "");
});

test("typed names: one per line or comma, trimmed, duplicates (any case) dropped, long ones refused", () => {
  const r = parseNameList("Tim from the bank\n tim FROM the   bank ;  Jo Smith,\n\n" + "x".repeat(121));
  assert.deepEqual(r.names, ["Tim from the bank", "Jo Smith"]);
  assert.equal(r.tooLong, true);
  assert.equal(r.tooMany, false);
  assert.equal(parseNameList(Array.from({ length: 45 }, (_, i) => `P${i}`).join("\n")).tooMany, true);
});

test("attendees: one per person, and contacts who attended are linked unless told not to", () => {
  const list: AttendeePick[] = [
    { staffId: A, label: "Courtney" },
    { staffId: A.toUpperCase(), label: "Courtney again" },
    { contactId: B, label: "Tim Hosking" },
    { name: "Bank  Manager", label: "Bank Manager" },
    { name: "bank manager", label: "bank manager" },
  ];
  const d = dedupeAttendees(list);
  assert.equal(d.length, 3);
  assert.equal(attendeeKey({ name: " Bank   Manager ", label: "" }), "n:bank manager");
  assert.deepEqual(attendeesJson(list), [{ staff_id: A }, { contact_id: B }, { name: "Bank  Manager" }]);
  const links = linksWithAttendees([{ kind: "organisation", id: A, label: "eXp Realty" }, { kind: "contact", id: B, label: "Tim" }], d);
  assert.deepEqual(links.map((l) => `${l.kind}:${l.id}`), [`organisation:${A}`, `contact:${B}`]);
  assert.equal(linksWithAttendees([], d, false).length, 0);
  assert.equal(dedupeLinks(Array.from({ length: 30 }, (_, i) => ({ kind: "contact" as const, id: `${i}`, label: "" }))).length, 20);
});

test("the words people use for records map to link kinds", () => {
  assert.equal(linkKindFor("lead"), "opportunity");
  assert.equal(linkKindFor("Prospects"), "opportunity");
  assert.equal(linkKindFor("agency"), "organisation");
  assert.equal(linkKindFor("partner"), "organisation");
  assert.equal(linkKindFor("tradie"), "contractor");
  assert.equal(linkKindFor("contact"), "contact");
  assert.equal(linkKindFor("spaceship"), null);
});

test("the HQ form: fields read in the person's timezone, with plain errors", () => {
  const now = Date.parse("2026-10-20T06:00:00Z");
  const okForm = form({ title: " Coffee with Tim ", meeting_type: "partner_referral", held_date: "2026-10-20", held_time: "14:30", duration_minutes: "45", location: "Coffee at Kadina", summary: "We agreed referrals.", minutes: "## Agenda\r\n- Referrals", confidential: "on" });
  const ok = new FormReader(okForm);
  const v = readMeetingFields(ok, okForm, TZ, now);
  assert.equal(ok.ok, true);
  assert.equal(v.title, "Coffee with Tim");
  assert.equal(v.heldAt, "2026-10-20T04:00:00.000Z");
  assert.equal(v.durationMinutes, 45);
  assert.equal(v.minutes, "## Agenda\n- Referrals");
  assert.equal(v.confidential, true);

  const badForm = form({ title: "", meeting_type: "party", held_date: "2026-10-25", duration_minutes: "0", summary: "" });
  const bad = new FormReader(badForm);
  readMeetingFields(bad, badForm, TZ, now);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.title && bad.errors.meeting_type && bad.errors.held_date && bad.errors.duration_minutes && bad.errors.summary);
  assert.match(bad.errors.held_date, /at most a day ahead/);

  const noTimeForm = form({ title: "t", meeting_type: "other", held_date: "2026-10-19", summary: "s" });
  const noTime = new FormReader(noTimeForm);
  assert.equal(readMeetingFields(noTime, noTimeForm, TZ, now).heldAt, "2026-10-18T22:30:00.000Z");
});

test("action rows: a titled row is checked, an empty row is skipped, a half row is refused", () => {
  const errors: Record<string, string> = {};
  const rows = readActionRows(
    form({ action_title_1: "Send the fee schedule", action_assignee_1: A, action_due_1: "2026-10-23", action_title_2: "", action_due_3: "2026-10-23", action_title_4: "Far away", action_due_4: "2030-01-01" }),
    4,
    "2026-10-20",
    errors,
  );
  assert.deepEqual(rows[0], { title: "Send the fee schedule", assigneeId: A, dueDate: "2026-10-23" });
  assert.equal(rows.length, 2);
  assert.match(errors.action_title_3, /title/);
  assert.match(errors.action_due_4, /two years/);
  assert.equal(errors.action_title_1, undefined);
  assert.deepEqual(uuidList(form({ staff: [A, A.toUpperCase(), "nope", B] }), "staff"), [A, B]);
});

test("the list's URL: every filter checked, anything malformed dropped", () => {
  const q = parseMeetingListQuery({ q: " tim\u0000 ", type: "contractor", from: "2026-10-30", to: "2026-10-01", person: A, org: "x", open: "1", mine: "0", page: "3" });
  assert.equal(q.q, "tim");
  assert.equal(q.type, "contractor");
  assert.equal(q.from, "2026-10-01");
  assert.equal(q.to, "2026-10-30");
  assert.equal(q.person, A);
  assert.equal(q.org, null);
  assert.equal(q.open, true);
  assert.equal(q.mine, false);
  assert.equal(q.page, 3);
  assert.equal(q.moreActive, true);
  const none = parseMeetingListQuery({ type: "party", page: "-4" });
  assert.equal(none.type, null);
  assert.equal(none.page, 1);
  assert.equal(none.filtered, false);
});

test("the digest says what happened in plain words, overdue first among actions", () => {
  const day = (v: string) => v.slice(0, 10);
  const d = digestText(
    [
      { ref: "MTG-0002", title: "Coffee with Tim", heldAt: "2026-10-19T23:00:00Z", type: "partner_referral", summary: "Tim will refer two landlords.\nWe send fees.", attendees: "Courtney, Tim Hosking", openActions: 1, confidential: false },
      { ref: "MTG-0001", title: "Team catch-up", heldAt: "2026-10-16T23:00:00Z", type: "internal_team", summary: null, attendees: "", openActions: 0, confidential: true },
    ],
    sortActions([
      { title: "Send fee schedule", assignee: "Courtney", dueDate: "2026-10-23", meetingRef: "MTG-0002" },
      { title: "Book the photographer", assignee: null, dueDate: null, meetingRef: "MTG-0001" },
      { title: "Call the bank", assignee: "Shannon", dueDate: "2026-10-18", meetingRef: "MTG-0001" },
    ]),
    { today: "2026-10-20", days: 7, day },
  );
  assert.equal(d.head, "2 meetings recorded in the last 7 days; 3 open actions from meetings (1 overdue).");
  assert.deepEqual(d.lines, [
    "Meetings (newest first):",
    "- 2026-10-19: MTG-0002 Coffee with Tim with Courtney, Tim Hosking (1 open action)",
    "  Tim will refer two landlords. We send fees.",
    "- 2026-10-16: MTG-0001 Team catch-up [confidential]",
    "Open actions (soonest due first):",
    "- Call the bank (Shannon, OVERDUE, was due 2026-10-18; from MTG-0001)",
    "- Send fee schedule (Courtney, due 2026-10-23; from MTG-0002)",
    "- Book the photographer (unassigned, no due date; from MTG-0001)",
  ]);
  assert.equal(digestText([], [], { today: "2026-10-20", days: 7, day }).head, "No meetings recorded in the last 7 days, and no open actions from meetings.");
  assert.equal(digestText([], [{ title: "x", assignee: null, dueDate: null, meetingRef: "MTG-0001" }], { today: "2026-10-20", days: 14, day }).head, "No meetings recorded in the last 14 days; 1 open action from meetings.");
});
