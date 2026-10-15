import Link from "next/link";
import { formatDate } from "@/lib/hq/format";
import type { ReferralListItem } from "@/lib/hq/referrals/types";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList, MobileListItem } from "../../MobileList";
import { CreditChip, Dash, DirectionChip, EstimateText, Nil, PartnerCell, SignedDate, StageOrOutcome, referralHref } from "./Bits";

/*
 * The referral register: a semantic table from 768px up, one stacked item per referral below that
 * (the switch is CSS only, see DataTable.tsx). Server-rendered; sorting is link-based. It carries
 * the prospect's name and suburb but never their phone, email or address.
 */

export function ReferralsTable({
  rows,
  caption,
  sort,
  hrefForSort,
  timezone,
  empty,
}: {
  rows: readonly ReferralListItem[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  timezone: string;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<ReferralListItem>[] = [
    {
      key: "ref",
      header: "Ref",
      primary: true,
      sortable: true,
      nowrap: true,
      cell: (r) => <Link href={referralHref(r.id)}>{r.refLabel}</Link>,
    },
    { key: "direction", header: "Direction", cell: (r) => <DirectionChip direction={r.direction} /> },
    {
      key: "partner",
      header: "Partner",
      sortable: true,
      cell: (r) => (
        <PartnerCell
          organisationId={r.partnerOrganisationId}
          organisationName={r.partnerOrganisationName}
          contactId={r.partnerContactId}
          contactName={r.partnerContactName}
        />
      ),
    },
    {
      key: "prospect",
      header: "Prospect",
      sortable: true,
      cell: (r) => (
        <>
          {r.prospectName ?? <Nil>Not recorded</Nil>}
          {r.propertySuburb ? <span className="hq-cell-sub">{r.propertySuburb}</span> : null}
        </>
      ),
    },
    {
      key: "stage",
      header: "Stage or outcome",
      sortable: true,
      cell: (r) => (
        <>
          <StageOrOutcome direction={r.direction} stage={r.stage} outcome={r.sentOutcome} />
          {r.direction === "received" ? (
            r.isAttributed ? (
              <span className="hq-cell-sub">Credited source</span>
            ) : (
              <span className="mt-1 block">
                <CreditChip isAttributed={false} />
              </span>
            )
          ) : null}
        </>
      ),
    },
    { key: "date", header: "Date", sortable: true, nowrap: true, cell: (r) => formatDate(r.referralDate, timezone) },
    {
      key: "assigned",
      header: "Assigned to",
      sortable: true,
      hideBelow: "xl",
      cell: (r) => r.assignedToName ?? <Nil>Unassigned</Nil>,
    },
    {
      key: "value",
      header: <span title="Your own estimate of a year's management revenue">Estimate</span>,
      sortable: true,
      align: "right",
      hideBelow: "xl",
      nowrap: true,
      cell: (r) => (r.direction === "received" ? <EstimateText cents={r.estimateCents} /> : <Dash label="Not applicable" right />),
    },
    {
      key: "signed",
      header: "Signed",
      sortable: true,
      hideBelow: "xl",
      nowrap: true,
      cell: (r) => (r.direction === "received" ? <SignedDate signedAt={r.signedAt} timezone={timezone} /> : <Dash label="Not applicable" />),
    },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(r) => r.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <MobileList label="Referrals">
          {rows.map((r) => (
            <MobileListItem
              key={r.id}
              href={referralHref(r.id)}
              title={`${r.refLabel}${r.prospectName ? ` · ${r.prospectName}` : ""}`}
              subtitle={[r.partnerOrganisationName ?? r.partnerContactName ?? "No partner", r.propertySuburb].filter(Boolean).join(" · ")}
              status={
                <span className="flex flex-wrap gap-1.5">
                  <DirectionChip direction={r.direction} />
                  <StageOrOutcome direction={r.direction} stage={r.stage} outcome={r.sentOutcome} labelled />
                  {r.direction === "received" && !r.isAttributed ? <CreditChip isAttributed={false} /> : null}
                </span>
              }
              meta={r.signedAt ? `Signed ${formatDate(r.signedAt, timezone)}` : formatDate(r.referralDate, timezone)}
            />
          ))}
        </MobileList>
      }
    />
  );
}

