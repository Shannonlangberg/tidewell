import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { maxDecisionDate } from "@/lib/hq/decisions/rules";
import { getDecision } from "@/lib/hq/decisions/queries";
import { staffOptions, type Option } from "@/lib/hq/queries/options";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { DecisionForm } from "@/components/hq/features/decisions/DecisionForm";
import { updateDecision } from "../../actions";

export const metadata: Metadata = { title: "Edit decision" };

type Params = Promise<{ id: string }>;

export default async function EditDecisionPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff } = await requireStaff("decisions.write", false, isUuid(id) ? `/hq/decisions/${id}/edit` : "/hq/decisions");
  if (!isUuid(id)) notFound();

  const [found, people] = await Promise.all([getDecision(db, id, { historyLimit: 1 }), staffOptions(db)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit decision" />
        <ErrorState
          title="We could not load this decision"
          action={
            <LinkButton href={`/hq/decisions/${id}/edit`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data || found.data.decision.archived) notFound();
  const d = found.data.decision;
  const today = todayIn(staff.timezone);

  // A decision maker who has since left is not in the active list: keep them selectable so saving does not silently change it.
  const makers: Option[] = people.some((p) => p.value === d.decisionMakerId) ? people : [{ value: d.decisionMakerId, label: d.decisionMakerName ?? "Current decision maker" }, ...people];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Decisions", href: "/hq/decisions" }, { label: d.ref, href: `/hq/decisions/${d.id}` }, { label: "Edit" }]}
        title={`Edit ${d.ref}`}
        description="Correct or update the decision. Every change is kept in its history. To replace or undo it, use Supersede or Reverse on its page."
      />
      <DecisionForm
        mode="edit"
        action={updateDecision}
        decisionId={d.id}
        version={d.updatedAt}
        initial={{
          title: d.title,
          category: d.category,
          decisionDate: d.decisionDate,
          status: d.status,
          decisionMakerId: d.decisionMakerId,
          description: d.description ?? "",
          rationale: d.rationale ?? "",
        }}
        staff={makers}
        maxDate={d.decisionDate > maxDecisionDate(today) ? d.decisionDate : maxDecisionDate(today)}
        cancelHref={`/hq/decisions/${d.id}`}
      />
    </>
  );
}
