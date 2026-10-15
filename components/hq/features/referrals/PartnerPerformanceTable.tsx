import Link from "next/link";
import { CATEGORY_LABEL } from "@/lib/hq/constants";
import { formatAud } from "@/lib/hq/format";
import { formatConversion } from "@/lib/hq/referrals/numbers";
import type { PartnerPerformanceRow } from "@/lib/hq/referrals/types";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList, MobileListItem } from "../../MobileList";
import { StatusChip } from "../../StatusChip";

/*
 * Partner performance: one row per partner organisation. Server-rendered, sorted by link.
 *
 * Received and sent count every introduction. Qualified and signed count PROSPECTS, credited to
 * the one partner who is the attributed source, so a prospect claimed by two partners is counted
 * once. Conversion is signed over received, and an em dash when nothing was received.
 */

const ORGANISATIONS = "/hq/growth/organisations";

function categories(row: PartnerPerformanceRow): string {
  return row.categories.map((c) => CATEGORY_LABEL[c]).join(", ");
}

export function ReciprocalChip() {
  return (
    <StatusChip tone="success" title="This partner has sent you referrals and you have sent referrals to them">
      Reciprocal
    </StatusChip>
  );
}

/*
 * Figures are right-aligned with a utility class on the cell's content. (The kit's `align: "right"`
 * aligns the header but a later `.hq-td` rule resets the body cells to the left: reported to the lead.)
 */
const RIGHT = "block text-right";

function Count({ n }: { n: number }) {
  return <span className={n === 0 ? `hq-cell-nil hq-nums ${RIGHT}` : `hq-nums ${RIGHT}`}>{n.toLocaleString("en-AU")}</span>;
}

function RightDash({ label }: { label: string }) {
  return (
    <span className={`hq-cell-nil ${RIGHT}`}>
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PartnerPerformanceTable({
  rows,
  caption,
  sort,
  hrefForSort,
  empty,
}: {
  rows: readonly PartnerPerformanceRow[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<PartnerPerformanceRow>[] = [
    {
      key: "name",
      header: "Partner",
      primary: true,
      sortable: true,
      width: "13rem",
      cell: (r) => (
        <>
          <Link href={`${ORGANISATIONS}/${r.organisationId}`}>{r.name}</Link>
          {r.categories.length > 0 ? <span className="hq-cell-sub">{categories(r)}</span> : null}
        </>
      ),
    },
    { key: "received", header: "Received", sortable: true, align: "right", cell: (r) => <Count n={r.received} /> },
    { key: "sent", header: "Sent", sortable: true, align: "right", cell: (r) => <Count n={r.sent} /> },
    { key: "qualified", header: "Qualified", sortable: true, align: "right", cell: (r) => <Count n={r.qualified} /> },
    { key: "signed", header: "Signed", sortable: true, align: "right", cell: (r) => <Count n={r.signed} /> },
    {
      key: "conversion",
      header: "Conversion",
      sortable: true,
      align: "right",
      cell: (r) => (r.conversion === null ? <RightDash label="Nothing received yet" /> : <span className={`hq-nums ${RIGHT}`}>{formatConversion(r.conversion)}</span>),
    },
    {
      key: "value",
      header: <span title="The sum of your own estimates for the managements signed">Est. value signed</span>,
      sortable: true,
      align: "right",
      hideBelow: "xl",
      nowrap: true,
      cell: (r) =>
        r.signed > 0 && r.estimatedValueSignedCents > 0 ? <span className={`hq-nums ${RIGHT}`}>{formatAud(r.estimatedValueSignedCents)}</span> : <RightDash label="No estimate for the signed managements" />,
    },
    { key: "reciprocal", header: "Both ways", hideBelow: "xl", cell: (r) => (r.reciprocal ? <ReciprocalChip /> : <span className="hq-cell-nil">&mdash;</span>) },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(r) => r.organisationId} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <MobileList label="Partner performance">
          {rows.map((r) => (
            <MobileListItem
              key={r.organisationId}
              href={`${ORGANISATIONS}/${r.organisationId}`}
              title={r.name}
              subtitle={categories(r) || undefined}
              status={r.reciprocal ? <ReciprocalChip /> : undefined}
              meta={`${r.received} received · ${r.sent} sent · ${r.signed} signed`}
            />
          ))}
        </MobileList>
      }
    />
  );
}
