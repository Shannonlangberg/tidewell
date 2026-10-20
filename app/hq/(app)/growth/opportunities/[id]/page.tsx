import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE, INTERACTION_TYPES, TASK_STATUS_LABEL } from "@/lib/hq/constants";
import { isUuid } from "@/lib/hq/forms";
import { formatAud, formatDate, formatDateTime, plural, todayIn } from "@/lib/hq/format";
import { agoLabel, nowLocalInput } from "@/lib/hq/growth/dates";
import { getLead, loadLeadBundle } from "@/lib/hq/leads/queries";
import { CONTACT_KIND_LABEL, LEAD_SOURCE_LABEL, LOST_REASON_LABEL, addDaysIso, attentionText, dueText } from "@/lib/hq/leads/rules";
import { centsToDollarsInput } from "@/lib/hq/referrals/numbers";
import { daysInStageLabel } from "@/lib/hq/referrals/stages";
import { staffOptions } from "@/lib/hq/queries/options";
import { EmptyState, ErrorState, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, StageChip, StatusChip, buildHref, type KeyValueItem } from "@/components/hq";
import { EditLeadButton, LogLeadActivityButton, NextStepButton } from "@/components/hq/features/leads/LeadDrawers";
import { LeadTimeline } from "@/components/hq/features/leads/LeadTimeline";
import { MoveStageButton } from "@/components/hq/features/referrals/ReferralActions";

export const metadata: Metadata = { title: "Lead" };

