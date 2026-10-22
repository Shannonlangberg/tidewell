import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { COMMS_BASE, COMMS_TAB_PATH } from "@/lib/hq/communications";
import { formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { ENQUIRY_ARCHIVE_CONSEQUENCE, ENQUIRY_KIND_LABEL, detailLines, leadPath } from "@/lib/hq/enquiry-rules";
import { getEnquiry } from "@/lib/hq/enquiry-queries";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, type KeyValueItem } from "@/components/hq";
import { EnquiryControls } from "@/components/hq/features/enquiries/EnquiryControls";
import { AckChip } from "@/components/hq/features/enquiries/AckChip";
import { EnquiryKindChip, EnquiryStatusChip } from "@/components/hq/features/enquiries/EnquiryParts";
import { archiveEnquiryAction, markEnquirySpamAction, restoreEnquiryAction, setEnquiryStatusAction } from "../actions";

export const metadata: Metadata = { title: "Website enquiry" };

type Params = Promise<{ id: string }>;

const LIST = "/hq/growth/enquiries";

/*
 * One website enquiry: exactly what was submitted, shown as plain text (it was typed by someone on
 * the public internet; React escapes it, and nothing in it becomes a link), the lead and contact it
 * created or joined, and, for growth.write, the status buttons and Mark as spam.
 */
export default async function EnquiryPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("growth.read", false, isUuid(id) ? `${LIST}/${id}` : COMMS_TAB_PATH.enquiries);
  if (!isUuid(id)) notFound();
  const crumbs = [
    { label: "Communications", href: COMMS_BASE },
    { label: "Enquiries", href: COMMS_TAB_PATH.enquiries },
  ];

  const found = await getEnquiry(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader breadcrumbs={[...crumbs, { label: "Enquiry" }]} title="Website enquiry" />
        <ErrorState
          title="We could not load this enquiry"
          action={
            <LinkButton href={`${LIST}/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data) notFound();
  const e = found.data;
  const tz = staff.timezone;

  const submitted: KeyValueItem[] = [
    { label: "Name", value: e.name },
    { label: "Email", value: <span className="break-all">{e.email}</span> },
    { label: "Phone", value: e.phone, empty: "Not given" },
    ...(e.kind === "appraisal" ? [{ label: "Suburb", value: e.suburb, empty: "Not given" }] : []),
    ...detailLines(e.details).map((d) => ({ label: d.label, value: <span className="break-words">{d.value}</span> })),
  ];

  const about: KeyValueItem[] = [
    { label: "Status", value: <EnquiryStatusChip status={e.status} /> },
    { label: "Form", value: ENQUIRY_KIND_LABEL[e.kind] },
    { label: "Received", value: formatDateTime(e.receivedAt, tz) },
    {
      label: "Thank-you email",
      value: e.ackStatus === "none" ? null : <AckChip status={e.ackStatus} at={e.ackAt} reason={e.ackReason} timezone={tz} detail />,
      empty: "Not attempted",
    },
    { label: "Page", value: e.sourcePage },
    { label: "Owner", value: e.ownerName, empty: "No owner" },
    {
      label: "Lead",
      value:
        e.opportunityId && e.leadRef ? (
          e.leadLive ? (
            <Link href={leadPath(e.opportunityId)} className="underline underline-offset-2">
              {e.leadRef}
              {e.createdLead ? "" : " (it joined this lead)"}
            </Link>
          ) : (
            `${e.leadRef} (archived)`
          )
        ) : e.opportunityId ? (
          "Archived"
        ) : null,
      empty: "No lead",
    },
    {
      label: "Contact",
      value:
        e.contactId && e.contactName ? (
          <Link href={`/hq/growth/contacts/${e.contactId}`} className="underline underline-offset-2">
            {e.contactName}
            {e.createdContact ? " (new, to verify)" : ""}
          </Link>
        ) : null,
      empty: e.contactId ? "Archived" : "No contact",
    },
    ...(e.archivedAt
      ? [
          { label: "Archived", value: `${formatDateTime(e.archivedAt, tz)}${e.archivedByName ? ` by ${e.archivedByName}` : ""}` },
          ...(e.archiveReason ? [{ label: "Why", value: <span className="break-words">{e.archiveReason}</span> }] : []),
        ]
      : []),
    ...(e.handledAt ? [{ label: e.status === "spam" ? "Marked as spam" : "Handled", value: `${formatDateTime(e.handledAt, tz)}${e.handledByName ? ` by ${e.handledByName}` : ""}` }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[...crumbs, { label: e.ref }]}
        eyebrow={e.ref}
        title={e.name}
        description={e.kind === "appraisal" ? `Rental appraisal request${e.suburb ? ` for a property in ${e.suburb}` : ""}.` : "Contact form enquiry."}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <EnquiryKindChip kind={e.kind} />
            <EnquiryStatusChip status={e.status} />
            <AckChip status={e.ackStatus} at={null} reason={e.ackReason} timezone={tz} />
          </span>
        }
        actions={
          e.opportunityId && e.leadLive ? (
            <LinkButton href={leadPath(e.opportunityId)} variant="primary">
              Open the lead
            </LinkButton>
          ) : undefined
        }
      />

      {e.status === "spam" ? <InlineNote className="mb-6">Marked as spam. It stays here for the record.</InlineNote> : null}
      {e.status === "archived" ? <InlineNote className="mb-6">Archived. It is out of the enquiries list and kept for the record; Restore brings it back.</InlineNote> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-8">
          <section aria-labelledby="enq-message">
            <SectionLabel as="h2" id="enq-message" className="mb-4 border-b border-line pb-3.5">
              Message
            </SectionLabel>
            {e.message ? <p className="m-0 max-w-[65ch] whitespace-pre-wrap break-words">{e.message}</p> : <p className="hq-muted m-0">No message.</p>}
            <p className="hq-muted mt-4 text-[13px]">Typed on the public website. Check names, numbers and links before relying on them.</p>
          </section>
          <section aria-labelledby="enq-fields">
            <SectionLabel as="h2" id="enq-fields" className="mb-4 border-b border-line pb-3.5">
              What they filled in
            </SectionLabel>
            <KeyValueList items={submitted} />
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Enquiry details">
          <Panel aria-labelledby="enq-about">
            <PanelHeader id="enq-about" title="In HQ" level={2} />
            <KeyValueList items={about} />
          </Panel>
          {can("growth.write") ? (
            <Panel aria-labelledby="enq-actions">
              <PanelHeader id="enq-actions" title="Actions" level={2} />
              <EnquiryControls
                id={e.id}
                refLabel={e.ref}
                status={e.status}
                createdLead={e.createdLead}
                setStatus={setEnquiryStatusAction}
                markSpam={markEnquirySpamAction}
                archive={archiveEnquiryAction}
                archiveConsequence={ENQUIRY_ARCHIVE_CONSEQUENCE}
                restore={restoreEnquiryAction}
              />
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
