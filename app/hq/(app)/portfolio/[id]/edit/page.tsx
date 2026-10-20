import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { getProperty, ownerOptions } from "@/lib/hq/portfolio/queries";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { PropertyForm } from "@/components/hq/features/portfolio/PropertyForm";
import { updateProperty } from "../../actions";

export const metadata: Metadata = { title: "Edit property" };

type Params = Promise<{ id: string }>;

export default async function EditPropertyPage({ params }: { params: Params }) {
  const { id } = await params;
  // Editing needs portfolio.write: anyone else who opens this URL is sent back out before anything loads.
  const { db, staff } = await requireStaff("portfolio.write", false, isUuid(id) ? `/hq/portfolio/${id}/edit` : "/hq/portfolio");
  if (!isUuid(id)) notFound();

  const [found, owners] = await Promise.all([getProperty(db, id), ownerOptions(db)]);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit property" />
        <ErrorState
          title="We could not load this property"
          action={
            <LinkButton href={`/hq/portfolio/${id}/edit`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data || found.data.property.archived) notFound();
  const p = found.data.property;
  // An owner contact who is not in the picker (a partner contact, say) stays selectable so saving does not drop it.
  const pickable = p.ownerContactId && !owners.some((o) => o.value === p.ownerContactId) ? [{ value: p.ownerContactId, label: p.ownerDisplayName ?? "Current owner" }, ...owners] : owners;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Properties", href: "/hq/portfolio" }, { label: p.ref, href: `/hq/portfolio/${p.id}` }, { label: "Edit" }]}
        title={`Edit ${p.ref}`}
        description="Correct the record or move its status. Every change is in the audit log."
      />
      <PropertyForm
        mode="edit"
        action={updateProperty}
        propertyId={p.id}
        version={p.updatedAt}
        owners={pickable}
        today={todayIn(staff.timezone)}
        cancelHref={`/hq/portfolio/${p.id}`}
        initial={{
          propertyAddress: p.propertyAddress,
          suburb: p.suburb ?? "",
          ownerContactId: p.ownerContactId ?? "",
          ownerName: p.ownerName ?? "",
          serviceType: p.serviceType,
          feeBasis: p.feeBasis ?? "",
          feePercent: p.feePercent === null ? "" : String(p.feePercent),
          feeNotes: p.feeNotes ?? "",
          agreementSignedOn: p.agreementSignedOn ?? "",
          managedFrom: p.managedFrom ?? "",
          status: p.status,
          endedOn: p.endedOn ?? "",
          ailoReference: p.ailoReference ?? "",
          ailoStatus: p.ailoStatus,
          notes: p.notes ?? "",
        }}
      />
    </>
  );
}