const LEADS = `${HQ_BASE}/growth/opportunities`;
const PIPELINE = `${HQ_BASE}/growth/pipeline`;

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LeadPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const here = `${LEADS}/${isUuid(id) ? id : ""}`;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(here, sp));
  if (!isUuid(id)) notFound();
  const canWrite = can("growth.write");
  const canTask = can("tasks.write");
  const today = todayIn(staff.timezone);
  const tz = staff.timezone;
  const crumbs = [{ label: "Growth", href: "/hq/growth" }, { label: "Pipeline", href: PIPELINE }];

  const found = await getLead(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[...crumbs, { label: "Lead" }]} title="Lead" />
        <ErrorState
          title="We could not load this lead"
          action={
            <LinkButton href={here} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data) notFound();
  const lead = found.data;

  const [bundle, staffList] = await Promise.all([loadLeadBundle(db, lead), canWrite ? staffOptions(db) : Promise.resolve([])]);
  const owners =
    lead.assignedTo && !staffList.some((s) => s.value === lead.assignedTo)
      ? [...staffList, { value: lead.assignedTo, label: `${lead.assignedToName ?? "Former staff member"} (no longer active)` }]
      : staffList;

  const signed = lead.stage === "management_signed";
  const lost = lead.stage === "lost";
  const attention = attentionText({ assignedTo: lead.assignedTo, nextAction: lead.nextAction, nextActionDue: lead.nextActionDue, open: lead.open }, today);
  const due = lead.nextActionDue ? dueText(lead.nextActionDue, today) : null;
  const referred = lead.source === "referral_partner";
  const contact = bundle.contact;
  const logRaw = Array.isArray(sp.log) ? sp.log[0] : sp.log;
  const logType = logRaw && (INTERACTION_TYPES as readonly string[]).includes(logRaw) ? logRaw : null;

  const taskHref = buildHref(
    `${HQ_BASE}/operations/tasks/new`,
    {},
    {
      opportunity: lead.id,
      contact: contact?.id ?? null,
      referral: lead.creditedReferralId,
      title: lead.nextAction ?? `Follow up with ${lead.prospectName}`,
      due: lead.nextActionDue && lead.nextActionDue >= today ? lead.nextActionDue : addDaysIso(today, 1),
      return: here,
    },
  );

  const partnerLink = lead.partnerOrganisationId && lead.partnerOrganisationName ? (
    <Link href={`/hq/growth/organisations/${lead.partnerOrganisationId}`}>{lead.partnerOrganisationName}</Link>
  ) : lead.partnerContactId && lead.partnerContactName ? (
    <Link href={`/hq/growth/contacts/${lead.partnerContactId}`}>{lead.partnerContactName}</Link>
  ) : null;

  const details: KeyValueItem[] = [
    { label: "Reference", value: lead.ref },
    { label: "Came from", value: LEAD_SOURCE_LABEL[lead.source] },
    {
      label: "Stage",
      value: (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StageChip stage={lead.stage} />
          {lead.open ? <span className="hq-muted text-[13px] font-normal">{daysInStageLabel(lead.daysInStage)} in this stage</span> : null}
        </span>
      ),
    },
    { label: "Property", value: [lead.propertyAddress, lead.propertySuburb].filter(Boolean).join(", "), empty: "Not recorded" },
    { label: "Expected to sign by", value: lead.expectedCloseDate ? formatDate(lead.expectedCloseDate, tz) : null, empty: "Not set" },
    { label: "Estimate", value: lead.estimateCents === null ? null : `${formatAud(lead.estimateCents)} a year (your estimate)`, empty: "No estimate" },
    ...(referred || partnerLink
      ? [
          {
            label: "Credited to",
            value: partnerLink ? (
              <>
                {partnerLink}
                {lead.creditedReferralId && lead.creditedRefLabel ? (
                  <>
                    {" "}
                    <Link href={`/hq/growth/referrals/${lead.creditedReferralId}`} className="hq-muted font-normal">
                      ({lead.creditedRefLabel})
                    </Link>
                  </>
                ) : null}
                {lead.otherClaims > 0 ? <span className="hq-muted block text-[13px] font-normal">{plural(lead.otherClaims, "other partner")} also introduced them</span> : null}
              </>
            ) : null,
            empty: "No credited partner",
          } satisfies KeyValueItem,
        ]
      : []),
    { label: "Last activity", value: lead.lastActivityAt ? `${agoLabel(lead.lastActivityAt, tz) ?? formatDateTime(lead.lastActivityAt, tz)}` : null, empty: "Nothing logged yet" },
    ...(lead.notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{lead.notes}</span> }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[...crumbs, { label: lead.prospectName }]}
        eyebrow={`${lead.ref} · ${LEAD_SOURCE_LABEL[lead.source]}`}
        title={lead.prospectName}
        description={lead.propertySuburb ? `Property in ${lead.propertySuburb}.` : undefined}
        meta={
          <span className="flex flex-wrap gap-2">
            <StageChip stage={lead.stage} />
            {attention ? <StatusChip tone="warning">{attention}</StatusChip> : null}
          </span>
        }
        actions={
          canWrite ? (
            <>
              <LogLeadActivityButton
                opportunityId={lead.id}
                prospectName={lead.prospectName}
                nowLocal={nowLocalInput(tz)}
                today={today}
                staff={staffList}
                staffId={staff.id}
                canCreateTasks={canTask}
                startOpen={logType !== null}
                defaultType={logType ?? "phone_call"}
              />
              <MoveStageButton
                target={{ opportunityId: lead.id, prospectName: lead.prospectName, stage: lead.stage, signedAt: lead.signedAt, managementReference: lead.managementReference }}
                role={staff.role}
                today={today}
                timezone={tz}
                returnTo={here}
              />
            </>
          ) : undefined
        }
      />

      {canWrite || canTask || lead.prospectPhone ? (
        <div className="-mt-4 mb-8 flex flex-wrap items-center gap-2">
          {lead.prospectPhone && lead.prospectPhone.replace(/\D/g, "").length >= 6 ? (
            <LinkButton href={`tel:${lead.prospectPhone.replace(/[^\d+]/g, "")}`} size="sm" icon="phone" aria-label={`Call ${lead.prospectName}`}>
              Call
            </LinkButton>
          ) : null}
          {canTask ? (
            <LinkButton href={taskHref} size="sm" icon="task">
              Create follow-up task
            </LinkButton>
          ) : null}
          {canWrite ? (
            <EditLeadButton
              today={today}
              initial={{
                opportunityId: lead.id,
                prospectName: lead.prospectName,
                prospectPhone: lead.prospectPhone ?? "",
                prospectEmail: lead.prospectEmail ?? "",
                propertySuburb: lead.propertySuburb ?? "",
                propertyAddress: lead.propertyAddress ?? "",
                source: referred ? "" : lead.source,
                expectedCloseDate: lead.expectedCloseDate ?? "",
                estimatedValue: centsToDollarsInput(lead.estimateCents),
                notes: lead.notes ?? "",
              }}
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 content-start gap-8">
          {lead.open ? (
            <Panel aria-labelledby="next-h">
              <PanelHeader
                id="next-h"
                level={2}
                title="Next step"
                action={
                  canWrite ? (
                    <NextStepButton
                      staff={owners}
                      today={today}
                      initial={{
                        opportunityId: lead.id,
                        version: lead.updatedAt ?? "",
                        assignedTo: lead.assignedTo ?? staff.id,
                        nextAction: lead.nextAction ?? "",
                        nextActionDue: lead.nextActionDue ?? today,
                      }}
                    />
                  ) : undefined
                }
              />
              <p className="text-[17px] font-medium leading-snug">{lead.nextAction ?? "No next step yet"}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
                {lead.nextActionDue ? <span>{formatDate(lead.nextActionDue, tz)}</span> : <span className="hq-muted">No follow-up date</span>}
                {due ? <StatusChip tone={lead.nextActionOverdue ? "error" : "warning"}>{due}</StatusChip> : null}
                <span className="hq-muted">{lead.assignedToName ? `Owner: ${lead.assignedToName}` : "No owner"}</span>
              </p>
            </Panel>
          ) : signed ? (
            <Panel aria-labelledby="signed-h">
              <PanelHeader id="signed-h" level={2} title="Management signed" />
              <p className="text-[14px]">
                Signed on {formatDate(lead.signedAt, tz)}. This management is counted once{lead.partnerOrganisationName ? `, credited to ${lead.partnerOrganisationName}` : ""}.
                {lead.managementReference ? <> Reference: {lead.managementReference}.</> : null}
              </p>
            </Panel>
          ) : lost ? (
            <Panel aria-labelledby="lost-h">
              <PanelHeader id="lost-h" level={2} title="Did not proceed" />
              <p className="text-[14px]">
                <strong className="font-semibold">{lead.lostReasonCode ? LOST_REASON_LABEL[lead.lostReasonCode] : "Reason not coded"}.</strong> {lead.lostReason}
              </p>
              {canWrite ? <p className="hq-muted mt-2 text-[13px]">If they come back, move the lead to an open stage: its owner and next step are kept.</p> : null}
            </Panel>
          ) : null}

          <section aria-labelledby="activity-h">
            <SectionLabel as="h2" id="activity-h" className="mb-5 border-b border-line pb-3.5">
              Activity
            </SectionLabel>
            {!bundle.timeline.ok ? (
              <ErrorState
                title="We could not load the activity"
                action={
                  <LinkButton href={here} size="sm">
                    Try again
                  </LinkButton>
                }
              />
            ) : bundle.timeline.data.length === 0 ? (
              <EmptyState compact title="Nothing logged yet">
                Log your first call with {lead.prospectName}.
              </EmptyState>
            ) : (
              <LeadTimeline events={bundle.timeline.data} timezone={tz} label={`Activity on ${lead.prospectName}, newest first`} />
            )}
          </section>
        </div>

        <aside className="grid min-w-0 content-start gap-7" aria-label="About this lead">
          <section aria-labelledby="landlord-h">
            <SectionLabel as="h2" id="landlord-h" className="mb-3.5">
              The landlord
            </SectionLabel>
            <KeyValueList
              items={[
                {
                  label: "Contact",
                  value: contact ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/hq/growth/contacts/${contact.id}`}>{contact.fullName}</Link>
                      {contact.kind !== "partner" ? <StatusChip plain>{CONTACT_KIND_LABEL[contact.kind]}</StatusChip> : null}
                    </span>
                  ) : null,
                  empty: "Not added as a contact",
                },
                {
                  label: "Phone",
                  value: lead.prospectPhone ? (
                    <a href={`tel:${lead.prospectPhone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
                      {lead.prospectPhone}
                    </a>
                  ) : null,
                },
                {
                  label: "Email",
                  value: lead.prospectEmail ? (
                    <a href={`mailto:${lead.prospectEmail}`} className="underline underline-offset-2">
                      {lead.prospectEmail}
                    </a>
                  ) : null,
                },
              ]}
            />
            {contact?.needsVerification ? <p className="hq-muted mt-2 text-[13px]">Added with the lead. Check the details when you next speak.</p> : null}
          </section>

          <section aria-labelledby="details-h">
            <SectionLabel as="h2" id="details-h" className="mb-3.5">
              Details
            </SectionLabel>
            <KeyValueList items={details} />
          </section>

          {bundle.openTasks.length > 0 ? (
            <section aria-labelledby="tasks-h">
              <SectionLabel as="h2" id="tasks-h" className="mb-3.5">
                Open tasks
              </SectionLabel>
              <ul className="m-0 list-none p-0">
                {bundle.openTasks.map((t) => (
                  <li key={t.id} className="border-b border-line py-2.5 text-[14px]">
                    <Link href={`/hq/operations/tasks/${t.id}`}>{t.title}</Link>
                    <span className="hq-muted block text-[13px]">
                      {TASK_STATUS_LABEL[t.status]}
                      {t.dueDate ? ` · due ${formatDate(t.dueDate, tz)}` : ""}
                      {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
