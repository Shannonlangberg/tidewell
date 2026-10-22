/*
 * "Your next calls": who a BDM should contact next, and why (docs/hq-workspaces.md §3).
 *
 * One set of rules for every place that recommends a call: the Grow workspace on Today, the Referral
 * partners page's order and the chat tools (next_calls, who_to_contact, daily_brief), so they cannot
 * disagree. The rules read records only. They never change a priority, a stage or a date, and every
 * person on the list carries the reason, in words, that put them there.
 *
 * Each person appears ONCE, in the first group that matches, in this order:
 *
 *   1. callback   the last call promised to call back, and that date has come (the follow-up is still it)
 *   2. overdue    a follow-up you set (contact) or a lead's next action, before today
 *   3. today      the same, today (a new website enquiry's reply is due the day it arrives)
 *   4. warm       an open lead at qualified, appraisal requested, appraisal completed or proposal sent
 *                 with no activity for WARM_IDLE_DAYS, even when its next action is planned for later (an
 *                 open lead always has one): these are the leads closest to signing
 *   5. introduce  a partner contact never contacted: high priority first, then the OLDEST added (never by name)
 *   6. quiet      met, an active relationship or a referring partner, with no contact for QUIET_DAYS
 *
 * Otherwise a follow-up you have set for a later day keeps a person off the list until that day. Only records the
 * person owns are ranked (contacts by relationship owner, leads by assignee); the loader counts the
 * partner contacts with no owner so the page can say so. A lead's landlord contact is the same person as
 * the lead: they appear once, as the lead.
 *
 * Pure: type-only imports, so `node --test` can run it.
 */

import type { CallOutcome, InteractionType, OpportunityStage, Priority, RelationshipStatus } from "../constants";

export const WARM_IDLE_DAYS = 7;
/** The same threshold the referral partners page and the command center call "quiet". */
export const QUIET_DAYS = 30;

export const CALL_GROUPS = ["callback", "overdue", "today", "warm", "introduce", "quiet"] as const;
export type CallGroup = (typeof CALL_GROUPS)[number];

export const CALL_GROUP_LABEL: Record<CallGroup, string> = {
  callback: "Promised callbacks",
  overdue: "Overdue follow-ups",
  today: "Due today",
  warm: "Warm prospects",
  introduce: "Partners to introduce ourselves to",
  quiet: "Relationships needing attention",
};

export const WARM_STAGES: readonly OpportunityStage[] = ["qualified", "appraisal_requested", "appraisal_completed", "proposal_sent"];
const WARM_STAGE_WORDS: Partial<Record<OpportunityStage, string>> = {
  qualified: "Qualified",
  appraisal_requested: "Appraisal requested",
  appraisal_completed: "Appraisal completed",
  proposal_sent: "Proposal sent",
};
const QUIET_STATUSES: readonly RelationshipStatus[] = ["met", "active_relationship", "referring_partner"];
const QUIET_WORDS: Partial<Record<RelationshipStatus, string>> = { met: "Met", active_relationship: "Active relationship", referring_partner: "Referring partner" };
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_WORDS: Record<Priority, string> = { high: "High priority", medium: "Medium priority", low: "Low priority" };

// ── input (what the loader reads) ────────────────────────────

export type CallContact = {
  id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  kind: "partner" | "landlord" | "other" | null;
  status: RelationshipStatus | null;
  priority: Priority | null;
  /** Local date (YYYY-MM-DD) of the last contact, in the business timezone; null when never. */
  lastContact: string | null;
  nextFollowUp: string | null;
  /** Local date the record was added. */
  added: string;
};

export type CallLead = {
  id: string;
  ref: string | null;
  name: string;
  phone: string | null;
  suburb: string | null;
  stage: OpportunityStage;
  nextAction: string | null;
  nextActionDue: string | null;
  /** Local date of the last activity; null when none. */
  lastActivity: string | null;
  added: string;
  /** The landlord contact, when the lead has one. */
  contactId: string | null;
  /** The website enquiry still waiting for a reply (ENQ-0012), when there is one. */
  newEnquiryRef: string | null;
};

