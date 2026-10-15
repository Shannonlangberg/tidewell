import { ErrorState } from "@/components/hq/EmptyState";
import { InlineNote, SectionLabel } from "@/components/hq/Primitives";
import { requireStaff } from "@/lib/hq/auth";
import { CLEARED_CONTRACTOR_STATUSES } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import { loadVetting } from "@/lib/hq/contractors/vetting-queries";
import { VETTING_STEP_STATUS_LABEL, vettingProgressLabel } from "@/lib/hq/contractors/vetting-steps";
import { VettingChecklist, type ChecklistStep } from "./VettingChecklist";

/*
 * The vetting checklist section of a contractor's profile. A Server Component: it loads its own
 * data (as the signed-in person, so row level security decides what comes back) and honours
 * capabilities. Without contractors.write the checklist is read-only.
 *
 * Approval is NOT here. This section says plainly that completing the steps never approves a
 * contractor: approval is a separate action by someone with permission to approve, and the
 * database refuses every other way of making a contractor approved or preferred.
 */
export async function VettingSection({ contractorId }: { contractorId: string }) {
  const { staff, can } = await requireStaff("contractors.read");
  const canWrite = can("contractors.write");

  let data: Awaited<ReturnType<typeof loadVetting>>;
  try {
    data = await loadVetting(contractorId);
  } catch (e) {
    console.error("[hq] vetting section failed:", e instanceof Error ? e.message : "error");
    return (
      <section aria-labelledby="vetting-h">
        <SectionLabel as="h2" id="vetting-h" className="mb-3.5 border-b border-line pb-3.5">
          Vetting checklist
        </SectionLabel>
        <ErrorState title="We could not load the vetting checklist" />
      </section>
    );
  }

  const cleared = data.contractorStatus !== null && CLEARED_CONTRACTOR_STATUSES.includes(data.contractorStatus);
  const steps: ChecklistStep[] = data.rows.map((r, i) => ({
    step: r.step,
    number: i + 1,
    status: r.status,
    note: r.note,
    completedLine:
      (r.status === "done" || r.status === "not_applicable") && r.completedAt
        ? `${VETTING_STEP_STATUS_LABEL[r.status]}${r.completedByName ? ` by ${r.completedByName}` : ""}, ${formatDateTime(r.completedAt, staff.timezone)}`
        : null,
  }));

  return (
    <section aria-labelledby="vetting-h">
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3.5">
        <SectionLabel as="h2" id="vetting-h">
          Vetting checklist
        </SectionLabel>
        <p className="hq-nums text-[13px] text-grey-text" aria-label={`${vettingProgressLabel(data.rows)} steps done`}>
          {vettingProgressLabel(data.rows)} steps
        </p>
      </div>

      <InlineNote className="mb-5">
        {cleared
          ? "This contractor has been approved by a person. Moving a step back does not change that: only a person with permission can suspend or change the approval."
          : "Completing these steps does not approve a contractor. Approval is a separate, explicit action by someone with permission to approve, and it is never automatic."}
      </InlineNote>

      <VettingChecklist contractorId={contractorId} steps={steps} canWrite={canWrite} />

      {!canWrite ? <p className="hq-muted mt-4 text-[13px]">Your role can read this checklist but not change it.</p> : null}
    </section>
  );
}
