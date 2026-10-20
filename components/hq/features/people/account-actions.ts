"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { parseHourlyLimit } from "@/lib/hq/ai-log";
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
 *  - the business settings, including the connected-app switch and hourly limit: settings.admin
 *    only (directors). They write the settings table directly; the row level security policy, the
 *    column grant (only `value`) and the settings guard trigger are the control.
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

// ── connected apps (MCP): the on/off switch and the hourly limit ──

/**
 * Switches the connection for ChatGPT and Claude on or off for everyone (hq.settings.ai_enabled).
 * Off is the immediate lever: every tool call is refused from the next call on. Same write path as
 * the other business settings: settings.admin here, then RLS and the settings guard in the database.
 */
export async function setAiEnabledAction(enabled: boolean): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  if (typeof enabled !== "boolean") return fail("We could not change that setting.");

  const { data, error } = await db.from("settings").update({ value: enabled }).eq("key", "ai_enabled").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing ai_enabled failed:", error?.code);
    return fail("We could not change that setting. Try again in a moment.");
  }
  refresh();
  return succeed(enabled ? "The connection is on. ChatGPT and Claude can use HQ as each person." : "The connection is off. Connected apps are refused from their next call.");
}

/** Calls per person per rolling hour through a connected app (hq.settings.ai_hourly_limit): 1 to 1000. */
export async function updateAiHourlyLimitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { db } = await requireStaff("settings.admin");
  const raw = formData.get("hourlyLimit");
  const typed = typeof raw === "string" ? raw.trim().slice(0, 12) : "";
  const limit = parseHourlyLimit(typed);
  if (limit === null) {
    return { ...fail("Check the hourly limit and try again.", { hourlyLimit: "Enter a whole number from 1 to 1000." }), data: { values: { hourlyLimit: typed } } };
  }

  const { data, error } = await db.from("settings").update({ value: limit }).eq("key", "ai_hourly_limit").select("key");
  if (error || !data || data.length === 0) {
    console.error("[hq] changing ai_hourly_limit failed:", error?.code);
    return { ...fail("We could not save the hourly limit. Try again in a moment."), data: { values: { hourlyLimit: typed } } };
  }
  redirect(withToast(`${HQ_BASE}/settings/ai`, "Hourly limit saved."));
}
