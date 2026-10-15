import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { placeListText } from "@/lib/hq/contractors/form";
import { centsToDollarsInput } from "@/lib/hq/contractors/money";
import { getContractor } from "@/lib/hq/contractors/queries";
import { isUuid } from "@/lib/hq/forms";
import { todayInZone } from "@/lib/hq/growth/dates";
import { staffOptions } from "@/lib/hq/queries/options";
import { loadTrades } from "@/lib/hq/trades/queries";
import { tradeOptions } from "@/lib/hq/trades/rules";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { ContractorForm } from "@/components/hq/features/contractors/ContractorForm";

export const metadata: Metadata = { title: "Edit contractor" };

type Params = Promise<{ id: string }>;

export default async function EditContractorPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff } = await requireStaff("contractors.write");
  if (!isUuid(id)) notFound();

  const [found, staffList, trades] = await Promise.all([getContractor(db, id), staffOptions(db), loadTrades(db)]);
  if (!found.ok || !trades.ok) {
    return (
      <>
        <PageHeader title="Edit contractor" />
        <ErrorState title="We could not load this contractor" action={<LinkButton href={`/hq/partners/${id}/edit`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const c = found.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Contractors", href: "/hq/partners" }, { label: c.businessName, href: `/hq/partners/${c.id}` }, { label: "Edit" }]}
        title={`Edit ${c.businessName}`}
        description="Status is not changed here. Approve, suspend or move a contractor from their page."
      />
      <ContractorForm
        staff={staffList}
        cancelHref={`/hq/partners/${c.id}`}
        today={todayInZone(staff.timezone)}
        tradeOptions={tradeOptions(trades.data, c.categories)}
        initial={{
          id: c.id,
          version: c.updatedAt ?? undefined,
          businessName: c.businessName,
          primaryContactName: c.primaryContactName ?? "",
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          abn: c.abn ?? "",
          categories: c.categories,
          serviceSuburbs: placeListText(c.serviceSuburbs),
          serviceRegions: placeListText(c.serviceRegions),
          emergency: c.emergencyAvailable === true ? "yes" : c.emergencyAvailable === false ? "no" : "unknown",
          businessHours: c.businessHours ?? "",
          hourlyRate: centsToDollarsInput(c.hourlyRateCents),
          calloutFee: centsToDollarsInput(c.calloutFeeCents),
          afterHoursFee: centsToDollarsInput(c.afterHoursFeeCents),
          minimumCharge: centsToDollarsInput(c.minimumChargeCents),
          invoiceTerms: c.invoiceTerms ?? "",
          licenceDetails: c.licenceDetails ?? "",
          licenceExpiresOn: c.licenceExpiresOn ?? "",
          insuranceDetails: c.insuranceDetails ?? "",
          insuranceExpiresOn: c.insuranceExpiresOn ?? "",
          ownerId: c.ownerId ?? "",
          lastJobDate: c.lastJobDate ?? "",
          internalNotes: c.internalNotes ?? "",
        }}
      />
    </>
  );
}
