import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/hq/format";
import { KNOWLEDGE_CATEGORY_LABEL, statusTone, versionLabel, versionTone, type KnowledgeCategory, type VersionStatus } from "@/lib/hq/knowledge/rules";
import type { KnowledgeRow } from "@/lib/hq/knowledge/queries";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip } from "../../StatusChip";

/*
 * Small pieces of the Knowledge base: the status (dot plus label, never colour alone), the category in
 * words, and the compact list (a table from 768px, one card per document below). Server-rendered.
 */

export const knowledgeHref = (id: string) => `/hq/knowledge/${id}`;

export const categoryLabel = (c: KnowledgeCategory) => KNOWLEDGE_CATEGORY_LABEL[c];

export function KnowledgeStatusChip({ doc }: { doc: Pick<KnowledgeRow, "approvedVersion" | "currentVersion" | "archived" | "statusLabel"> }) {
  return <StatusChip tone={statusTone(doc)}>{doc.statusLabel}</StatusChip>;
}

export function VersionStatusChip({ status, wasApproved }: { status: VersionStatus; wasApproved: boolean }) {
  return <StatusChip tone={versionTone(status)}>{versionLabel(status, wasApproved)}</StatusChip>;
}

function ReviewNote({ d }: { d: KnowledgeRow }) {
  if (d.reviewState === "overdue") return <span className="hq-cell-sub">Review overdue</span>;
  if (d.reviewState === "due_soon" && d.reviewDue) return <span className="hq-cell-sub">Review due {formatDate(d.reviewDue)}</span>;
  return null;
}

export function KnowledgeTable({ rows, caption, empty }: { rows: readonly KnowledgeRow[]; caption: string; empty: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<KnowledgeRow>[] = [
    { key: "ref", header: "Ref", nowrap: true, width: "6.5rem", cell: (d) => <span className="tabular-nums text-grey-text">{d.ref}</span> },
    {
      key: "title",
      header: "Document",
      primary: true,
      cell: (d) => (
        <>
          <Link href={knowledgeHref(d.id)}>{d.title}</Link>
          <ReviewNote d={d} />
        </>
      ),
    },
    { key: "category", header: "Category", nowrap: true, hideBelow: "lg", cell: (d) => categoryLabel(d.category) },
    { key: "status", header: "Status", nowrap: true, cell: (d) => <KnowledgeStatusChip doc={d} /> },
    { key: "owner", header: "Owner", nowrap: true, hideBelow: "lg", cell: (d) => d.ownerName ?? <span className="hq-cell-nil">{d.isTemplate ? "\u2014" : "No owner yet"}</span> },
    { key: "updated", header: "Updated", nowrap: true, cell: (d) => <time dateTime={d.updatedAt}>{formatDate(d.updatedAt)}</time> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(d) => d.id} />}
      list={
        <MobileList label="Knowledge documents">
          {rows.map((d) => (
            <li key={d.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={knowledgeHref(d.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {d.title}
                </Link>
                <span className="hq-mitem__sub">
                  {d.ref} &middot; {categoryLabel(d.category)}
                  {d.ownerName ? <> &middot; {d.ownerName}</> : null}
                </span>
                <span className="hq-mitem__row">
                  <KnowledgeStatusChip doc={d} />
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">
                    {d.reviewState === "overdue" ? "Review overdue" : <time dateTime={d.updatedAt}>{formatDate(d.updatedAt)}</time>}
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
