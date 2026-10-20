import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { maxDecisionDate } from "@/lib/hq/decisions/rules";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { DecisionForm } from "@/components/hq/features/decisions/DecisionForm";
import { createDecision } from "../actions";

export const metadata: Metadata = { title: "Record a decision" };

export default async function NewDecisionPage() {
  // Recording needs decisions.write: anyone else who opens this URL is sent back out before anything loads.
  const { db, staff } = await requireStaff("decisions.write", false, "/hq/decisions/new");
  const today = todayIn(staff.timezone);
  const people = await staffOptions(db);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Decisions", href: "/hq/decisions" }, { label: "Record a decision" }]}
        title="Record a decision"
        description="Write it down while it is fresh: what was decided, who decided, and why."
      />
      <DecisionForm
        mode="create"
        action={createDecision}
        initial={{ title: "", category: "", decisionDate: today, status: "decided", decisionMakerId: staff.id, description: "", rationale: "" }}
        staff={people}
        maxDate={maxDecisionDate(today)}
        cancelHref="/hq/decisions"
      />
    </>
  );
}
