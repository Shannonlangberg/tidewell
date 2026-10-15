import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { OrganisationForm } from "@/components/hq/features/organisations/OrganisationForm";

export const metadata: Metadata = { title: "Add organisation" };

export default async function NewOrganisationPage() {
  const { db, staff } = await requireStaff("growth.write");
  const staffList = await staffOptions(db);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Organisations", href: "/hq/growth/organisations" }, { label: "Add organisation" }]}
        title="Add organisation"
        description="A name and at least one category. You can add the people who work there afterwards."
      />
      <OrganisationForm
        staff={staffList}
        cancelHref="/hq/growth/organisations"
        initial={{ name: "", categories: [], website: "", phone: "", email: "", location: "", serviceRegion: "", ownerId: staff.id, notes: "" }}
      />
    </>
  );
}
