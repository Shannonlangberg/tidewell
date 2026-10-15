/*
 * The vetting checklist: the nine steps, what each asks a person to check, how a step may be
 * updated, and how a posted update is read.
 *
 * Pure and client-safe (type-only imports plus constants), so `node --test` runs it.
 *
 * The rules mirror hq.set_vetting_step (docs/hq-phase-2.md 11.5): `not_applicable` needs a
 * note; `review_and_approve` is never set here (it becomes done only inside approve_contractor);
 * a blank note clears the note. The database enforces all of it again.
 */

import type { VettingStep } from "../constants";
import type { FormReader } from "../forms";

/*
 * No value imports on purpose: the unit tests run under Node's type stripping, which needs `.ts`
 * in relative imports, and the project's tsconfig rejects that in source files (see
 * lib/hq/tasks/rules.ts). The step list is written out here and pinned to constants.ts by a test.
 */
export const CHECKLIST_STEPS: readonly VettingStep[] = [
  "identity",
  "abn",
  "licence",
  "insurance",
  "service_areas",
  "pricing",
  "emergency_availability",
  "communication",
  "review_and_approve",
]; // constants.ts VETTING_STEPS

export const VETTING_STEP_STATUSES = ["not_started", "in_progress", "done", "not_applicable"] as const;
export type VettingStepStatus = (typeof VETTING_STEP_STATUSES)[number];

export const VETTING_STEP_STATUS_LABEL: Record<VettingStepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Done",
  not_applicable: "Not applicable",
};

export const VETTING_STEP_STATUS_TONE: Record<VettingStepStatus, "neutral" | "info" | "success"> = {
  not_started: "neutral",
  in_progress: "info",
  done: "success",
  not_applicable: "neutral",
};

/** The steps a person updates by hand: all but the last, which approval completes. */
export const MANUAL_VETTING_STEPS = CHECKLIST_STEPS.filter((s) => s !== "review_and_approve") as readonly Exclude<VettingStep, "review_and_approve">[];

/** What to check at each step. Guidance only: nothing here states a fact about any contractor. */
export const VETTING_STEP_HINT: Record<VettingStep, string> = {
  identity: "Confirm who the business is and who you deal with.",
  abn: "Check the ABN on the Australian Business Register yourself. HQ checks the number's format only.",
  licence: "Confirm the licence the trade requires. If none is required, mark it not applicable and say why.",
  insurance: "Confirm public liability cover and that it is current.",
  service_areas: "Record the suburbs and regions they will work in.",
  pricing: "Record call-out fee, hourly rate and invoice terms.",
  emergency_availability: "Record whether they take after-hours or emergency calls.",
  communication: "Check they answer, quote and report back in a way that suits Planted.",
  review_and_approve: "Completed only when someone with permission approves the contractor.",
};

export const NOTE_MAX = 1000;

export type VettingStepUpdate = {
  contractorId: string;
  step: Exclude<VettingStep, "review_and_approve">;
  status: VettingStepStatus;
  note: string | null;
};

/** Reads a posted step update through the caller's FormReader (so `f.ok` and `f.fail()` stay with the caller). */
export function readVettingStepForm(f: FormReader): VettingStepUpdate | null {
  const contractorId = f.uuid("contractor_id", { required: true });
  const step = f.oneOf("step", MANUAL_VETTING_STEPS, { required: true });
  const status = f.oneOf("status", VETTING_STEP_STATUSES, { required: true });
  const note = f.text("note", { max: NOTE_MAX, label: "The note" });
  if (status === "not_applicable" && !note && !f.errors.note) {
    f.errors.note = "Say why this step does not apply.";
  }
  if (!f.ok || !contractorId || !step || !status) return null;
  return { contractorId, step, status, note };
}

/** "5 of 9": the number of steps that are done or not applicable. */
export function vettingProgressLabel(rows: ReadonlyArray<{ status: string }>): string {
  const done = rows.filter((r) => r.status === "done" || r.status === "not_applicable").length;
  return `${done} of ${CHECKLIST_STEPS.length}`;
}

export function vettingDoneCount(rows: ReadonlyArray<{ status: string }>): number {
  return rows.filter((r) => r.status === "done" || r.status === "not_applicable").length;
}