/** The person's latest logged interaction (for a contact, or on a lead). */
export type LastTouch = {
  date: string;
  type: InteractionType;
  outcome: CallOutcome | null;
  callbackPromised: boolean;
  followUpDate: string | null;
  nextAction: string | null;
};

export type NextCallsInput = {
  today: string;
  contacts: readonly CallContact[];
  leads: readonly CallLead[];
  /** Keyed `contact:<id>` or `lead:<id>`. */
  lastTouch: Readonly<Record<string, LastTouch>>;
};

// ── output ───────────────────────────────────────────────────

export type NextCall = {
  /** Stable and unique on the list: `lead:<id>` or `contact:<id>`. */
  key: string;
  kind: "lead" | "contact";
  id: string;
  contactId: string | null;
  name: string;
  /** The organisation, or for a landlord lead the suburb ("Landlord, Moonta"). */
  business: string | null;
  phone: string | null;
  /** A lead's stage or a contact's relationship status, raw; the screen labels it. */
  stage: { lead: OpportunityStage } | { contact: RelationshipStatus | null };
  lastContact: { date: string; type: InteractionType | null; outcome: CallOutcome | null } | null;
  /** What happens next, as recorded; null when nothing is. */
  nextStep: string | null;
  group: CallGroup;
  why: string;
  /** The date that ordered it within its group. */
  sortDate: string | null;
  priority: Priority | null;
};

export type NextCallsResult = { calls: NextCall[]; counts: Record<CallGroup, number> };

