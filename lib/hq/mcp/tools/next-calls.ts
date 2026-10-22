/*
 * next_calls: "who should I call next?" over chat. The same list, in the same order and with the same
 * reasons, as "Your next calls" on Today's Grow workspace: both read lib/hq/growth/next-calls-queries.ts,
 * so the screen and the chat cannot disagree. Needs growth.read; every query runs as the person (RLS).
 * Read-only: it never changes a priority, a stage or a date.
 */
import { CALL_OUTCOME_LABEL, INTERACTION_LABEL, RELATIONSHIP_LABEL, STAGE_LABEL } from "../../constants";
import { CALL_GROUP_LABEL, phoneWords, type NextCall } from "../../growth/next-calls";
import { loadNextCalls, type NextCallsData } from "../../growth/next-calls-queries";
import { HQ_PATHS, clean, rowLimit } from "./core";
import { day, defineTool, link, respond, today, type ToolContext } from "./kit";
import { nextCallsShape } from "./schemas";

function stageWords(c: NextCall): string {
  if ("lead" in c.stage) return `lead, ${STAGE_LABEL[c.stage.lead]}`;
  return c.stage.contact ? RELATIONSHIP_LABEL[c.stage.contact] : "no relationship stage";
}

function lastWords(ctx: ToolContext, c: NextCall): string {
  const lc = c.lastContact;
  if (!lc) return "never contacted";
  const what = lc.outcome ? CALL_OUTCOME_LABEL[lc.outcome].toLowerCase() : lc.type ? INTERACTION_LABEL[lc.type].toLowerCase() : null;
  return `last contact ${day(ctx, lc.date)}${what ? ` (${what})` : ""}`;
}

/** One line per call, as the chat shows it (also used by daily_brief). */
export function nextCallLine(ctx: ToolContext, c: NextCall, n: number): string {
  const url = link(ctx, c.kind === "lead" ? `/hq/growth/opportunities/${c.id}` : HQ_PATHS.contact(c.id));
  return [
    `${n}. ${clean(c.name)} [${c.kind} id: ${c.id}]${c.business ? ` (${clean(c.business)})` : ""} - ${phoneWords(c.phone)} - ${stageWords(c)} - ${lastWords(ctx, c)}`,
    `   Why: ${c.why}`,
    `   Next step: ${c.nextStep ? clean(c.nextStep) : "none recorded"} - ${url}`,
  ].join("\n");
}

export async function nextCallsFor(ctx: ToolContext) {
  return loadNextCalls(ctx.db, { staffId: ctx.staff.id, today: today(ctx), timezone: ctx.staff.timezone });
}

function countsText(d: NextCallsData): string {
  const parts = (Object.keys(d.counts) as (keyof NextCallsData["counts"])[]).filter((g) => d.counts[g] > 0).map((g) => `${CALL_GROUP_LABEL[g].toLowerCase()} ${d.counts[g]}`);
  return parts.length ? parts.join(", ") : "none";
}

export const nextCalls = defineTool({
  name: "next_calls",
  title: "Your next calls",
  description:
    "The best answer to 'who should I call next?', 'who do I need to ring today?' or 'who have I promised to call back?'. Your own ranked call list, exactly as Today's Grow workspace shows it: promised callbacks first, then overdue follow-ups, due today (including new website enquiries), warm leads idle for a week, partner contacts never contacted (high priority first, then the longest waiting), and relationships quiet for over 30 days. Each person once, with phone (or 'No number recorded'), stage, last contact, next step and the reason they appear. Only people you own; unowned partner contacts are counted. Read-only.",
  inputSchema: nextCallsShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async (args, ctx) => {
    const n = rowLimit(args.limit);
    const loaded = await nextCallsFor(ctx);
    if (!loaded.ok) return respond("error", "Your next calls could not be loaded just now. Nothing was changed. Try again in a moment.");
    const d = loaded.data;
    const unowned = d.unowned > 0 ? `${d.unowned} partner contact${d.unowned === 1 ? " has" : "s have"} no owner yet, so ${d.unowned === 1 ? "is" : "are"} on nobody's list.` : null;
    if (d.calls.length === 0) {
      return respond("empty", `Nobody to call right now: everyone you own has a follow-up planned for a later day, or nothing is due.${unowned ? ` ${unowned}` : ""} Today: ${link(ctx, "/hq?view=grow")}`, null, { total: 0, unowned: d.unowned });
    }
    const shown = d.calls.slice(0, n);
    return respond(
      "ok",
      `Your next calls: ${d.calls.length} (${countsText(d)}). Today: ${link(ctx, "/hq?view=grow")}`,
      shown.map((c, i) => nextCallLine(ctx, c, i + 1)),
      { total: d.calls.length, counts: d.counts, unowned: d.unowned },
      [d.calls.length > shown.length ? `Showing the first ${shown.length}.` : null, unowned].filter(Boolean).join(" ") || undefined,
    );
  },
});
