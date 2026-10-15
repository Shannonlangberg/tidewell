import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayInZone } from "@/lib/hq/growth/dates";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { BLANK_CONTRACTOR, ContractorForm } from "@/components/hq/features/contractors/ContractorForm";

export const metadata: Metadata = { title: "Add contractor" };

export default async function NewContractorPage() {
  const { db, staff } = await requireStaff("contractors.write");
  const staffList = await staffOptions(db);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Partners", href: "/hq/partners" }, { label: "Contractors", href: "/hq/partners" }, { label: "Add contractor" }]}
        title="Add contractor"
        description="Record what you know and leave the rest blank. A new contractor starts as a prospect and is not cleared to be sent to a property until a person has vetted and approved them."
      />
      <ContractorForm initial={BLANK_CONTRACTOR} staff={staffList} cancelHref="/hq/partners" today={todayInZone(staff.timezone)} />
    </>
  );
}
