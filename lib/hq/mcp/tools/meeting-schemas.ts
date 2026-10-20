/*
 * Input schemas for the Meetings MCP tools (zod raw shapes). Imports only zod: the enum lists are
 * written out and pinned to lib/hq/meetings/rules.ts and lib/hq/knowledge/edits.ts by
 * meeting-schemas.test.mts.
 */
import { z } from "zod";

export const MEETING_TYPE_VALUES = ["partner_referral", "internal_team", "contractor", "landlord_owner", "supplier_other", "planning_strategy", "other"] as const;
/** Records a meeting can be linked to from chat (decisions go through promote_meeting_decision). */
export const MEETING_LINK_KIND_VALUES = ["contact", "organisation", "lead", "contractor"] as const;
export const MEETING_ATTENDEE_KIND_VALUES = ["staff", "contact", "external"] as const;
export const MINUTES_EDIT_OP_VALUES = ["replace_text", "append_section", "add_to_section", "replace_section"] as const;
export const ACTION_PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;
export const DECISION_CATEGORY_VALUES_FOR_MEETINGS = ["strategy", "finance", "people", "operations", "partners", "marketing", "technology", "legal_compliance", "service_offering", "other"] as const;
export const OPEN_DECISION_STATUS_VALUES_FOR_MEETINGS = ["proposed", "decided", "in_effect"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_TEXT =
  "partner_referral (a referral partner: agent, broker, conveyancer ...), internal_team (the PLANTED. team), contractor (a trade or contractor), landlord_owner (a landlord or property owner), supplier_other (a supplier or other business), planning_strategy (planning or strategy), other";

const meeting = (what: string) =>
  z.string().trim().min(1).max(200).describe(`${what}: its number as HQ shows it (MTG-0001), its id from an earlier result, or words of its title (if several match you get candidates to choose from).`);
const limit = z.number().int().min(1).max(25).optional().describe("Optional. How many rows to return, 1 to 25 (default 10).");
const optDate = (what: string) => z.string().regex(DATE, "Use YYYY-MM-DD.").optional().describe(`${what} (YYYY-MM-DD, in the person's own timezone).`);
const when = z
  .string()
  .trim()
  .min(10)
  .max(40)
  .describe(
    "When the meeting was held. Work out the real date yourself from what the person said ('today', 'last Tuesday') and send it as YYYY-MM-DD, or YYYY-MM-DDTHH:MM for a time in the person's own timezone (or a full ISO time with an offset). If they did not say the time, send only the date (HQ saves it at 9:00 am). At most a day ahead: meetings are recorded after they happen.",
  );

const attendee = z.union([
  z.string().trim().min(1).max(120).describe('A person who was there: "me", a team member\'s name, a contact\'s name, or any other name.'),
  z
    .object({
      name: z.string().trim().min(1).max(120).describe("The person's name as it was said."),
      kind: z
        .enum(MEETING_ATTENDEE_KIND_VALUES)
        .optional()
        .describe("Optional. staff (a PLANTED. team member), contact (someone in HQ's contacts) or external (save just the name; use this for someone not in HQ, or when the person says the suggested match is wrong)."),
      id: z.string().trim().max(60).optional().describe("Optional. The staff or contact id from an earlier result (after a candidates list)."),
    })
    .describe("A person who was there, with how to match them."),
]);

const linked = z
  .object({
    kind: z.enum(MEETING_LINK_KIND_VALUES).describe("What kind of record: contact (a person in HQ), organisation (an agency, broker or other business), lead (a landlord prospect in the pipeline: a name, LEAD-0001 or REF-0001), contractor."),
    name: z.string().trim().min(1).max(200).describe("The record's name, number or id as the person said it (if several match you get candidates and nothing is saved)."),
  })
  .describe("A record the meeting was about. Each linked contact, organisation, lead and contractor gets ONE normal interaction logged on it (so 'last contacted' updates).");

const action = z
  .object({
    title: z.string().trim().min(1).max(200).describe("The action in a few words, as the person said it (for example 'Send Tim our fee schedule')."),
    assignee: z.string().trim().max(200).optional().describe('Optional. Who will do it: "me" (default), or an active team member\'s name or id. Never guess: if the person did not say who, use "me" only when they said "I will".'),
    due: optDate("Optional. When it is due, as the person said it ('by Friday' -> that Friday's date)"),
    priority: z.enum(ACTION_PRIORITY_VALUES).optional().describe("Optional. low, normal (default), high or urgent."),
    description: z.string().trim().max(2000).optional().describe("Optional. Any detail the person gave (at most 2000 characters)."),
  })
  .describe("An action item. Each becomes a real HQ task, assigned and dated, linked to the meeting.");

const MINUTES_TEXT =
    "The minutes, at most 50,000 characters, in this markdown subset: ## headings, paragraphs, - bullet lists, 1. numbered lists, - [ ] checklists, **bold**. Structure them under ## Agenda, ## Discussion, ## Decisions and ## Next steps. Write them only from what the person said or pasted: never add facts, names, figures, promises or decisions they did not state. Do NOT paste a raw transcript: HQ stores minutes, not transcripts.";
const minutesText = z.string().min(1).max(50_000);

export const createMeetingShape = {
  title: z.string().trim().min(1).max(200).describe("A short title, for example 'Coffee with Tim Hosking, eXp Realty' (at most 200 characters)."),
  type: z.enum(MEETING_TYPE_VALUES).describe(`The kind of meeting: ${TYPE_TEXT}.`),
  held_at: when,
  duration_minutes: z.number().int().min(1).max(1440).optional().describe("Optional. How long it was, in minutes, if the person said."),
  location: z.string().trim().max(200).optional().describe("Optional. Where, in a few words: 'Coffee at Kadina', 'Phone', 'Zoom', 'Our office'. A location saying coffee or cafe logs it as a coffee meeting; phone or call as a phone call."),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("Required. A tight summary of 2 to 3 short lines: what the meeting was about and what came out of it. This is what HQ shows in lists and on Today. Only what was said."),
  minutes: minutesText.optional().describe(`Optional. ${MINUTES_TEXT}`),
  decisions: z.array(z.string().trim().min(1).max(300)).max(20).optional().describe("Optional. What was decided, one short line each (at most 20), only decisions the person actually stated."),
  attendees: z.array(attendee).max(40).optional().describe('Optional. Who was there (at most 40). Team members and HQ contacts are matched by name; anyone else is saved as a name. Include "me" if the person was there (they usually were).'),
  linked: z.array(linked).max(20).optional().describe("Optional. The records the meeting was about (at most 20), for example the agency and the lead discussed."),
  actions: z.array(action).max(20).optional().describe("Optional. Action items (at most 20). Each becomes a real task."),
  confidential: z.boolean().optional().describe("Optional. true only when the person says the meeting is confidential: then only its team attendees, the person saving it, and directors and administrators can see it, and partner timelines show no details."),
  link_attendee_contacts: z.boolean().optional().describe("Optional. Default true: each attendee who is an HQ contact is also linked, so the meeting is logged on their record."),
};

export const getMeetingShape = {
  meeting: meeting("The meeting"),
  section: z.string().trim().min(1).max(200).optional().describe("Optional. Return only this section of the minutes (a heading such as Discussion), for long minutes."),
};

export const listMeetingsShape = {
  since: optDate("Optional. Only meetings held on or after this day"),
  until: optDate("Optional. Only meetings held on or before this day"),
  type: z.enum(MEETING_TYPE_VALUES).optional().describe("Optional. Only this kind of meeting."),
  with: z.string().trim().min(1).max(200).optional().describe("Optional. Only meetings with this person or business: a team member, a contact or an organisation, by name (several matches return candidates)."),
  has_open_actions: z.boolean().optional().describe("Optional. true: only meetings that still have open actions."),
  mine: z.boolean().optional().describe("Optional. true: only meetings you recorded or attended."),
  limit,
};

export const searchMeetingsShape = {
  query: z.string().trim().min(2).max(100).describe("Words to find in a meeting's title, summary, minutes, decisions, attendees or linked records (2 to 100 characters), or a number like MTG-0001."),
  limit,
};

export const updateMeetingShape = {
  meeting: meeting("The meeting to change"),
  change_note: z.string().trim().min(1).max(300).describe("Required. A short note saying what changed and why (at most 300 characters), kept in the meeting's history."),
  expected_version: z.number().int().min(1).optional().describe("Optional but recommended: the version you read with get_meeting. If someone changed the meeting since, nothing is changed and you are told to read it again."),
  title: z.string().trim().min(1).max(200).optional().describe("Optional. A new title."),
  type: z.enum(MEETING_TYPE_VALUES).optional().describe("Optional. A different kind of meeting."),
  held_at: when.optional().describe("Optional. A corrected date or time, in the same form as create_meeting's held_at."),
  duration_minutes: z.number().int().min(1).max(1440).optional().describe("Optional. A corrected duration in minutes."),
  location: z.string().trim().max(200).optional().describe('Optional. A new location, or "none" to clear it.'),
  summary: z.string().trim().min(1).max(2000).optional().describe("Optional. A new 2 to 3 line summary (the old one is kept in the history)."),
  minutes: minutesText.optional().describe("Optional. The WHOLE new minutes, replacing the current ones. For a small change use minutes_edit instead, so you do not resend everything."),
  minutes_edit: z
    .object({
      op: z
        .enum(MINUTES_EDIT_OP_VALUES)
        .describe("replace_text: exactly one occurrence of old_text becomes new_text. append_section: a new '## heading' section at the end. add_to_section: text added at the end of an existing section. replace_section: the content under an existing heading is replaced."),
      heading: z.string().trim().max(200).optional().describe("For append_section, add_to_section and replace_section: the section heading (without the # marks)."),
      text: z.string().max(50_000).optional().describe("For append_section, add_to_section and replace_section: the text to add or put in."),
      old_text: z.string().max(10_000).optional().describe("For replace_text: the exact words to replace, copied from the current minutes; they must appear exactly once."),
      new_text: z.string().max(50_000).optional().describe("For replace_text: the words to put in their place (empty removes them)."),
    })
    .optional()
    .describe("Optional. One targeted change to the minutes. Missing or ambiguous matches are refused, never guessed."),
  decisions: z.array(z.string().trim().min(1).max(300)).max(20).optional().describe("Optional. The full new list of decisions (replaces the current list; [] clears it)."),
  add_attendees: z.array(attendee).max(40).optional().describe("Optional. People to add as attendees (matched as in create_meeting)."),
  remove_attendees: z.array(z.string().trim().min(1).max(120)).max(40).optional().describe("Optional. Attendees to remove, by name as get_meeting lists them."),
  add_links: z.array(linked).max(20).optional().describe("Optional. Records to link (each linked contact, organisation, lead or contractor gets one interaction logged)."),
  remove_links: z.array(linked).max(20).optional().describe("Optional. Records to unlink (their interaction from this meeting is archived)."),
  confidential: z.boolean().optional().describe("Optional. Make the meeting confidential (true) or visible to the team (false). Only the person who recorded it, or a director or administrator, can change this."),
};

export const addMeetingActionShape = {
  meeting: meeting("The meeting"),
  title: z.string().trim().min(1).max(200).describe("The action in a few words, as the person said it."),
  assignee: z.string().trim().max(200).optional().describe('Optional. Who will do it: "me" (default), or an active team member\'s name or id.'),
  due: optDate("Optional. When it is due"),
  priority: z.enum(ACTION_PRIORITY_VALUES).optional().describe("Optional. low, normal (default), high or urgent."),
  description: z.string().trim().max(2000).optional().describe("Optional. Any detail the person gave (at most 2000 characters)."),
};

export const meetingDigestShape = {
  days: z.number().int().min(1).max(31).optional().describe("Optional. How many days back to cover (default 7: this week)."),
  mine: z.boolean().optional().describe("Optional. true: only meetings you recorded or attended, and actions assigned to you."),
};

export const promoteMeetingDecisionShape = {
  meeting: meeting("The meeting the decision was made at"),
  title: z.string().trim().min(1).max(200).describe("The decision in one sentence, as it was agreed (at most 200 characters)."),
  category: z.enum(DECISION_CATEGORY_VALUES_FOR_MEETINGS).describe("The category: strategy, finance, people, operations, partners, marketing, technology, legal_compliance, service_offering or other."),
  description: z.string().trim().max(5000).optional().describe("Optional. What was decided, in more detail."),
  rationale: z.string().trim().max(5000).optional().describe("Optional. Why, as the person said it."),
  decision_date: optDate("Optional. When it was decided (default: the meeting day; at most 7 days ahead)"),
  status: z.enum(OPEN_DECISION_STATUS_VALUES_FOR_MEETINGS).optional().describe("Optional. proposed, decided (default) or in_effect."),
};
