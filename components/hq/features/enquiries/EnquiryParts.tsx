import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/hq/format";
import { ENQUIRY_KIND_LABEL, ENQUIRY_STATUS_LABEL, enquiryPath, leadPath, receivedAgo, type EnquiryKindValue, type EnquiryStatus } from "@/lib/hq/enquiry-rules";
import type { EnquiryRow } from "@/lib/hq/enquiry-queries";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip, type StatusTone } from "../../StatusChip";

/*
 * Small pieces of the website enquiry screens: the kind (a plain tag), the status (dot plus label,
 * never colour alone), the received time (relative and the date), the list (a table from 768px, one
 * card per enquiry below), and the "Website enquiry" chip for leads (WebsiteEnquiryChip.tsx). Server-rendered.
 *
 * Every value here was typed by someone on the public website: it is rendered as text (React escapes
 * it), never as HTML or a link.
 */

const STATUS_TONE: Record<EnquiryStatus, StatusTone> = { new: "info", in_progress: "warning", spam: "error", archived: "neutral" };

export function EnquiryStatusChip({ status }: { status: EnquiryStatus }) {
  return <StatusChip tone={STATUS_TONE[status]}>{ENQUIRY_STATUS_LABEL[status]}</StatusChip>;
}

export function EnquiryKindChip({ kind }: { kind: EnquiryKindValue }) {
  return <StatusChip plain>{ENQUIRY_KIND_LABEL[kind]}</StatusChip>;
}

export { WebsiteEnquiryChip } from "./WebsiteEnquiryChip";

export function Received({ at, timezone }: { at: string; timezone: string }) {
  const ago = receivedAgo(at);
  return (
    <time dateTime={at} title={formatDateTime(at, timezone)}>
      {ago ? (
        <>
          {ago}
          <span className="hq-cell-sub">{formatDateTime(at, timezone)}</span>
        </>
      ) : (
        formatDateTime(at, timezone)
      )}
    </time>
  );
}

function LeadLink({ e }: { e: EnquiryRow }) {
  if (!e.opportunityId || !e.leadRef) return <span className="hq-cell-nil">No lead</span>;
  if (!e.leadLive) return <span className="hq-cell-nil">{e.leadRef} (archived)</span>;
  return (
    <Link href={leadPath(e.opportunityId)} className="underline underline-offset-4">
      {e.leadRef}
    </Link>
  );
}

export function EnquiriesTable({ rows, caption, empty, timezone }: { rows: readonly EnquiryRow[]; caption: string; empty: ReactNode; timezone: string }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<EnquiryRow>[] = [
    {
      key: "ref",
      header: "Ref",
      nowrap: true,
      width: "6.5rem",
      cell: (e) => (
        <Link href={enquiryPath(e.id)} className="tabular-nums underline underline-offset-4">
          {e.ref}
        </Link>
      ),
    },
    { key: "kind", header: "Form", nowrap: true, cell: (e) => <EnquiryKindChip kind={e.kind} /> },
    {
      key: "name",
      header: "Name",
      primary: true,
      cell: (e) => (
        <>
          <Link href={enquiryPath(e.id)} className="underline underline-offset-4">
            {e.name}
          </Link>
          {e.suburb ? <span className="hq-cell-sub">{e.suburb}</span> : null}
        </>
      ),
    },
    { key: "received", header: "Received", nowrap: true, cell: (e) => <Received at={e.receivedAt} timezone={timezone} /> },
    { key: "status", header: "Status", nowrap: true, cell: (e) => <EnquiryStatusChip status={e.status} /> },
    { key: "owner", header: "Owner", nowrap: true, hideBelow: "lg", cell: (e) => e.ownerName ?? <span className="hq-cell-nil">No owner</span> },
    { key: "lead", header: "Lead", nowrap: true, cell: (e) => <LeadLink e={e} /> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(e) => e.id} />}
      list={
        <MobileList label="Website enquiries">
          {rows.map((e) => (
            <li key={e.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={enquiryPath(e.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {e.name}
                </Link>
                <span className="hq-mitem__sub">
                  {e.ref} &middot; {ENQUIRY_KIND_LABEL[e.kind]}
                  {e.suburb ? <> &middot; {e.suburb}</> : null}
                  {e.ownerName ? <> &middot; {e.ownerName}</> : null}
                </span>
                <span className="hq-mitem__row">
                  <EnquiryStatusChip status={e.status} />
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">
                    <time dateTime={e.receivedAt} title={formatDateTime(e.receivedAt, timezone)}>
                      {receivedAgo(e.receivedAt) ?? formatDateTime(e.receivedAt, timezone)}
                    </time>
                  </span>
                </span>
              </div>
            </li>
          ))}
        </MobileList>
      }
    />
  );
}
