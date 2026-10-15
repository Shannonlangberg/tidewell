"use server";

import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { OPEN_TASK_STATUSES } from "@/lib/hq/constants";
import { FormReader } from "@/lib/hq/forms";
import { safeNextPath } from "@/lib/hq/next-path";

/*
 * Server Actions shared by Today and Reports. Each is reachable by direct POST, so each starts with
 * requireStaff(<capability>) and takes the person's identity from the session, never from
 * the form. The database (row level security) is the control
 * behind every one.
 */

// ── tasks ────────────────────────────────────────────────────

/**
 * The "Complete" button on a task in the dashboard. Needs tasks.write; row level security
 * still limits it to tasks the person can see and update. Only open tasks change, and the
 * database stamps who completed it and when.
 */
export async function completeTaskAction(formData: FormData): Promise<void> {
  const { db } = await requireStaff("tasks.write");
  const back = safeNextPath(formData.get("next"));
  const f = new FormReader(formData);
  const id = f.uuid("taskId", { required: true });
  if (!f.ok || !id) redirect(withToast(back, "We could not complete that task.", "error"));

  const { data, error } = await db
    .from("tasks")
    .update({ status: "completed" })
    .eq("id", id)
    .is("deleted_at", null)
    .in("status", [...OPEN_TASK_STATUSES])
    .select("id");
  if (error) {
    console.error("[hq] completing a task failed:", error.code);
    redirect(withToast(back, "We could not complete that task. Try again in a moment.", "error"));
  }
  if (!data || data.length === 0) {
    redirect(withToast(back, "That task is already closed, or is no longer available to you.", "info"));
  }
  redirect(withToast(back, "Task completed."));
}
