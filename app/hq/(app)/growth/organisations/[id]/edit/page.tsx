import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { getOrganisation } from "@/lib/hq/organisations/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { OrganisationForm } from "@/components/hq/features/organisations/OrganisationForm";

export const metadata: Metadata = { title: "Edit organisation" };

type Params = Promise<{ id: string }>;

export default async function EditOrganisationPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db } = await requireStaff("growth.write");
  if (!isUuid(id)) notFound();
  const [found, staffList] = await Promise.all([getOrganisation(db, id), staffOptions(db)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit organisation" />
        <ErrorState title="We could not load this organisation" action={<LinkButton href={`/hq/growth/organisations/${id}/edit`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const o = found.data;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Organisations", href: "/hq/growth/organisations" }, { label: o.name, href: `/hq/growth/organisations/${o.id}` }, { label: "Edit" }]}
        title={`Edit ${o.name}`}
      />
      <OrganisationForm
        staff={staffList}
        cancelHref={`/hq/growth/organisations/${o.id}`}
        initial={{
          id: o.id,
          version: o.updatedAt ?? undefined,
          name: o.name,
          categories: o.categories,
          website: o.website ?? "",
          phone: o.phone ?? "",
          email: o.email ?? "",
          location: o.location ?? "",
          serviceRegion: o.serviceRegion ?? "",
          ownerId: o.ownerId ?? "",
          notes: o.notes ?? "",
        }}
      />
    </>
  );
}
