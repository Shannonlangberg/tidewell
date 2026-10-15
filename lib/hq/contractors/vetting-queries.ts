import "server-only";

import { requireStaff } from "../auth";
import { CHECKLIST_STEPS, type VettingStepStatus } from "./vetting-steps";
import type { ContractorStatus, VettingStep } from "../constants";
import { staffNameMap } from "./section-names";

export type VettingRow = {
  step: VettingStep;
  status: VettingStepStatus;
  note: string | null;
  completedBy: string | null;
  completedByName: string | null;
  completedAt: string | null;
};

export type VettingData = {
  contractorStatus: ContractorStatus | null;
  rows: VettingRow[];
};

/** The nine steps in checklist order. Throws on a database error (the section shows an error state). */
export async function loadVetting(contractorId: string): Promise<VettingData> {
  const { db } = await requireStaff("contractors.read");
  const [steps, contractor] = await Promise.all([
    db.from("contractor_vetting_steps").select("step, status, note, completed_by, completed_at").eq("contractor_id", contractorId),
    db.from("contractor_directory").select("status").eq("id", contractorId).maybeSingle(),
  ]);
  if (steps.error) throw new Error(`vetting steps ${steps.error.code}`);
  if (contractor.error) throw new Error(`vetting contractor ${contractor.error.code}`);

  const names = await staffNameMap(db, (steps.data ?? []).map((s) => s.completed_by));
  const byStep = new Map((steps.data ?? []).map((s) => [s.step, s]));
  const rows: VettingRow[] = CHECKLIST_STEPS.map((step) => {
    const s = byStep.get(step);
    return {
      step,
      status: (s?.status ?? "not_started") as VettingStepStatus,
      note: s?.note ?? null,
      completedBy: s?.completed_by ?? null,
      completedByName: s?.completed_by ? (names.get(s.completed_by) ?? null) : null,
      completedAt: s?.completed_at ?? null,
    };
  });
  return { contractorStatus: (contractor.data?.status ?? null) as ContractorStatus | null, rows };
}
