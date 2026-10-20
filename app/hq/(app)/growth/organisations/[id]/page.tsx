import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { MeetingsFor } from "@/components/hq/features/meetings/MeetingsFor";
import { listInteractions, referralSummary, TIMELINE_LIMIT } from "@/lib/hq/contacts/queries";
import { isUuid } from "@/lib/hq/forms";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { agoLabel, nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { getOrganisation, organisationContacts } from "@/lib/hq/organisations/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { getReferralPartner } from "@/lib/hq/referral-partners/queries";
import { EmptyState, ErrorState, KeyValueList, LinkButton, PageHeader, SectionLabel, StatusChip, buildHref, type KeyValueItem } from "@/components/hq";
import { ArchiveButton } from "@/components/hq/features/contacts/ArchiveButton";
import { CategoryTags, NeedsVerifyingChip } from "@/components/hq/features/contacts/Bits";
import { LogInteractionDrawer } from "@/components/hq/features/contacts/LogInteractionDrawer";
import { ReferralsBlock } from "@/components/hq/features/contacts/Panels";
import { InteractionTimeline } from "@/components/hq/features/contacts/Timeline";
import { VerifyNotice } from "@/components/hq/features/contacts/Verify";
import { OrganisationContacts } from "@/components/hq/features/organisations/OrganisationContacts";
import { PartnerSummaryBlock } from "@/components/hq/features/referral-partners/PartnerSummaryBlock";
import { archiveOrganisation, verifyOrganisation } from "../actions";

export const metadata: Metadata = { title: "Organisation" };

const BASE = "/hq/growth/organisations";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrganisationPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(`${BASE}/${isUuid(id) ? id : ""}`, sp));
  if (!isUuid(id)) notFound();

  const found = await getOrganisation(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Organisations", href: BASE }, { label: "Organisation" }]} title="Organisation" />
        <ErrorState title="We could not load this organisation" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const o = found.data;

  const canWrite = can("growth.write");
  const canDelete = can("growth.delete");
  const tz = staff.timezone;
  const today = todayInZone(tz);

  const [contacts, history, referrals, staffList, partner] = await Promise.all([
    organisationContacts(db, id),
    listInteractions(db, { organisationId: id }),
    referralSummary(db, { organisationId: id }),
    canWrite ? staffOptions(db) : Promise.resolve([]),
    getReferralPartner(db, id),
  ]);
  // The partner summary carries "last contacted" (contacts AND organisation-level interactions); the
  // details list only falls back to its own figure when the summary could not be loaded.
  const hasSummary = partner.ok && partner.data !== null;

  const referralHref = `/hq/growth/referrals/new?partner_organisation=${o.id}`;
  const logHref = buildHref(`${BASE}/${id}`, sp, { log: "call" });

  const details: KeyValueItem[] = [
    { label: "Categories", value: <CategoryTags categories={o.categories} /> },
    { label: "Region", value: o.serviceRegion },
    { label: "Owner", empty: "No owner", value: o.ownerName },
    { label: "Phone", value: o.phone ? <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{o.phone}</a> : null },
    { label: "Email", value: o.email ? <a href={`mailto:${o.email}`} className="underline underline-offset-2">{o.email}</a> : null },
    {
      label: "Website",
      value: o.website ? (
        <a href={o.website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {o.website.replace(/^https?:\/\//i, "")}
        </a>
      ) : null,
    },
    { label: "Location", value: o.location },
    ...(hasSummary ? [] : [{
      label: "Last interaction",
      empty: "Not contacted yet",
      value: o.lastContactAt ? (
        <time dateTime={o.lastContactAt}>
          {agoLabel(o.lastContactAt, tz)}
          <span className="block text-[13px] font-normal text-grey-text">{formatDateTime(o.lastContactAt, tz)}</span>
        </time>
      ) : null,
    }]),
    { label: "Source", value: o.source },
    { label: "Verification", value: o.needsVerification ? <NeedsVerifyingChip /> : o.verifiedAt ? `Verified ${formatDate(o.verifiedAt, tz)}` : "No flag" },
    { label: "Added", value: o.createdAt ? formatDate(o.createdAt, tz) : null },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Organisations", href: BASE }, { label: o.name }]}
        title={o.name}
        description={o.serviceRegion ?? undefined}
        meta={
          <>
            <StatusChip plain>
              {o.contactCount} {o.contactCount === 1 ? "contact" : "contacts"}
            </StatusChip>
            {o.needsVerification ? <NeedsVerifyingChip /> : null}
          </>
        }
        actions={
          canWrite && o.contactCount > 0 ? (
            <LinkButton href={logHref} variant="primary" icon="phone">
              Log a call
            </LinkButton>
          ) : undefined
        }
      />

      {canWrite || canDelete ? (
        <div className="-mt-4 mb-8 flex flex-wrap items-center gap-2">
          {canWrite ? (
            <LinkButton href={`/hq/growth/contacts/new?organisation=${o.id}`} size="sm" icon="plus">
              Add contact
            </LinkButton>
          ) : null}
          {canWrite ? (
            <LinkButton href={referralHref} size="sm" icon="link">
              Record a referral
            </LinkButton>
          ) : null}
          {canWrite ? (
            <LinkButton href={`${BASE}/${id}/edit`} size="sm">
              Edit
            </LinkButton>
          ) : null}
          {canDelete ? (
            <ArchiveButton
              id={o.id}
              noun="organisation"
              name={o.name}
              size="sm"
              action={archiveOrganisation}
              consequence="It will no longer appear in lists or search. An organisation that still has contacts cannot be archived: archive or move them first. A director can restore it."
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {o.needsVerification ? <VerifyNotice id={o.id} noun="organisation" action={verifyOrganisation} canVerify={canWrite} /> : null}

          <section aria-labelledby="contacts-h" className="mb-12">
            <SectionLabel as="h2" id="contacts-h" className="mb-4">
              Contacts
            </SectionLabel>
            {!contacts.ok ? (
              <ErrorState title="We could not load the contacts" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
            ) : contacts.data.length === 0 ? (
              <EmptyState
                compact
                title="No contacts yet"
                action={
                  canWrite ? (
                    <LinkButton href={`/hq/growth/contacts/new?organisation=${o.id}`} variant="primary" size="sm" icon="plus">
                      Add contact
                    </LinkButton>
                  ) : undefined
                }
              >
                Add the first person you know at {o.name}.
              </EmptyState>
            ) : (
              <OrganisationContacts contacts={contacts.data} timezone={tz} today={today} canWrite={canWrite} />
            )}
          </section>

          {o.notes ? (
            <section className="mb-12" aria-labelledby="notes-h">
              <SectionLabel as="h2" id="notes-h" className="mb-3 border-b border-line pb-3.5">
                Notes
              </SectionLabel>
              <p className="whitespace-pre-line text-[14px]">{o.notes}</p>
            </section>
          ) : null}

          <section aria-labelledby="history-h">
            <SectionLabel as="h2" id="history-h" className="mb-5 border-b border-line pb-3.5">
              Contact history
            </SectionLabel>
            {!history.ok ? (
              <ErrorState title="We could not load the history" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
            ) : history.data.items.length === 0 ? (
              <EmptyState compact title="No interactions yet">
                Calls, meetings and notes with anyone at {o.name} appear here, newest first.
              </EmptyState>
            ) : (
              <>
                <InteractionTimeline items={history.data.items} timezone={tz} today={today} label={`Interactions with ${o.name}, newest first`} showContact />
                {history.data.more ? <p className="mt-6 text-[13px] text-grey-text">Showing the latest {TIMELINE_LIMIT} interactions.</p> : null}
              </>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-7" aria-label="Organisation details">
          <PartnerSummaryBlock partner={partner} timezone={tz} today={today} />
          <section aria-labelledby="details-h" className="border-t border-line pt-5">
            <SectionLabel as="h2" id="details-h" className="mb-3.5">
              Details
            </SectionLabel>
            <KeyValueList items={details} />
          </section>
          <ReferralsBlock summary={referrals} who="this organisation" recordHref={canWrite ? referralHref : undefined} />
          <MeetingsFor kind="organisation" id={o.id} />
        </aside>
      </div>

      {canWrite && contacts.ok ? (
        <LogInteractionDrawer
          contact={null}
          organisation={{ id: o.id, name: o.name }}
          contactOptions={contacts.data.map((c) => ({ value: c.id, label: c.fullName }))}
          staffOptions={staffList}
          canCreateTasks={can("tasks.write")}
          staffId={staff.id}
          timezone={tz}
          serverNowLocal={nowLocalInput(tz)}
          today={today}
          returnTo="organisation"
        />
      ) : null}
    </>
  );
}
