import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { first } from "@/lib/hq/growth/params";
import { organisationOptions, staffOptions } from "@/lib/hq/queries/options";
import { PageHeader } from "@/components/hq";
import { ContactForm } from "@/components/hq/features/contacts/ContactForm";

export const metadata: Metadata = { title: "Add contact" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewContactPage({ searchParams }: { searchParams: SearchParams }) {
  const { db, staff } = await requireStaff("growth.write");
  const sp = await searchParams;
  const [organisations, staffList] = await Promise.all([organisationOptions(db), staffOptions(db)]);

  // `?organisation=<uuid>` (from "Add someone here" on an organisation) pre-selects it, but only if it is a real, live one.
  const wanted = first(sp.organisation);
  const organisationId = isUuid(wanted) && organisations.some((o) => o.value === wanted) ? wanted : "";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: "/hq/growth/contacts" }, { label: "Add contact" }]}
        title="Add contact"
        description="A name and a category is enough to start. You can fill in the rest as you get to know them."
      />
      <ContactForm
        organisations={organisations}
        staff={staffList}
        cancelHref={organisationId ? `/hq/growth/organisations/${organisationId}` : "/hq/growth/contacts"}
        initial={{
          fullName: "",
          organisationId,
          position: "",
          categories: [],
          phone: "",
          email: "",
          website: "",
          location: "",
          serviceRegion: "",
          ownerId: staff.id,
          status: "identified",
          priority: "medium",
          notes: "",
          isPrimary: false,
        }}
      />
    </>
  );
}
