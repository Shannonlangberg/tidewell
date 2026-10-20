import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid, strParam } from "@/lib/hq/forms";
import { ownerOptions, propertyForOpportunity } from "@/lib/hq/portfolio/queries";
import { EMPTY_PROPERTY, PropertyForm } from "@/components/hq/features/portfolio/PropertyForm";
import { ErrorState, InlineNote, LinkButton, PageHeader } from "@/components/hq";
import { addExistingProperty, convertToManagedProperty } from "../actions";

export const metadata: Metadata = { title: "New managed property" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Two ways in, both portfolio.write:
 *   ?opportunity=<id>  from a SIGNED lead ("Make this a managed property" on the lead's page): the
 *                      address, suburb and owner come from the lead unless typed here;
 *   no parameter       "Add a property signed before HQ": the address, owner and a note saying where
 *                      it came from are required.
 * The database refuses an unsigned lead and a second property for the same lead whatever this page does.
 */
export default async function NewPropertyPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const oppRaw = strParam(sp.opportunity, 64);
  const { db, staff } = await requireStaff("portfolio.write", false, oppRaw ? `/hq/portfolio/new?opportunity=${encodeURIComponent(oppRaw)}` : "/hq/portfolio/new");
  const today = todayIn(staff.timezone);
  const owners = await ownerOptions(db);
  const crumbs = [{ label: "Properties", href: "/hq/portfolio" }, { label: oppRaw ? "From a signed lead" : "Signed before HQ" }];

  if (!oppRaw) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Add a property signed before HQ" description="For a property Planted already managed before HQ existed. A newly signed lead is made a managed property from the lead's page instead." />
        <PropertyForm mode="manual" action={addExistingProperty} initial={EMPTY_PROPERTY} owners={owners} today={today} cancelHref="/hq/portfolio" />
      </>
    );
  }

  if (!isUuid(oppRaw)) notFound();
  const oppId = oppRaw.toLowerCase();
  const [opp, existing] = await Promise.all([
    db.from("opportunities").select("id, prospect_name, property_address, property_suburb, stage, owner_contact_id").eq("id", oppId).is("deleted_at", null).maybeSingle(),
    propertyForOpportunity(db, oppId),
  ]);
  if (opp.error || !existing.ok) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Make this a managed property" />
        <ErrorState title="We could not load this lead" action={<LinkButton href={`/hq/portfolio/new?opportunity=${oppId}`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!opp.data) notFound();
  if (existing.data) redirect(`/hq/portfolio/${existing.data.id}`);
  const o = opp.data;
  const leadHref = `/hq/growth/opportunities/${o.id}`;

  if (o.stage !== "management_signed") {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Make this a managed property" />
        <InlineNote>
          Only a signed management can become a managed property. <Link href={leadHref}>{o.prospect_name}</Link> is not signed yet.
        </InlineNote>
      </>
    );
  }

  let ownerLabel: string | null = null;
  if (o.owner_contact_id) {
    const c = await db.from("contacts").select("full_name").eq("id", o.owner_contact_id).maybeSingle();
    ownerLabel = c.data?.full_name ?? null;
  }
  const pickable = o.owner_contact_id && !owners.some((x) => x.value === o.owner_contact_id) ? [{ value: o.owner_contact_id, label: ownerLabel ?? "The lead's owner" }, ...owners] : owners;

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title="Make this a managed property"
        description={`From the signed lead ${o.prospect_name}. What the lead already holds is used unless you change it here.`}
      />
      <PropertyForm
        mode="convert"
        action={convertToManagedProperty}
        opportunityId={o.id}
        fromOpportunity={{ address: o.property_address, suburb: o.property_suburb, owner: ownerLabel ?? o.prospect_name }}
        initial={{ ...EMPTY_PROPERTY, ownerContactId: o.owner_contact_id ?? "" }}
        owners={pickable}
        today={today}
        cancelHref={leadHref}
      />
    </>
  );
}
