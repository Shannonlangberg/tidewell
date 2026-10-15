"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { FormReader } from "@/lib/hq/forms";
import { logTag } from "@/lib/hq/growth/db-errors";
import { shortDay } from "@/lib/hq/greeting";
import { addDays } from "@/lib/hq/periods";
import { safeNextPath } from "@/lib/hq/next-path";
import { SNOOZE_DAYS } from "@/lib/hq/today";

/*
 * "Snooze" on a follow-up in Today: moves the contact's next follow-up a week on from today. Reachable
 * by direct POST, so it starts with requireStaff("growth.write") and row level security decides which
 * contacts the person may change. The same column the contact profile's follow-up date field writes.
 */
export async function snoozeFollowUpAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("growth.write");
  const back = safeNextPath(formData.get("next"), HQ_BASE);
  const f = new FormReader(formData);
  const id = f.uuid("contactId", { required: true });
  if (!f.ok || !id) redirect(withToast(back, "We could not snooze that follow-up.", "error"));

  const todayRes = await db.rpc("today");
  if (todayRes.error || typeof todayRes.data !== "string") {
    console.error("[hq] snooze: today() failed:", logTag(todayRes.error));
    redirect(withToast(back, "We could not snooze that follow-up. Try again in a moment.", "error"));
  }
  const next = addDays(todayRes.data as string, SNOOZE_DAYS);

  const res = await db.from("contacts").update({ next_follow_up_date: next }).eq("id", id).is("deleted_at", null).select("id, full_name");
  if (res.error) {
    console.error("[hq] snooze failed:", logTag(res.error));
    redirect(withToast(back, "We could not snooze that follow-up. Try again in a moment.", "error"));
  }
  if (!res.data || res.data.length === 0) redirect(withToast(back, "That contact is no longer available to you.", "info"));

  revalidatePath(HQ_BASE);
  redirect(withToast(back, `Snoozed until ${shortDay(next)}.`));
}
