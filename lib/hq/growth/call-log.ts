/*
 * The rules of "log the outcome" on a call from Today's Grow workspace (docs/hq-workspaces.md §4):
 * Call, then log the outcome, then set the next follow-up. A call never ends without a next step: the
 * person picks when to follow up, or says why no follow-up is needed (contacts only: an open lead always
 * has a next step, and is closed as Lost on its own page). A promised callback needs that date.
 *
 * The database checks the same again (record_interaction, log_opportunity_activity). Pure: type-only
 * imports, so `node --test` can run it.
 */

import type { CallOutcome } from "../constants";

export const FOLLOW_UP_CHOICES = ["tomorrow", "three_days", "next_week", "date", "none"] as const;
export type FollowUpChoice = (typeof FOLLOW_UP_CHOICES)[number];

export const FOLLOW_UP_LABEL: Record<FollowUpChoice, string> = {
  tomorrow: "Tomorrow",
  three_days: "In 3 days",
  next_week: "In a week",
  date: "Pick a date",
  none: "No further follow-up",
};

const OFFSET: Partial<Record<FollowUpChoice, number>> = { tomorrow: 1, three_days: 3, next_week: 7 };

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export type CallLogInput = {
  target: "contact" | "lead";
  outcome: CallOutcome | null;
  summary: string | null;
  choice: FollowUpChoice | null;
  /** With choice "date". */
  date: string | null;
  /** With choice "none". */
  reason: string | null;
  callbackPromised: boolean;
  today: string;
};

export type CallLogPlan =
  | { ok: true; summary: string; followUp: string | null; clearFollowUp: boolean; callbackPromised: boolean }
  | { ok: false; errors: Record<string, string> };

const OUTCOME_SENTENCE: Record<CallOutcome, string> = {
  spoke: "Spoke.",
  left_message: "Left a message.",
  no_answer: "No answer.",
  wrong_number: "Wrong number.",
};

/** Works out what to save, or which fields to fix. */
export function planCallLog(i: CallLogInput): CallLogPlan {
  const errors: Record<string, string> = {};
  if (!i.outcome) errors.outcome = "Choose how the call went.";
  const said = i.summary?.trim() || null;
  if (i.outcome === "spoke" && !said) errors.summary = "Say what was discussed, in a line or two.";

  let followUp: string | null = null;
  let clear = false;
  if (!i.choice) errors.follow_up = "Choose when to follow up.";
  else if (i.choice === "none") {
    if (i.target === "lead") errors.follow_up = "An open lead always has a next step. Choose a date, or close the lead as Lost on its page.";
    else if (!i.reason?.trim()) errors.reason = "Say why no follow-up is needed.";
    else clear = true;
  } else if (i.choice === "date") {
    if (!i.date) errors.follow_up_date = "Choose a date.";
    else if (i.date < i.today) errors.follow_up_date = "The follow-up can't be in the past.";
    else if (i.date > addDays(i.today, 730)) errors.follow_up_date = "Choose a date within two years.";
    else followUp = i.date;
  } else followUp = addDays(i.today, OFFSET[i.choice] ?? 1);

  if (i.callbackPromised && !followUp && !errors.follow_up && !errors.follow_up_date) errors.callback_promised = "A promised callback needs a follow-up date.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const outcomeLine = OUTCOME_SENTENCE[i.outcome as CallOutcome];
  const parts = [said ?? outcomeLine];
  if (said && i.outcome !== "spoke") parts.unshift(outcomeLine);
  if (clear) parts.push(`No further follow-up: ${i.reason!.trim()}`);
  return { ok: true, summary: parts.join(" ").slice(0, 4000), followUp, clearFollowUp: clear, callbackPromised: i.callbackPromised && !!followUp };
}
