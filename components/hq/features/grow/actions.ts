"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { CALL_OUTCOMES, HQ_BASE } from "@/lib/hq/constants";
import { fail, FormReader, type ActionState } from "@/lib/hq/forms";
import { FOLLOW_UP_CHOICES, planCallLog } from "@/lib/hq/growth/call-log";
import { logTag } from "@/lib/hq/growth/db-errors";
import { retainedValues } from "@/lib/hq/growth/retain";
import { todayIn } from "@/lib/hq/format";
import { isWorkspace, WORKSPACE_LABEL } from "@/lib/hq/workspaces";

/*
 * Server Actions for Today's Grow workspace. Each is reachable by a direct POST, so each starts with
 * requireStaff and takes identity from the session only.
 *
 *  - logCallOutcome: "Log outcome" on a call. Writes through the same RPCs as the contact and lead drawers
 *    (record_interaction, log_opportunity_activity), so the timeline, last contact, history and audit trail
 *    are exactly as before. The rules (an outcome, a next step, a reason for no follow-up, a promised
 *    callback's date) are lib/hq/growth/call-log.ts; the database checks them again.
 *  - saveWorkspace: "Make this my default". The person's own preference only (set_my_workspace); it
 *    never changes what they may see.
 */

const GENERIC = "We couldn't log that. Nothing was saved. Try again in a moment.";
const TODAY_GROW = `${HQ_BASE}?view=grow`;

/** A failure that keeps what was typed (the drawer stays open with it). */
function failKeeping(formData: FormData, message: string, fieldErrors?: Record<string, string>): ActionState {
  return { ...fail(message, fieldErrors), data: { values: retainedValues(formData) } };
}

export async function logCallOutcome(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db, staff } = await requireStaff("growth.write");
  const f = new FormReader(formData);
  const target = f.oneOf("target", ["contact", "lead"] as const, { required: true });
  const id = f.uuid("id", { required: true, label: "Who you called" });
  const outcome = f.oneOf("outcome", CALL_OUTCOMES);
  const summary = f.text("summary", { label: "What was said", max: 4000 });
  const nextStep = f.text("next_step", { label: "Next step", max: 300 });
  const choice = f.oneOf("follow_up", FOLLOW_UP_CHOICES);
  const date = f.date("follow_up_date");
  const reason = f.text("reason", { label: "The reason", max: 300 });
  const callbackPromised = f.bool("callback_promised");
  if (!f.ok || !target || !id) return failKeeping(formData, "Please check the highlighted fields and try again.", f.errors);

  const today = todayIn(staff.timezone);
  const plan = planCallLog({ target, outcome, summary, choice, date, reason, callbackPromised, today });
  if (!plan.ok) return failKeeping(formData, "Please check the highlighted fields and try again.", plan.errors);

  const { error } =
    target === "contact"
      ? await db.rpc("record_interaction", {
          p_contact: id,
          p_type: "phone_call",
          p_summary: plan.summary,
          p_next_action: nextStep ?? undefined,
          p_follow_up_date: plan.followUp ?? undefined,
          p_outcome: outcome ?? undefined,
          p_callback_promised: plan.callbackPromised,
          p_clear_follow_up: plan.clearFollowUp,
        })
      : await db.rpc("log_opportunity_activity", {
          p_opportunity: id,
          p_type: "phone_call",
          p_summary: plan.summary,
          p_next_action: nextStep ?? undefined,
          p_next_action_due: plan.followUp ?? undefined,
          p_outcome: outcome ?? undefined,
          p_callback_promised: plan.callbackPromised,
        });
  if (error) {
    console.error(`[hq] log call outcome (${target}) failed:`, logTag(error));
    if (error.code === "42501") return failKeeping(formData, "You don't have permission to do that.");
    if (error.code === "P0002") return failKeeping(formData, "That record is no longer available to you.");
    return failKeeping(formData, GENERIC);
  }

  revalidatePath(HQ_BASE);
  revalidatePath(`${HQ_BASE}/growth`, "layout");
  redirect(withToast(TODAY_GROW, plan.followUp ? "Call logged, and the next follow-up is set" : "Call logged"));
}

export async function saveWorkspace(formData: FormData): Promise<void> {
  const { db } = await requireStaff();
  const raw = formData.get("workspace");
  const back = isWorkspace(raw) ? `${HQ_BASE}?view=${raw}` : HQ_BASE;
  if (!isWorkspace(raw)) redirect(withToast(back, "We could not save that.", "error"));
  const { error } = await db.rpc("set_my_workspace", { p_workspace: raw });
  if (error) {
    console.error("[hq] set_my_workspace failed:", logTag(error));
    redirect(withToast(back, "We could not save that. Try again in a moment.", "error"));
  }
  revalidatePath(HQ_BASE, "layout");
  redirect(withToast(HQ_BASE, `Today now opens in ${WORKSPACE_LABEL[raw]}.`));
}
