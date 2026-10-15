import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, SENT_OUTCOME_LABEL } from "@/lib/hq/constants";
import { isUuid } from "@/lib/hq/forms";
import { formatAud, formatDate, formatDateTime, plural, todayIn } from "@/lib/hq/format";
import { addDays } from "@/lib/hq/growth/dates";
import { centsToDollarsInput } from "@/lib/hq/referrals/numbers";
import { loadReferralDetail } from "@/lib/hq/referrals/queries";
import { followUpTitle } from "@/lib/hq/referrals/rules";
import { daysInStage, daysInStageLabel } from "@/lib/hq/referrals/stages";
import { staffOptions } from "@/lib/hq/queries/options";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, StageChip, buildHref, type KeyValueItem } from "@/components/hq";
import { CreditChip, DirectionChip, Nil, OutcomeChip, referralHref } from "@/components/hq/features/referrals/Bits";
import { EditProspectButton, EditReferralButton } from "@/components/hq/features/referrals/EditDrawers";
import { ArchiveReferralButton, MakeCreditedButton, MoveStageButton } from "@/components/hq/features/referrals/ReferralActions";
import { StageHistory } from "@/components/hq/features/referrals/StageHistory";

export const metadata: Metadata = { title: "Referral" };

const REFERRALS = `${HQ_BASE}/growth/referrals`;
const ORGANISATIONS = `${HQ_BASE}/growth/organisations`;
const CONTACTS = `${HQ_BASE}/growth/contacts`;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function partnerLinks(r: { organisationId: string | null; organisationName: string | null; contactId: string | null; contactName: string | null }) {
  const org = r.organisationId && r.organisationName ? <Link href={`${ORGANISATIONS}/${r.organisationId}`}>{r.organisationName}</Link> : null;
  const person = r.contactId && r.contactName ? <Link href={`${CONTACTS}/${r.contactId}`}>{r.contactName}</Link> : null;
  if (org && person) {
    return (
      <>
        {org}, {person}
      </>
    );
  }
  return org ?? person ?? <Nil>No partner</Nil>;
}

function claimName(c: { partnerOrganisationName: string | null; partnerContactName: string | null }): string {
  return c.partnerOrganisationName ?? c.partnerContactName ?? "an unnamed partner";
}

