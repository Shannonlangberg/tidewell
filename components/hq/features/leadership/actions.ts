"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { isIsoDate, isUuid } from "@/lib/hq/forms";
import { addDays, laneMove, nextMonday } from "@/lib/hq/leadership/rules";
import { LEADER_TASK_COLS, toLeaderTask } from "@/lib/hq/leadership/queries";
import type { Lane, LeaderActionResult, PlanningKind, PlanningStatus } from "@/lib/hq/leadership/types";

/*
 * Server Actions for the command center (/hq). Each is reachable by a direct POST, so every one starts
 * with requireStaff(capability), takes identity from the session only, checks its inputs, and writes
 * ONLY through the hq RPCs (update_project_task, complete_task, set_task_waiting, resolve_task_waiting,
 * save_planning_item, set_milestone_launch_gate) or the settings row a director may change. Those apply
 * the task-update rule, record the task history and the audit trail. Nothing here changes a priority or
 * a due date unless the person set that field themselves in Quick edit.
 */

type Result = LeaderActionResult;
type DbError = { code?: string | null; message?: string | null; hint?: string | null } | null;

const GENERIC = "Something went wrong and nothing was saved. Try again in a moment.";
const FORBIDDEN = "You don't have permission to do that.";

function sentence(m: string): string {
  const t = m.trim();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? "" : "."}`;
}

function messageFor(error: DbError): string {
  const code = error?.code ?? "";
  if (code === "42501") return error?.hint === "task_assign_rule" && error.message ? sentence(error.message) : FORBIDDEN;
  if (code === "40001" && error?.message) return sentence(error.message);
  if ((code === "P0002" || code === "22023" || code === "23514") && error?.message) return sentence(error.message);
  return GENERIC;
}

function logged(where: string, error: DbError): void {
  console.error(`[hq] command center ${where} failed:`, error?.code ?? "unknown", error?.hint ?? "");
}

function refresh() {
  revalidatePath(HQ_BASE);
  revalidatePath(`${HQ_BASE}/operations`);
  revalidatePath(`${HQ_BASE}/projects`, "layout");
}

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbError }>;
async function rpcFor(capability: "tasks.write" | "projects.write" | "planning.write" | "settings.admin") {
  const { db, staff } = await requireStaff(capability);
  const rpc: Rpc = (fn, args) => (db.rpc as unknown as (this: unknown, f: string, a: Record<string, unknown>) => ReturnType<Rpc>).call(db, fn, args);
  return { db, staff, rpc };
}

async function today(db: Awaited<ReturnType<typeof rpcFor>>["db"], timezone: string): Promise<string> {
  const r = await db.rpc("today");
  if (typeof r.data === "string") return r.data;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const LANES: readonly Lane[] = ["do_now", "in_motion", "waiting", "coming_next"];
const LANE_DONE: Record<Lane, string> = { do_now: "Moved to Do now.", in_motion: "Moved to In motion.", waiting: "Moved to Waiting.", coming_next: "Moved to Coming next." };

/** Workboard: move ONE task to a lane (status and planned_for only; see lanes.ts laneMove). */
export async function moveToLane(taskId: string, lane: string, opts: { waitingOn?: string; plannedFor?: string } = {}): Promise<Result> {
  const { db, staff, rpc } = await rpcFor("tasks.write");
  if (!isUuid(taskId) || !(LANES as readonly string[]).includes(lane)) return { ok: false, message: GENERIC };
  const row = await db.from("task_overview").select(LEADER_TASK_COLS).eq("id", taskId).is("deleted_at", null).maybeSingle();
  if (row.error || !row.data) return { ok: false, message: "That task could not be found. It may have been archived." };
  const t = toLeaderTask(row.data as Record<string, unknown>);
  const day = await today(db, staff.timezone);
  const planned = opts.plannedFor && isIsoDate(opts.plannedFor) ? opts.plannedFor : undefined;
  const move = laneMove(t, lane as Lane, day, { waitingOn: opts.waitingOn?.slice(0, 200) ?? null, plannedFor: planned ?? null });
  if (!move.ok) return { ok: false, message: move.message };
  const { error } = await rpc("update_project_task", { p_id: taskId, p_patch: move.patch });
  if (error) {
    logged("moveToLane", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: move.note ? `${LANE_DONE[lane as Lane]} ${move.note}` : LANE_DONE[lane as Lane] };
}

/** Focus: plan a task for another day (planned_for only; the due date and priority are untouched). */
export async function planTaskFor(taskId: string, when: string): Promise<Result> {
  const { db, staff, rpc } = await rpcFor("tasks.write");
  if (!isUuid(taskId)) return { ok: false, message: GENERIC };
  const day = await today(db, staff.timezone);
  const target = when === "today" ? day : when === "tomorrow" ? addDays(day, 1) : when === "next_week" ? nextMonday(day) : when === "clear" ? null : isIsoDate(when) ? when : undefined;
  if (target === undefined) return { ok: false, message: "Choose a day." };
  const { error } = await rpc("update_project_task", { p_id: taskId, p_patch: { planned_for: target } });
  if (error) {
    logged("planTaskFor", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: target ? `Planned for ${target === day ? "today" : target === addDays(day, 1) ? "tomorrow" : target}. The due date has not changed.` : "No longer planned for a particular day." };
}

export async function completeLeaderTask(taskId: string): Promise<Result> {
  const { rpc } = await rpcFor("tasks.write");
  if (!isUuid(taskId)) return { ok: false, message: GENERIC };
  const { data, error } = await rpc("complete_task", { p_id: taskId, p_note: null });
  if (error) {
    logged("completeLeaderTask", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: (data as { changed?: boolean } | null)?.changed === false ? "That task was already completed." : "Task completed." };
}

const EDITABLE = ["priority", "due_date", "assignee", "planned_for", "waiting_on", "expected_response", "next_follow_up", "planning_item", "blocked_reason", "status"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["to_do", "in_progress", "waiting"];

/**
 * Quick edit: the fields the person changed (each one explicitly; an empty value clears it). Priority and
 * due date change only here, because the person chose them.
 */
export async function quickEditTask(taskId: string, fields: Record<string, string>): Promise<Result> {
  const { rpc } = await rpcFor("tasks.write");
  if (!isUuid(taskId)) return { ok: false, message: GENERIC };
  const patch: Record<string, string | null> = {};
  for (const [k, raw] of Object.entries(fields)) {
    if (!(EDITABLE as readonly string[]).includes(k)) continue;
    const v = typeof raw === "string" ? raw.trim() : "";
    if (k === "priority") {
      if (!PRIORITIES.includes(v)) return { ok: false, message: "Choose a priority." };
      patch.priority = v;
    } else if (k === "status") {
      if (!STATUSES.includes(v)) return { ok: false, message: "Choose a status." };
      patch.status = v;
    } else if (k === "due_date" || k === "planned_for" || k === "expected_response" || k === "next_follow_up") {
      if (v && !isIsoDate(v)) return { ok: false, message: "Use a real date." };
      patch[k] = v || null;
    } else if (k === "assignee" || k === "planning_item") {
      if (v && !isUuid(v)) return { ok: false, message: GENERIC };
      patch[k] = v || null;
    } else {
      patch[k] = v ? v.slice(0, k === "waiting_on" ? 200 : 500) : null;
    }
  }
  if (Object.keys(patch).length === 0) return { ok: true, message: "Nothing to change." };
  const { data, error } = await rpc("update_project_task", { p_id: taskId, p_patch: patch });
  if (error) {
    logged("quickEditTask", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: (data as { changed?: boolean } | null)?.changed === false ? "Nothing changed." : "Saved." };
}

/** Waiting On: the wait is over. The task moves to In motion (or To do), and the note goes into its comments. */
export async function resolveWaiting(taskId: string, next: string, note: string): Promise<Result> {
  const { rpc } = await rpcFor("tasks.write");
  if (!isUuid(taskId) || !["in_progress", "to_do", "completed"].includes(next)) return { ok: false, message: GENERIC };
  const { error } = await rpc("resolve_task_waiting", { p_task: taskId, p_next: next, p_note: note.trim().slice(0, 4000) || null });
  if (error) {
    logged("resolveWaiting", error);
    return { ok: false, message: error.hint === "not_waiting" ? "That task is not waiting on anything." : messageFor(error) };
  }
  refresh();
  return { ok: true, message: next === "completed" ? "Done: the task is completed." : next === "in_progress" ? "Moved to In motion." : "Moved back to To do." };
}

/** Waiting On: set (or clear) the next follow-up day. */
export async function setFollowUp(taskId: string, date: string): Promise<Result> {
  if (date && !isIsoDate(date)) return { ok: false, message: "Use a real date." };
  return quickEditTask(taskId, { next_follow_up: date });
}

/** Planning items (planning.write). An amount is a planning figure in whole dollars; it is never a balance. */
export async function savePlanningItem(input: {
  id?: string;
  kind?: string;
  title: string;
  detail: string;
  amount: string;
  expectedText: string;
  expectedBy: string;
  status: string;
  version?: number;
}): Promise<Result> {
  const { rpc } = await rpcFor("planning.write");
  const id = input.id && isUuid(input.id) ? input.id : null;
  const kind = (["funding", "dependency", "context"] as const).find((k) => k === input.kind) as PlanningKind | undefined;
  if (!id && !kind) return { ok: false, message: "Choose what kind of planning item this is." };
  const title = input.title.trim();
  if (!title) return { ok: false, message: "Give it a short title." };
  const amountText = input.amount.replace(/[$,\s]/g, "");
  if (amountText && !/^\d{1,9}$/.test(amountText)) return { ok: false, message: "Enter the amount in whole dollars, or leave it empty." };
  if (input.expectedBy && !isIsoDate(input.expectedBy)) return { ok: false, message: "Use a real date, or leave it empty." };
  const status = (["anticipated", "confirmed", "received", "current", "closed"] as const).find((s) => s === input.status) as PlanningStatus | undefined;
  const clear = [!input.detail.trim() && "detail", !amountText && "amount_anticipated", !input.expectedText.trim() && "expected_text", !input.expectedBy && "expected_by"].filter((x): x is string => !!x);
  const { error } = await rpc("save_planning_item", {
    p_id: id,
    p_kind: id ? null : kind,
    p_title: title,
    p_detail: input.detail.trim() || null,
    p_amount: amountText ? Number(amountText) : null,
    p_expected_text: input.expectedText.trim() || null,
    p_expected_by: input.expectedBy || null,
    p_status: status ?? null,
    p_clear: id ? clear : null,
    p_version: id && input.version ? input.version : null,
  });
  if (error) {
    logged("savePlanningItem", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: id ? "Planning item saved." : "Planning item added." };
}

/** Business launch: which project the command center tracks (settings.admin; the settings guard checks it is a live project). */
export async function setLaunchProject(projectId: string): Promise<Result> {
  const { db } = await requireStaff("settings.admin");
  if (!isUuid(projectId)) return { ok: false, message: "Choose a project." };
  const { error } = await db.from("settings").update({ value: projectId }).eq("key", "launch_project_id");
  if (error) {
    logged("setLaunchProject", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: "Launch project set." };
}

/** Business launch: mark a milestone as required (or not) before the business can open (projects.write). */
export async function setLaunchGate(milestoneId: string, gate: boolean): Promise<Result> {
  const { rpc } = await rpcFor("projects.write");
  if (!isUuid(milestoneId)) return { ok: false, message: GENERIC };
  const { error } = await rpc("set_milestone_launch_gate", { p_id: milestoneId, p_gate: gate });
  if (error) {
    logged("setLaunchGate", error);
    return { ok: false, message: messageFor(error) };
  }
  refresh();
  return { ok: true, message: gate ? "Marked as required to open." : "No longer counted as required to open." };
}

