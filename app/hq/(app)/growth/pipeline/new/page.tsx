import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { addDaysIso } from "@/lib/hq/leads/rules";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { LeadForm } from "@/components/hq/features/leads/LeadForm";

export const metadata: Metadata = { title: "Add a lead" };

export default async function NewLeadPage() {
  const { db, staff } = await requireStaff("growth.write", false, "/hq/growth/pipeline/new");
  const today = todayIn(staff.timezone);
  const staffList = await staffOptions(db);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Pipeline", href: "/hq/growth/pipeline" }, { label: "Add a lead" }]}
        title="Add a lead"
        description="A landlord from your own marketing, the website or a direct approach. Every lead has an owner, a next action and a follow-up date, so none is forgotten."
      />
      <LeadForm staff={staffList} staffId={staff.id} today={today} tomorrow={addDaysIso(today, 1)} />
    </>
  );
}
