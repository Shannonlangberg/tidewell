import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/hq/format";
import { DECISION_CATEGORY_LABEL, DECISION_STATUS_LABEL, decisionStatusTone, type DecisionCategory, type DecisionStatus } from "@/lib/hq/decisions/rules";
import type { DecisionRow } from "@/lib/hq/decisions/queries";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip } from "../../StatusChip";

/*
 * Small pieces of the Decisions register: the status (dot plus label, never colour alone), the
 * category in words, and the compact list (a table from 768px, one card per decision below).
 * Server-rendered; nothing here is interactive.
 */

export const decisionHref = (id: string) => `/hq/decisions/${id}`;

export function DecisionStatusChip({ status }: { status: DecisionStatus }) {
  return <StatusChip tone={decisionStatusTone(status)}>{DECISION_STATUS_LABEL[status]}</StatusChip>;
}

export function categoryLabel(c: DecisionCategory): string {
  return DECISION_CATEGORY_LABEL[c];
}

export function DecisionsTable({ rows, caption, empty }: { rows: readonly DecisionRow[]; caption: string; empty: ReactNode }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<DecisionRow>[] = [
    { key: "ref", header: "Ref", nowrap: true, width: "6.5rem", cell: (d) => <span className="tabular-nums text-grey-text">{d.ref}</span> },
    {
      key: "title",
      header: "Decision",
      primary: true,
      cell: (d) => (
        <>
          <Link href={decisionHref(d.id)}>{d.title}</Link>
          {d.status === "superseded" && d.supersededByRef ? <span className="hq-cell-sub">Superseded by {d.supersededByRef}</span> : null}
        </>
      ),
    },
    { key: "category", header: "Category", nowrap: true, hideBelow: "lg", cell: (d) => categoryLabel(d.category) },
    { key: "status", header: "Status", nowrap: true, cell: (d) => <DecisionStatusChip status={d.status} /> },
    { key: "date", header: "Decided", nowrap: true, cell: (d) => <time dateTime={d.decisionDate}>{formatDate(d.decisionDate)}</time> },
    { key: "maker", header: "Decision maker", nowrap: true, hideBelow: "lg", cell: (d) => d.decisionMakerName ?? <span className="hq-cell-nil">A colleague</span> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(d) => d.id} />}
      list={
        <MobileList label="Decisions">
          {rows.map((d) => (
            <li key={d.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={decisionHref(d.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {d.title}
                </Link>
                <span className="hq-mitem__sub">
                  {d.ref} &middot; {categoryLabel(d.category)}
                  {d.decisionMakerName ? <> &middot; {d.decisionMakerName}</> : null}
                </span>
                <span className="hq-mitem__row">
                  <DecisionStatusChip status={d.status} />
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">
                    <time dateTime={d.decisionDate}>{formatDate(d.decisionDate)}</time>
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
