"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";
import { staffErrorMessage } from "@/lib/hq/staff-errors";
import { isAustralianTimezone, resolveTimezoneChoice } from "@/lib/hq/timezones";

/*
 * Server Actions for Profile and Settings.
 *
 *  - updateTimezoneAction: anyone, for THEMSELVES only. The person is the signed-in one (from the
 *    session); the form cannot name anyone else. Validated with Intl here, then by Postgres.
 *  - the two business settings: settings.admin only (directors). They write the settings table
 *    directly; the row level security policy and the column grant (only `value`) are the control.
 */

// ── your timezone ────────────────────────────────────────────

export async function updateTimezoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { staff, db } = await requireStaff();

  const f = new FormReader(formData);
  const choice = f.text("timezone", { max: 64 }) ?? "";
  const other = f.text("timezoneOther", { max: 64 }) ?? "";
  const values = { values: { timezone: choice, timezoneOther: other } };
  const picked = resolveTimezoneChoice(choice, other);
  if (!picked.ok) return { ...fail("Check the timezone and try again.", { [picked.field]: picked.message }), data: values };

  const { error } = await db.rpc("update_staff", { p_staff_id: staff.id, p_timezone: picked.timezone });
  if (error) {
    console.error("[hq] saving a timezone failed:", error.code);
    return { ...fail(staffErrorMessage(error, "We could not save your timezone. Try again in a moment.")), data: values };
  }
  redirect(withToast(`${HQ_BASE}/profile`, "Timezone saved."));
}

// ── business settings ────────────────────────────────────────

/**
 * Switches the organisation-wide two-step requirement on or off. Turning it off is confirmed in the
 * interface first; this action does not rely on that and checks who is asking.
 */
export async function setRequireMfaAction(required: boolean): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  if (typeof required !== "boolean") return fail("We could not change that setting.");

  const { data, error } = await db.from("settings").update({ value: required }).eq("key", "require_mfa").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing require_mfa failed:", error?.code);
    return fail("We could not change that setting. Try again in a moment.");
  }
  refresh();
  return succeed(required ? "Two-step verification is now required for everyone." : "Two-step verification is no longer required.");
}

/**
 * The business timezone decides which day "overdue" and "today" mean for everyone (hq.today()), so it
 * is limited to the Australian zones. A name Postgres did not know would break every overdue flag.
 */
export async function updateBusinessTimezoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  const f = new FormReader(formData);
  const tz = f.text("timezone", { max: 64 }) ?? "";
  if (!isAustralianTimezone(tz)) {
    return { ...fail("Choose one of the timezones listed.", { timezone: "Choose one of the options." }), data: { values: { timezone: tz } } };
  }

  const { data, error } = await db.from("settings").update({ value: tz }).eq("key", "timezone").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing the business timezone failed:", error?.code);
    return { ...fail("We could not save the timezone. Try again in a moment."), data: { values: { timezone: tz } } };
  }
  redirect(withToast(`${HQ_BASE}/settings`, "Business timezone saved."));
}
