import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/hq/format";
import { EMAIL_STATUS_LABEL, EMAIL_STATUS_TONE, type EmailStatus } from "@/lib/hq/email/rules";
import type { EmailRow } from "@/lib/hq/email/queries";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip } from "../../StatusChip";

/*
 * Small pieces of the email screens: the status (dot plus label, never colour alone), the compact
 * list (a table from 768px, one card per email below), and the branded preview. Server-rendered.
 */

export const emailHref = (id: string) => `/hq/email/${id}`;

export function EmailStatusChip({ status }: { status: EmailStatus }) {
  return <StatusChip tone={EMAIL_STATUS_TONE[status]}>{EMAIL_STATUS_LABEL[status]}</StatusChip>;
}

/** The moment that matters for the row: sent, discarded, or last changed. */
function moment(e: EmailRow): string {
  return e.sentAt ?? e.discardedAt ?? e.updatedAt;
}

export function EmailsTable({ rows, caption, empty, timezone, showCreator }: { rows: readonly EmailRow[]; caption: string; empty: ReactNode; timezone: string; showCreator: boolean }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<EmailRow>[] = [
    { key: "ref", header: "Ref", nowrap: true, width: "6.5rem", cell: (e) => <Link href={emailHref(e.id)} className="tabular-nums underline underline-offset-4">{e.ref}</Link> },
    {
      key: "to",
      header: "To",
      primary: true,
      cell: (e) => (
        <>
          <Link href={emailHref(e.id)} className="underline underline-offset-4">{e.toName}</Link>
          <span className="hq-cell-sub">{e.subject}</span>
        </>
      ),
    },
    ...(showCreator ? [{ key: "by", header: "Drafted by", nowrap: true, hideBelow: "lg" as const, cell: (e: EmailRow) => e.createdByName ?? <span className="hq-cell-nil">A colleague</span> }] : []),
    { key: "status", header: "Status", nowrap: true, cell: (e) => <EmailStatusChip status={e.status} /> },
    { key: "when", header: "When", nowrap: true, cell: (e) => <time dateTime={moment(e)}>{formatDateTime(moment(e), timezone)}</time> },
    { key: "open", header: "", nowrap: true, cell: (e) => <Link href={emailHref(e.id)} className="underline underline-offset-4">{e.status === "draft" || e.status === "approved" ? "Preview and send" : "Open"}</Link> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(e) => e.id} />}
      list={
        <MobileList label="Emails">
          {rows.map((e) => (
            <li key={e.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={emailHref(e.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {e.toName}
                </Link>
                <span className="hq-mitem__sub">
                  {e.ref} &middot; {e.subject}
                </span>
                <span className="hq-mitem__row">
                  <EmailStatusChip status={e.status} />
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">
                    <time dateTime={moment(e)}>{formatDateTime(moment(e), timezone)}</time>
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

/**
 * The real rendered email, in a sandboxed iframe: `sandbox=""` gives it no scripts, no forms, no
 * same-origin access and no top navigation, and the HTML is the escaped output of render.ts.
 */
export function EmailPreview({ html, title }: { html: string; title: string }) {
  return (
    <div className="hq-email-preview">
      <iframe className="hq-email-preview__frame" title={title} srcDoc={html} sandbox="" referrerPolicy="no-referrer" loading="lazy" />
    </div>
  );
}
