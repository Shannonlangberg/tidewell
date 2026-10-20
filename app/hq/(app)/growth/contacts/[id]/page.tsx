import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PRIORITIES, PRIORITY_LABEL, RELATIONSHIP_LABEL, RELATIONSHIP_STATUSES, STAGE_LABEL } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import {
  firstInteractionAt,
  getContact,
  listInteractions,
  openTasksForContact,
  referralSummary,
  sameOrganisationContacts,
  TIMELINE_LIMIT,
} from "@/lib/hq/contacts/queries";
import { isUuid } from "@/lib/hq/forms";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { agoLabel, followUpState, nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { staffOptions } from "@/lib/hq/queries/options";
import {
  EmptyState,
  ErrorState,
  KeyValueList,
  LinkButton,
  PageHeader,
  PriorityChip,
  RelationshipChip,
  SectionLabel,
  buildHref,
  type KeyValueItem,
} from "@/components/hq";
import { ArchiveButton } from "@/components/hq/features/contacts/ArchiveButton";
import { CategoryTags, FollowUpCell, KindChip, NeedsVerifyingChip } from "@/components/hq/features/contacts/Bits";
import { leadsForContact } from "@/lib/hq/leads/queries";
import { InlineField } from "@/components/hq/features/contacts/InlineField";
import { LogInteractionDrawer } from "@/components/hq/features/contacts/LogInteractionDrawer";
import { MakePrimaryButton } from "@/components/hq/features/contacts/MakePrimary";
import { OpenTasksBlock, ReferralsBlock, SameOrganisationBlock } from "@/components/hq/features/contacts/Panels";
import { InteractionTimeline } from "@/components/hq/features/contacts/Timeline";
import { VerifyNotice } from "@/components/hq/features/contacts/Verify";
import { archiveContact, makePrimaryContact, verifyContact } from "../actions";

export const metadata: Metadata = { title: "Contact" };

const BASE = "/hq/growth/contacts";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(`${BASE}/${isUuid(id) ? id : ""}`, sp));
  if (!isUuid(id)) notFound();

  const found = await getContact(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: BASE }, { label: "Contact" }]} title="Contact" />
        <ErrorState title="We could not load this contact" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const c = found.data;

  const canWrite = can("growth.write");
  const canDelete = can("growth.delete");
  const canTask = can("tasks.write");
  const canEmail = can("email.draft") && Boolean(c.email);
  const today = todayInZone(staff.timezone);
  const tz = staff.timezone;

  const partner = c.kind === "partner";
  const [timeline, firstAt, sameOrg, referrals, tasks, staffList, leads] = await Promise.all([
    listInteractions(db, { contactId: id }),
    firstInteractionAt(db, id),
    c.organisationId ? sameOrganisationContacts(db, c.organisationId, id) : Promise.resolve(null),
    referralSummary(db, { contactId: id }),
    openTasksForContact(db, id),
    canWrite ? staffOptions(db) : Promise.resolve([]),
    leadsForContact(db, id),
  ]);
  const leadList = leads.ok ? leads.data : [];

  // ── links to the other builders' screens (see the cross-builder contract) ──
  const taskParams = new URLSearchParams({ contact: c.id, title: `Follow up with ${c.fullName}` });
  if (c.organisationId) taskParams.set("organisation", c.organisationId);
  if (c.nextFollowUpDate && c.nextFollowUpDate >= today) taskParams.set("due", c.nextFollowUpDate);
  const taskHref = `/hq/operations/tasks/new?${taskParams.toString()}`;
  const referralHref = `/hq/growth/referrals/new?partner_contact=${c.id}`;

  const logHref = (type: string) => buildHref(`${BASE}/${id}`, sp, { log: type });
  const state = followUpState(c.nextFollowUpDate, today);

  const details: KeyValueItem[] = [
    {
      label: "Status",
      value: canWrite ? (
        <InlineField
          kind="select"
          contactId={c.id}
          field="relationship_status"
          label="Relationship status"
          value={c.status}
          options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABEL[s] }))}
        />
      ) : (
        <RelationshipChip status={c.status} />
      ),
    },
    {
      label: "Priority",
      value: canWrite ? (
        <InlineField kind="select" contactId={c.id} field="priority" label="Priority" value={c.priority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
      ) : (
        <PriorityChip priority={c.priority} />
      ),
    },
    {
      label: "Owner",
      empty: "No owner",
      value: canWrite ? (
        <InlineField kind="picker" contactId={c.id} field="relationship_owner_id" label="Relationship owner" value={c.ownerId ?? ""} options={staffList} placeholder="No owner" />
      ) : (
        c.ownerName
      ),
    },
    {
      label: "Next follow-up",
      value: (
        <>
          {canWrite ? (
            <InlineField kind="date" contactId={c.id} field="next_follow_up_date" label="Next follow-up date" value={c.nextFollowUpDate ?? ""} min={today} />
          ) : null}
          {state.kind !== "none" || !canWrite ? (
            <div className={canWrite ? "mt-1.5" : undefined}>
              <FollowUpCell date={c.nextFollowUpDate} today={today} />
            </div>
          ) : null}
        </>
      ),
    },
    { label: "Phone", value: c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{c.phone}</a> : null },
    { label: "Email", value: c.email ? <a href={`mailto:${c.email}`} className="underline underline-offset-2">{c.email}</a> : null },
    {
      label: "Website",
      value: c.website ? (
        <a href={c.website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          {c.website.replace(/^https?:\/\//i, "")}
        </a>
      ) : null,
    },
    { label: "Location", value: c.location },
    { label: "Region", value: c.serviceRegion },
    { label: "Categories", value: c.categories.length > 0 ? <CategoryTags categories={c.categories} /> : null },
    {
      label: "At the organisation",
      empty: c.organisationId ? "Not recorded" : "Not part of an organisation",
      value: c.organisationId ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>{c.orgContactRole === "primary" ? "Primary contact" : c.orgContactRole === "secondary" ? "Secondary contact" : "Other"}</span>
          {canWrite && c.orgContactRole !== "primary" ? <MakePrimaryButton id={c.id} returnTo="contact" action={makePrimaryContact} name={c.fullName} /> : null}
        </span>
      ) : null,
    },
    {
      label: "Last contact",
      empty: "Not contacted yet",
      value: c.lastContactAt ? (
        <time dateTime={c.lastContactAt}>
          {agoLabel(c.lastContactAt, tz)}
          <span className="block text-[13px] font-normal text-grey-text">{formatDateTime(c.lastContactAt, tz)}</span>
        </time>
      ) : null,
    },
    { label: "First contact", empty: "Not contacted yet", value: firstAt ? formatDate(firstAt, tz) : null },
    { label: "Source", value: c.source },
    {
      label: "Verification",
      value: c.needsVerification ? <NeedsVerifyingChip /> : c.verifiedAt ? `Verified ${formatDate(c.verifiedAt, tz)}` : "No flag",
    },
    { label: "Added", value: c.createdAt ? formatDate(c.createdAt, tz) : null },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: BASE }, { label: c.fullName }]}
        title={c.fullName}
        description={
          c.position || c.organisationName ? (
            <>
              {c.position}
              {c.position && c.organisationName ? " · " : null}
              {c.organisationId && c.organisationName ? (
                <Link href={`/hq/growth/organisations/${c.organisationId}`} className="underline underline-offset-2">
                  {c.organisationName}
                </Link>
              ) : (
                c.organisationName
              )}
            </>
          ) : undefined
        }
        meta={
          <>
            <KindChip kind={c.kind} />
            {partner ? <RelationshipChip status={c.status} /> : null}
            {partner ? <PriorityChip priority={c.priority} /> : null}
            {c.needsVerification ? <NeedsVerifyingChip /> : null}
          </>
        }
        actions={
          canWrite ? (
            <>
              <LinkButton href={logHref("phone_call")} variant="primary" icon="phone">
                Log a call
              </LinkButton>
              <LinkButton href={logHref("coffee_meeting")} icon="coffee">
                Log a meeting
              </LinkButton>
              <LinkButton href={logHref("note")} icon="note">
                Add note
              </LinkButton>
            </>
          ) : undefined
        }
      />

      {canWrite || canDelete || canEmail ? (
        <div className="-mt-4 mb-8 flex flex-wrap items-center gap-2">
          {canEmail ? (
            <LinkButton href={`/hq/email/new?contact=${c.id}`} size="sm" icon="mail">
              Draft an email
            </LinkButton>
          ) : null}
          {canTask ? (
            <LinkButton href={taskHref} size="sm" icon="task">
              Create follow-up task
            </LinkButton>
          ) : null}
          {canWrite && partner ? (
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
              id={c.id}
              noun="contact"
              name={c.fullName}
              size="sm"
              action={archiveContact}
              consequence="Their history is kept, and they will no longer appear in lists or search. A director can restore them."
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {c.needsVerification ? <VerifyNotice id={c.id} noun="contact" action={verifyContact} canVerify={canWrite} /> : null}

          {c.notes ? (
            <section className="mb-10" aria-labelledby="notes-h">
              <SectionLabel as="h2" id="notes-h" className="mb-3 border-b border-line pb-3.5">
                Notes
              </SectionLabel>
              <p className="whitespace-pre-line text-[14px]">{c.notes}</p>
            </section>
          ) : null}

          <section aria-labelledby="timeline-h">
            <SectionLabel as="h2" id="timeline-h" className="mb-5 border-b border-line pb-3.5">
              Relationship timeline
            </SectionLabel>
            {!timeline.ok ? (
              <ErrorState title="We could not load the timeline" action={<LinkButton href={`${BASE}/${id}`} size="sm">Try again</LinkButton>} />
            ) : timeline.data.items.length === 0 ? (
              <EmptyState
                compact
                title="No interactions yet"
                action={
                  canWrite ? (
                    <LinkButton href={logHref("phone_call")} variant="primary" size="sm" icon="phone">
                      Log a call
                    </LinkButton>
                  ) : undefined
                }
              >
                Log your first call.
              </EmptyState>
            ) : (
              <>
                <InteractionTimeline items={timeline.data.items} timezone={tz} today={today} label={`Interactions with ${c.fullName}, newest first`} />
                {timeline.data.more ? <p className="mt-6 text-[13px] text-grey-text">Showing the latest {TIMELINE_LIMIT} interactions.</p> : null}
              </>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-7" aria-label="Contact details">
          <section aria-labelledby="details-h">
            <SectionLabel as="h2" id="details-h" className="mb-3.5">
              Details
            </SectionLabel>
            <KeyValueList items={details} />
          </section>
          {c.organisationId && c.organisationName && sameOrg ? (
            <SameOrganisationBlock
              organisationName={c.organisationName}
              organisationHref={`/hq/growth/organisations/${c.organisationId}`}
              contacts={sameOrg}
              addHref={canWrite ? `${BASE}/new?organisation=${c.organisationId}` : undefined}
            />
          ) : null}
          {leadList.length > 0 || !partner ? (
            <section aria-labelledby="leads-h">
              <SectionLabel as="h2" id="leads-h" className="mb-3.5">
                {leadList.length === 1 ? "Lead" : "Leads"}
              </SectionLabel>
              {!leads.ok ? (
                <p className="hq-muted text-[14px]">The leads could not be loaded just now.</p>
              ) : leadList.length === 0 ? (
                <p className="hq-muted text-[14px]">
                  Not linked to a lead.{" "}
                  {canWrite ? (
                    <Link href="/hq/growth/pipeline/new" className="underline underline-offset-2">
                      Add a lead
                    </Link>
                  ) : null}
                </p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {leadList.map((l) => (
                    <li key={l.id} className="border-b border-line py-2.5 text-[14px]">
                      <Link href={`/hq/growth/opportunities/${l.id}`}>
                        {l.ref}
                        {l.suburb ? `, ${l.suburb}` : ""}
                      </Link>
                      <span className="hq-muted block text-[13px]">
                        {STAGE_LABEL[l.stage]}
                        {l.open && l.nextAction ? ` · ${l.nextAction}` : ""}
                        {l.open && l.nextActionDue ? ` · ${formatDate(l.nextActionDue, tz)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
          {partner ? <ReferralsBlock summary={referrals} who="this partner" recordHref={canWrite ? referralHref : undefined} /> : null}
          <OpenTasksBlock tasks={tasks} today={today} createHref={canTask ? taskHref : undefined} />
        </aside>
      </div>

      {canWrite ? (
        <LogInteractionDrawer
          contact={{ id: c.id, name: c.fullName, organisation: c.organisationName }}
          organisation={null}
          contactOptions={[]}
          staffOptions={staffList}
          canCreateTasks={canTask}
          staffId={staff.id}
          timezone={tz}
          serverNowLocal={nowLocalInput(tz)}
          today={today}
          returnTo="contact"
        />
      ) : null}
    </>
  );
}
