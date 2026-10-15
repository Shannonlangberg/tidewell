"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { withToast } from "@/components/hq/flash";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, OPEN_TASK_STATUSES } from "@/lib/hq/constants";
import { WIDGET_IDS, sanitiseSelection } from "@/lib/hq/dashboard-widgets";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";
import { safeNextPath } from "@/lib/hq/next-path";

/*
 * Server Actions for the dashboard. Each is reachable by direct POST, so each starts with
 * requireStaff(<capability>) and takes the person's identity from the session, never from
 * the form. The database (row level security and the update_staff RPC) is the control
 * behind every one.
 */

// ── layout ───────────────────────────────────────────────────

/** Saves (or resets) the signed-in person's own widget layout. Anyone may change their own. */
async function writeLayout(widgets: string[] | null): Promise<boolean> {
  const { staff, db } = await requireStaff();
  const { error } =
    widgets === null
      ? await db.rpc("update_staff", { p_staff_id: staff.id, p_reset_widgets: true })
      : await db.rpc("update_staff", { p_staff_id: staff.id, p_dashboard_widgets: widgets });
  if (error) {
    console.error("[hq] saving the dashboard layout failed:", error.code);
    return false;
  }
  return true;
}

/** From the Customise drawer: `intent` is "save" (with the ticked `widgets`) or "reset" (back to the role default). */
export async function saveDashboardLayoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { staff } = await requireStaff();
  const f = new FormReader(formData);
  const intent = f.oneOf("intent", ["save", "reset"] as const, { required: true });
  if (!intent) return fail("We could not save that. Reload the page and try again.");

  if (intent === "reset") {
    if (!(await writeLayout(null))) return fail("We could not reset your dashboard. Try again in a moment.");
    refresh();
    return succeed("Your dashboard is back to the default for your role.");
  }

  const posted = f.manyOf("widgets", WIDGET_IDS);
  if (!f.ok) return f.fail("Choose from the widgets listed.");
  // Only widgets this person may see are ever stored, whatever the form claimed.
  const widgets = sanitiseSelection(posted, staff.capabilities);
  if (widgets.length === 0) {
    return fail("Choose at least one widget.", { widgets: "Choose at least one widget." });
  }
  if (!(await writeLayout(widgets))) return fail("We could not save your dashboard. Try again in a moment.");
  refresh();
  return succeed("Your dashboard has been updated.");
}

/** From Profile: back to the role default, then a toast. */
export async function resetDashboardLayoutAction(): Promise<void> {
  const ok = await writeLayout(null);
  redirect(
    ok
      ? withToast(`${HQ_BASE}/profile`, "Your dashboard is back to the default for your role.")
      : withToast(`${HQ_BASE}/profile`, "We could not reset your dashboard. Try again in a moment.", "error"),
  );
}

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
