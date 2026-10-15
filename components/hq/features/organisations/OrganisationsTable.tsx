import Link from "next/link";
import { agoLabel } from "@/lib/hq/growth/dates";
import { formatDateTime } from "@/lib/hq/format";
import type { Organisation } from "@/lib/hq/growth/types";
import type { ReferralCounts } from "@/lib/hq/organisations/queries";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList, MobileListItem } from "../../MobileList";
import { CategoryTags, NeedsVerifyingChip } from "../contacts/Bits";
import { CATEGORY_LABEL } from "@/lib/hq/constants";

/*
 * The organisations list: a semantic table from 768px up, one card per organisation below that.
 * Server-rendered; sorting is link-based.
 */

function referralText(r: ReferralCounts | undefined): string | null {
  if (!r || r.received + r.sent === 0) return null;
  return [r.received ? `${r.received} received` : null, r.sent ? `${r.sent} sent` : null, r.signed ? `${r.signed} signed` : null].filter(Boolean).join(" · ");
}

export function OrganisationsTable({
  rows,
  referrals,
  caption,
  sort,
  hrefForSort,
  timezone,
  empty,
}: {
  rows: readonly Organisation[];
  referrals: Record<string, ReferralCounts>;
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  timezone: string;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<Organisation>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      width: "15rem",
      cell: (o) => (
        <>
          <Link href={`/hq/growth/organisations/${o.id}`}>{o.name}</Link>
          {o.needsVerification ? (
            <span className="mt-1 block">
              <NeedsVerifyingChip />
            </span>
          ) : null}
        </>
      ),
    },
    { key: "categories", header: "Categories", hideBelow: "xl", cell: (o) => <CategoryTags categories={o.categories} max={2} /> },
    { key: "region", header: "Region", sortable: true, hideBelow: "lg", cell: (o) => o.serviceRegion ?? <span className="hq-cell-nil">Not recorded</span> },
    { key: "contacts", header: "Contacts", sortable: true, align: "right", cell: (o) => <span className="tabular-nums">{o.contactCount}</span> },
    {
      key: "primary",
      header: "Primary contact",
      cell: (o) =>
        o.primaryContactId && o.primaryContactName ? (
          <Link href={`/hq/growth/contacts/${o.primaryContactId}`} className="underline-offset-2 hover:underline">
            {o.primaryContactName}
          </Link>
        ) : (
          <span className="hq-cell-nil">None</span>
        ),
    },
    { key: "owner", header: "Owner", sortable: true, hideBelow: "lg", cell: (o) => o.ownerName ?? <span className="hq-cell-nil">Unassigned</span> },
    {
      key: "last_contact",
      header: "Last interaction",
      sortable: true,
      nowrap: true,
      cell: (o) => {
        const ago = agoLabel(o.lastContactAt, timezone);
        return ago ? (
          <time dateTime={o.lastContactAt ?? undefined} title={formatDateTime(o.lastContactAt, timezone)}>
            {ago}
          </time>
        ) : (
          <span className="hq-cell-nil">Not yet</span>
        );
      },
    },
    { key: "referrals", header: "Referrals", hideBelow: "lg", cell: (o) => referralText(referrals[o.id]) ?? <span className="hq-cell-nil">None yet</span> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(o) => o.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <MobileList label="Organisations">
          {rows.map((o) => (
            <MobileListItem
              key={o.id}
              href={`/hq/growth/organisations/${o.id}`}
              title={o.name}
              subtitle={o.categories.map((c) => CATEGORY_LABEL[c]).join(", ")}
              status={o.needsVerification ? <NeedsVerifyingChip /> : undefined}
              meta={`${o.contactCount} ${o.contactCount === 1 ? "contact" : "contacts"}`}
            />
          ))}
        </MobileList>
      }
    />
  );
}
