import Link from "next/link";
import { agoLabel } from "@/lib/hq/growth/dates";
import { ratingText, vettingProgressText, type Contractor } from "@/lib/hq/contractors/types";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList, MobileListItem } from "../../MobileList";
import { HQ_ROUTES } from "../../nav";
import { NeedsVerifyingChip } from "../contacts/Bits";
import { agoText, daysAgo, lastUsedText } from "@/lib/hq/trades/rules";
import { todayInZone } from "@/lib/hq/growth/dates";
import { formatDate } from "@/lib/hq/format";
import { ClearedButExpired, ContractorStatusChip, ExpiryCell, LastUsed, RatingCell, ServiceAreas, TradeTags, areasText } from "./Bits";

/*
 * The contractor directory: a semantic table from 768px up, one card per contractor below that
 * (the switch is CSS only, see DataTable.tsx). Server-rendered; sorting is link-based.
 */

export function ContractorsTable({
  rows,
  caption,
  sort,
  hrefForSort,
  timezone,
  empty,
}: {
  rows: readonly Contractor[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  timezone: string;
  empty: React.ReactNode;
}) {
  const today = todayInZone(timezone);
  const columns: Column<Contractor>[] = [
    {
      key: "name",
      header: "Business",
      primary: true,
      sortable: true,
      width: "13rem",
      cell: (c) => (
        <>
          <Link href={`${HQ_ROUTES.partners}/${c.id}`}>{c.businessName}</Link>
          {c.primaryContactName ? <span className="hq-cell-sub">{c.primaryContactName}</span> : null}
          {c.needsVerification ? (
            <span style={{ display: "block", marginTop: 6 }}>
              <NeedsVerifyingChip />
            </span>
          ) : null}
        </>
      ),
    },
    { key: "trades", header: "Trades", hideBelow: "lg", cell: (c) => <TradeTags labels={c.tradeLabels} max={2} /> },
    { key: "areas", header: "Service areas", hideBelow: "xl", cell: (c) => <ServiceAreas suburbs={c.serviceSuburbs} regions={c.serviceRegions} /> },
    {
      key: "status",
      header: "Status",
      sortable: true,
      cell: (c) => (
        <>
          <ContractorStatusChip status={c.status} />
          <span style={{ display: "block", marginTop: 6 }}>
            <ClearedButExpired contractor={c} />
          </span>
        </>
      ),
    },
    { key: "vetting", header: "Vetting", sortable: true, hideBelow: "lg", nowrap: true, cell: (c) => <span className="hq-nums">{vettingProgressText(c.vettingDoneCount)}</span> },
    { key: "insurance", header: "Insurance", sortable: true, cell: (c) => <ExpiryCell state={c.insuranceState} expiresOn={c.insuranceExpiresOn} daysRemaining={c.insuranceDaysRemaining} /> },
    { key: "licence", header: "Licence", sortable: true, hideBelow: "lg", cell: (c) => <ExpiryCell state={c.licenceState} expiresOn={c.licenceExpiresOn} daysRemaining={c.licenceDaysRemaining} /> },
    { key: "owner", header: "Owner", sortable: true, hideBelow: "xl", cell: (c) => c.ownerName ?? <span className="hq-cell-nil">Unassigned</span> },
    { key: "rating", header: "Rating", sortable: true, hideBelow: "xl", cell: (c) => <RatingCell contractor={c} /> },
    {
      key: "used",
      header: "Last used",
      sortable: true,
      hideBelow: "lg",
      cell: (c) =>
        c.lastJobDate ? (
          <>
            <span className="hq-nums">{formatDate(c.lastJobDate)}</span>
            <span className="hq-cell-sub">{agoText(daysAgo(c.lastJobDate, today) ?? 0)}</span>
          </>
        ) : (
          <LastUsed date={null} today={today} />
        ),
    },
  ];

  if (rows.length === 0) return <>{empty}</>;

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(c) => c.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <MobileList label="Contractors">
          {rows.map((c) => {
            const ago = agoLabel(c.lastContactedAt, timezone);
            const trade = c.tradeLabels.slice(0, 2).join(", ") + (c.tradeLabels.length > 2 ? ` +${c.tradeLabels.length - 2}` : "");
            const areas = areasText(c.serviceSuburbs, c.serviceRegions, 2);
            return (
              <MobileListItem
                key={c.id}
                href={`${HQ_ROUTES.partners}/${c.id}`}
                title={c.businessName}
                subtitle={[trade, areas].filter(Boolean).join(" · ") || "No trade or area recorded"}
                status={
                  <span className="flex flex-wrap gap-1.5">
                    <ContractorStatusChip status={c.status} />
                    {c.needsVerification ? <NeedsVerifyingChip /> : null}
                    <ClearedButExpired contractor={c} />
                  </span>
                }
                meta={
                  c.status === "vetting" || c.status === "prospect" || c.status === "contacted"
                    ? `Vetting ${vettingProgressText(c.vettingDoneCount)}`
                    : c.lastJobDate
                      ? lastUsedText(c.lastJobDate, today)
                      : c.rating !== null
                      ? ratingText(c)
                      : ago
                        ? `Contacted ${ago.toLowerCase()}`
                        : undefined
                }
              />
            );
          })}
        </MobileList>
      }
    />
  );
}