// ── dates ────────────────────────────────────────────────────

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** "21 Oct", with the year when it is not `today`'s. */
export function shortDate(date: string, today: string): string {
  const d = new Date(ms(date));
  const year = date.slice(0, 4) === today.slice(0, 4) ? "" : ` ${date.slice(0, 4)}`;
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}${year}`;
}

function overdueWords(date: string, today: string): string {
  const n = daysBetween(date, today);
  return n === 1 ? "1 day overdue" : `${n} days overdue`;
}

function quote(text: string): string {
  const t = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return `“${t}”`;
}

// ── the rules ────────────────────────────────────────────────

/** A promised callback that has come due, and is still the person's follow-up. */
function promisedDue(touch: LastTouch | undefined, current: string | null, today: string): string | null {
  if (!touch?.callbackPromised || !touch.followUpDate) return null;
  if (current !== null && current !== touch.followUpDate) return null; // the follow-up has been moved since
  return touch.followUpDate <= today ? touch.followUpDate : null;
}

function callbackWhy(date: string, today: string): string {
  return date === today ? "You promised to call back today." : `You promised to call back by ${shortDate(date, today)}. ${overdueWords(date, today)}.`;
}

function leadCall(l: CallLead, touch: LastTouch | undefined, today: string): NextCall | null {
  const base = {
    key: `lead:${l.id}`,
    kind: "lead" as const,
    id: l.id,
    contactId: l.contactId,
    name: l.name,
    business: l.suburb ? `Landlord, ${l.suburb}` : "Landlord",
    phone: l.phone,
    stage: { lead: l.stage },
    lastContact: touch ? { date: touch.date, type: touch.type, outcome: touch.outcome } : l.lastActivity ? { date: l.lastActivity, type: null, outcome: null } : null,
    nextStep: l.nextAction,
    priority: null,
  };
  const promised = promisedDue(touch, l.nextActionDue, today);
  if (promised) return { ...base, group: "callback", why: callbackWhy(promised, today), sortDate: promised };
  const due = l.nextActionDue;
  if (due && due < today) {
    const what = l.nextAction ? `: ${quote(l.nextAction)}` : "";
    return { ...base, group: "overdue", why: `Lead next action was due ${shortDate(due, today)}, ${overdueWords(due, today)}${what}.`, sortDate: due };
  }
  if (due && due === today) {
    const why = l.newEnquiryRef ? `New website enquiry ${l.newEnquiryRef}: the reply is due today.` : `Lead next action due today${l.nextAction ? `: ${quote(l.nextAction)}` : ""}.`;
    return { ...base, group: "today", why, sortDate: due };
  }
  if (WARM_STAGES.includes(l.stage)) {
    const since = l.lastActivity ?? l.added;
    const idle = daysBetween(since, today);
    if (idle >= WARM_IDLE_DAYS) {
      const words = l.lastActivity ? `no activity since ${shortDate(l.lastActivity, today)}` : "no activity recorded";
      const planned = due ? ` Next action planned for ${shortDate(due, today)}.` : "";
      return { ...base, group: "warm", why: `${WARM_STAGE_WORDS[l.stage]}, ${words}.${planned}`, sortDate: since };
    }
  }
  return null; // planned for a later day, or not yet warm
}

function contactCall(c: CallContact, touch: LastTouch | undefined, today: string): NextCall | null {
  if (c.status === "inactive") return null;
  const base = {
    key: `contact:${c.id}`,
    kind: "contact" as const,
    id: c.id,
    contactId: c.id,
    name: c.name,
    business: c.organisation ?? (c.kind === "landlord" ? "Landlord" : null),
    phone: c.phone,
    stage: { contact: c.status },
    lastContact: c.lastContact ? { date: c.lastContact, type: touch?.type ?? null, outcome: touch?.outcome ?? null } : null,
    nextStep: touch?.nextAction ?? null,
    priority: c.priority,
  };
  const promised = promisedDue(touch, c.nextFollowUp, today);
  if (promised) return { ...base, group: "callback", why: callbackWhy(promised, today), sortDate: promised };
  const due = c.nextFollowUp;
  if (due && due < today) return { ...base, group: "overdue", why: `Follow-up you set for ${shortDate(due, today)}, ${overdueWords(due, today)}.`, sortDate: due };
  if (due && due === today) return { ...base, group: "today", why: "Follow-up you set for today.", sortDate: due };
  if (due && due > today) return null; // planned for a later day
  if (c.kind === "partner" && c.lastContact === null) {
    const p = c.priority ?? "medium";
    return { ...base, group: "introduce", why: `${PRIORITY_WORDS[p]}, never contacted, added ${shortDate(c.added, today)}.`, sortDate: c.added };
  }
  if (c.status && QUIET_STATUSES.includes(c.status) && c.lastContact) {
    const quiet = daysBetween(c.lastContact, today);
    if (quiet > QUIET_DAYS) return { ...base, group: "quiet", why: `${QUIET_WORDS[c.status]}, no contact for ${quiet} days.`, sortDate: c.lastContact };
  }
  return null;
}

function compare(a: NextCall, b: NextCall): number {
  const g = CALL_GROUPS.indexOf(a.group) - CALL_GROUPS.indexOf(b.group);
  if (g !== 0) return g;
  if (a.group === "introduce") {
    const p = PRIORITY_RANK[a.priority ?? "medium"] - PRIORITY_RANK[b.priority ?? "medium"];
    if (p !== 0) return p;
  }
  const d = (a.sortDate ?? "").localeCompare(b.sortDate ?? "");
  if (d !== 0) return d;
  const p = PRIORITY_RANK[a.priority ?? "medium"] - PRIORITY_RANK[b.priority ?? "medium"];
  if (p !== 0) return p;
  return a.key.localeCompare(b.key); // stable, never by name
}

/** Everyone to call, in order, each once with the reason. */
export function nextCalls(input: NextCallsInput): NextCallsResult {
  const { today, lastTouch } = input;
  const out: NextCall[] = [];
  const leadContacts = new Set<string>();
  for (const l of input.leads) {
    if (l.contactId) leadContacts.add(l.contactId);
    const call = leadCall(l, lastTouch[`lead:${l.id}`], today);
    if (call) out.push(call);
  }
  for (const c of input.contacts) {
    if (leadContacts.has(c.id)) continue; // the same person, as their open lead
    const call = contactCall(c, lastTouch[`contact:${c.id}`], today);
    if (call) out.push(call);
  }
  out.sort(compare);
  const counts = Object.fromEntries(CALL_GROUPS.map((g) => [g, 0])) as Record<CallGroup, number>;
  for (const c of out) counts[c.group] += 1;
  return { calls: out, counts };
}

/** "No number recorded" rather than a blank: missing information is said, never guessed. */
export function phoneWords(phone: string | null): string {
  return phone && phone.trim() ? phone.trim() : "No number recorded";
}