export default async function ReferralDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const here = `${REFERRALS}/${id}`;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(here, sp));
  const canWrite = can("growth.write");
  const canDelete = can("growth.delete");
  const today = todayIn(staff.timezone);

  const loaded = await loadReferralDetail(db, id);
  if (!loaded.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Referrals", href: REFERRALS }, { label: "Referral" }]} title="Referral" />
        <ErrorState
          title="We could not load this referral"
          action={
            <LinkButton href={here} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!loaded.data) notFound();
  const { referral, opportunity, history, claims } = loaded.data;

  const received = referral.direction === "received";
  const credited = claims.find((c) => c.isAttributed) ?? null;
  const others = claims.filter((c) => c.id !== referral.id);
  const thisClaim = claims.find((c) => c.id === referral.id) ?? null;
  const staffList = canWrite ? await staffOptions(db) : [];

  // The assignee may have left: keep them in the list so the form does not silently drop them.
  const withCurrent = (current: string | null, currentName: string | null) =>
    current && !staffList.some((s) => s.value === current) ? [...staffList, { value: current, label: `${currentName ?? "Former staff member"} (no longer active)` }] : staffList;

  const partner = {
    organisationId: referral.partnerOrganisationId,
    organisationName: referral.partnerOrganisationName,
    contactId: referral.partnerContactId,
    contactName: referral.partnerContactName,
  };

  const isSigned = opportunity?.stage === "management_signed";
  const stageDays = opportunity ? daysInStage(opportunity.stageChangedAt, staff.timezone) : null;

  // Archiving the credited source is refused while other partners claim the prospect.
  const archiveBlocked = received && referral.isAttributed && others.length > 0;
  const onlyReferral = received && others.length === 0;
  const archiveConsequence = !received
    ? "It leaves the referral register and the partner's sent count. The history is kept in the audit log, and a director can restore it."
    : onlyReferral
      ? `This is the only referral for this prospect, so the prospect leaves the pipeline too${isSigned ? ", and the signed management is no longer counted" : ""}. The history is kept in the audit log, and a director can restore it.`
      : "It leaves the referral register and this partner's received count. The prospect stays in the pipeline with its other referrals. The history is kept in the audit log, and a director can restore it.";

  const taskHref = buildHref(
    `${HQ_BASE}/operations/tasks/new`,
    {},
    {
      referral: referral.id,
      opportunity: referral.opportunityId,
      title: followUpTitle(referral.refLabel),
      due: addDays(today, 2),
    },
  );

  const referralItems: KeyValueItem[] = [
    { label: "Reference", value: referral.refLabel },
    { label: "Direction", value: <DirectionChip direction={referral.direction} /> },
    { label: received ? "Introduced by" : "Sent to", value: partnerLinks(partner) },
    { label: "Date", value: formatDate(referral.referralDate, staff.timezone) },
    { label: "Assigned to", value: referral.assignedToName, empty: "Unassigned" },
    ...(received ? [{ label: "Credit", value: <CreditChip isAttributed={referral.isAttributed} /> }] : []),
    ...(!received ? [{ label: "Outcome", value: referral.sentOutcome ? <OutcomeChip outcome={referral.sentOutcome} /> : null }] : []),
    { label: "Notes", value: referral.notes, empty: "No notes" },
    { label: "Recorded", value: referral.createdAt ? formatDateTime(referral.createdAt, staff.timezone) : null },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Referrals", href: REFERRALS }, { label: referral.refLabel }]}
        eyebrow={received ? "Referral received" : "Referral sent"}
        title={referral.refLabel}
        description={
          <>
            {received ? "Introduced by " : "Sent to "}
            {partnerLinks(partner)}
            {referral.prospectName ? <>. Prospect: {referral.prospectName}.</> : "."}
          </>
        }
        meta={
          <span className="flex flex-wrap gap-2">
            <DirectionChip direction={referral.direction} />
            {received && opportunity ? <StageChip stage={opportunity.stage} /> : null}
            {!received && referral.sentOutcome ? <OutcomeChip outcome={referral.sentOutcome} labelled /> : null}
            {received ? <CreditChip isAttributed={referral.isAttributed} /> : null}
          </span>
        }
        actions={
          <>
            {canWrite && received && opportunity ? (
              <MoveStageButton
                target={{
                  opportunityId: opportunity.id,
                  prospectName: opportunity.prospectName,
                  stage: opportunity.stage,
                  signedAt: opportunity.signedAt,
                  managementReference: opportunity.managementReference,
                }}
                role={staff.role}
                today={today}
                timezone={staff.timezone}
                returnTo={here}
              />
            ) : null}
            {can("tasks.write") ? (
              <LinkButton href={taskHref} icon="task">
                Create follow-up task
              </LinkButton>
            ) : null}
            {canDelete ? <ArchiveReferralButton id={referral.id} refLabel={referral.refLabel} consequence={archiveConsequence} blockedNoteId={archiveBlocked ? "archive-blocked" : undefined} /> : null}
          </>
        }
      />

      {canDelete && archiveBlocked ? (
        <InlineNote className="mt-4">
          <span id="archive-blocked">
            This is the credited source and {plural(others.length, "other partner")} also claim{others.length === 1 ? "s" : ""} this prospect, so it can&rsquo;t be archived yet. Make another referral the
            credited source first.
          </span>
        </InlineNote>
      ) : null}

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 content-start gap-8">
          {received ? (
            opportunity ? (
              <Panel aria-labelledby="prospect-h">
                <PanelHeader
                  id="prospect-h"
                  level={2}
                  title="Prospect"
                  action={
                    canWrite ? (
                      <EditProspectButton
                        returnTo={here}
                        staff={withCurrent(opportunity.assignedToId, opportunity.assignedToName)}
                        initial={{
                          opportunityId: opportunity.id,
                          prospectName: opportunity.prospectName,
                          prospectPhone: opportunity.prospectPhone ?? "",
                          prospectEmail: opportunity.prospectEmail ?? "",
                          propertySuburb: opportunity.propertySuburb ?? "",
                          propertyAddress: opportunity.propertyAddress ?? "",
                          estimatedValue: centsToDollarsInput(opportunity.estimateCents),
                          assignedTo: opportunity.assignedToId ?? "",
                          notes: opportunity.notes ?? "",
                        }}
                      />
                    ) : undefined
                  }
                />
                <KeyValueList
                  items={[
                    { label: "Name", value: opportunity.prospectName },
                    { label: "Phone", value: opportunity.prospectPhone },
                    { label: "Email", value: opportunity.prospectEmail },
                    { label: "Property", value: [opportunity.propertyAddress, opportunity.propertySuburb].filter(Boolean).join(", ") },
                    {
                      label: "Stage",
                      value: (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <StageChip stage={opportunity.stage} />
                          {stageDays !== null && !isSigned ? <span className="hq-muted text-[13px] font-normal">{daysInStageLabel(stageDays)} in this stage</span> : null}
                        </span>
                      ),
                    },
                    { label: "Assigned to", value: opportunity.assignedToName, empty: "Unassigned" },
                    { label: "Estimate", value: opportunity.estimateCents === null ? null : `${formatAud(opportunity.estimateCents)} a year (your estimate)`, empty: "No estimate" },
                    {
                      label: "Credited to",
                      value: credited ? (
                        <>
                          {partnerLinks({ organisationId: credited.partnerOrganisationId, organisationName: credited.partnerOrganisationName, contactId: credited.partnerContactId, contactName: credited.partnerContactName })}
                          <span className="hq-muted font-normal"> ({credited.refLabel})</span>
                        </>
                      ) : null,
                      empty: "No credited source",
                    },
                    ...(opportunity.notes && opportunity.notes !== referral.notes ? [{ label: "Notes", value: opportunity.notes }] : []),
                  ]}
                />
                {isSigned ? (
                  <p className="mt-5 border-t border-line pt-4 text-[14px]">
                    <strong className="font-semibold">Signed on {formatDate(opportunity.signedAt, staff.timezone)}.</strong> This management is counted once
                    {credited ? `, credited to ${claimName(credited)}` : ""}.
                    {opportunity.managementReference ? <> Management reference: {opportunity.managementReference}.</> : null}
                  </p>
                ) : null}
                {opportunity.stage === "lost" ? (
                  <p className="mt-5 border-t border-line pt-4 text-[14px]">
                    <strong className="font-semibold">Did not proceed.</strong> {opportunity.lostReason ?? "No reason recorded."}
                  </p>
                ) : null}
              </Panel>
            ) : (
              <ErrorState title="We could not load the prospect for this referral">It may have been archived. The referral details are shown beside it.</ErrorState>
            )
          ) : (
            <Panel aria-labelledby="sent-h">
              <PanelHeader id="sent-h" level={2} title="The person you sent" />
              <KeyValueList
                items={[
                  { label: "Name", value: referral.prospectName },
                  { label: "Phone", value: referral.prospectPhone },
                  { label: "Email", value: referral.prospectEmail },
                  { label: "Property", value: [referral.propertyAddress, referral.propertySuburb].filter(Boolean).join(", ") },
                  { label: "Outcome", value: referral.sentOutcome ? SENT_OUTCOME_LABEL[referral.sentOutcome] : null },
                ]}
              />
              <p className="hq-muted mt-4 text-[13px]">
                A sent referral does not enter the pipeline. Update its outcome as you hear back, so you can see how often your introductions lead somewhere.
              </p>
            </Panel>
          )}

          {received && opportunity ? (
            <section aria-labelledby="history-h">
              <h2 id="history-h" className="hq-label mb-4 border-b border-line pb-3">
                Stage history
              </h2>
              <StageHistory items={history} timezone={staff.timezone} />
            </section>
          ) : null}

          {received && opportunity ? (
            <section aria-labelledby="claims-h">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
                <h2 id="claims-h" className="hq-label">
                  Introductions for this prospect
                </h2>
                {canWrite ? (
                  <Link className="text-[13px] font-medium underline underline-offset-4" href={`${REFERRALS}/new?existing=${opportunity.id}`}>
                    Record another introduction
                  </Link>
                ) : null}
              </div>
              {claims.length <= 1 ? (
                <p className="hq-muted text-[14px]">
                  Only one partner has introduced this prospect, so they are the credited source. If another partner also introduced them, record it as a further introduction: the prospect and
                  the signed count stay single.
                </p>
              ) : (
                <>
                  <p className="hq-muted mb-2 max-w-prose text-[14px]">
                    {plural(claims.length, "partner")} introduced this prospect. Only the credited source is counted if they sign, so the management is never counted twice.
                  </p>
                  <ul className="m-0 list-none p-0">
                    {claims.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-3 text-[14px]">
                        <span>
                          <span className="font-medium">
                            {c.id === referral.id ? (
                              c.refLabel
                            ) : (
                              <Link href={referralHref(c.id)}>{c.refLabel}</Link>
                            )}
                          </span>
                          {c.id === referral.id ? <span className="hq-muted"> (this referral)</span> : null}
                          <span className="hq-muted block text-[13px]">
                            {claimName(c)}, {formatDate(c.referralDate, staff.timezone)}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-3">
                          <CreditChip isAttributed={c.isAttributed} />
                          {canWrite && !c.isAttributed && credited ? (
                            <MakeCreditedButton
                              opportunityId={opportunity.id}
                              referralId={c.id}
                              refLabel={c.refLabel}
                              partnerName={claimName(c)}
                              currentName={claimName(credited)}
                              signed={isSigned}
                              returnTo={here}
                            />
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : null}
        </div>

        <aside aria-label="About this referral" className="min-w-0 content-start">
          <Panel aria-labelledby="this-referral-h">
            <PanelHeader
              id="this-referral-h"
              level={2}
              title={received ? "This referral" : "Referral"}
              action={
                canWrite ? (
                  <EditReferralButton
                    returnTo={here}
                    today={today}
                    staff={withCurrent(referral.assignedToId, referral.assignedToName)}
                    initial={{
                      referralId: referral.id,
                      direction: referral.direction,
                      referralDate: referral.referralDate,
                      assignedTo: referral.assignedToId ?? "",
                      notes: referral.notes ?? "",
                      sentOutcome: referral.sentOutcome ?? "sent",
                      prospectName: referral.prospectName ?? "",
                      prospectPhone: referral.prospectPhone ?? "",
                      prospectEmail: referral.prospectEmail ?? "",
                      propertySuburb: referral.propertySuburb ?? "",
                      propertyAddress: referral.propertyAddress ?? "",
                    }}
                  />
                ) : undefined
              }
            />
            <KeyValueList items={referralItems} />
          </Panel>
          {thisClaim && !thisClaim.isAttributed && credited ? (
            <InlineNote className="mt-4">
              {claimName(credited)} ({credited.refLabel}) is credited for this prospect. {referral.refLabel} is a further introduction and is not counted separately.
            </InlineNote>
          ) : null}
        </aside>
      </div>
    </>
  );
}
