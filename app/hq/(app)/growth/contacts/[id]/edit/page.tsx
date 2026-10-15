import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { getContact } from "@/lib/hq/contacts/queries";
import { isUuid } from "@/lib/hq/forms";
import { organisationOptions, staffOptions } from "@/lib/hq/queries/options";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { ContactForm } from "@/components/hq/features/contacts/ContactForm";

export const metadata: Metadata = { title: "Edit contact" };

type Params = Promise<{ id: string }>;

export default async function EditContactPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db } = await requireStaff("growth.write");
  if (!isUuid(id)) notFound();

  const [found, organisations, staffList] = await Promise.all([getContact(db, id), organisationOptions(db), staffOptions(db)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit contact" />
        <ErrorState title="We could not load this contact" action={<LinkButton href={`/hq/growth/contacts/${id}/edit`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const c = found.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: "/hq/growth/contacts" }, { label: c.fullName, href: `/hq/growth/contacts/${c.id}` }, { label: "Edit" }]}
        title={`Edit ${c.fullName}`}
      />
      <ContactForm
        organisations={organisations}
        staff={staffList}
        cancelHref={`/hq/growth/contacts/${c.id}`}
        initial={{
          id: c.id,
          version: c.updatedAt ?? undefined,
          fullName: c.fullName,
          organisationId: c.organisationId ?? "",
          position: c.position ?? "",
          categories: c.categories,
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          location: c.location ?? "",
          serviceRegion: c.serviceRegion ?? "",
          ownerId: c.ownerId ?? "",
          status: c.status,
          priority: c.priority,
          notes: c.notes ?? "",
          isPrimary: c.orgContactRole === "primary",
        }}
      />
    </>
  );
}
