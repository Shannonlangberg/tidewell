import Link from "next/link";
import { agoLabel } from "@/lib/hq/growth/dates";
import { formatDateTime } from "@/lib/hq/format";
import { type Contact } from "@/lib/hq/growth/types";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList, MobileListItem } from "../../MobileList";
import { PriorityChip, RelationshipChip } from "../../StatusChip";
import { CategoryTags, FollowUpCell, NeedsVerifyingChip, followUpText } from "./Bits";
import { HQ_ROUTES } from "../../nav";

/*
 * The contacts list: a semantic table from 768px up, one card per contact below that (the
 * switch is CSS only, see DataTable.tsx). Server-rendered; sorting is link-based.
 */

export function ContactsTable({
  rows,
  caption,
  sort,
  hrefForSort,
  timezone,
  today,
  empty,
}: {
  rows: readonly Contact[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  timezone: string;
  today: string;
  empty: React.ReactNode;
}) {
  const lastContact = (c: Contact) => {
    const ago = agoLabel(c.lastContactAt, timezone);
    return ago ? (
      <time dateTime={c.lastContactAt ?? undefined} title={formatDateTime(c.lastContactAt, timezone)}>
        {ago}
      </time>
    ) : (
      <span className="hq-cell-nil">Not yet</span>
    );
  };

  const columns: Column<Contact>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      width: "15rem",
      cell: (c) => (
        <>
          <Link href={`${HQ_ROUTES.contacts}/${c.id}`}>{c.fullName}</Link>
          <span className="hq-cell-sub">{c.organisationName ?? "No organisation"}</span>
          {c.needsVerification ? (
            <span style={{ display: "block", marginTop: 6 }}>
              <NeedsVerifyingChip />
            </span>
          ) : null}
        </>
      ),
    },
    { key: "categories", header: "Categories", hideBelow: "xl", cell: (c) => <CategoryTags categories={c.categories} max={2} /> },
    { key: "status", header: "Status", sortable: true, cell: (c) => <RelationshipChip status={c.status} /> },
    { key: "priority", header: "Priority", sortable: true, hideBelow: "lg", cell: (c) => <PriorityChip priority={c.priority} /> },
    {
      key: "owner",
      header: "Owner",
      sortable: true,
      hideBelow: "lg",
      cell: (c) => c.ownerName ?? <span className="hq-cell-nil">Unassigned</span>,
    },
    { key: "last_contact", header: "Last contact", sortable: true, nowrap: true, cell: lastContact },
    { key: "follow_up", header: "Next follow-up", sortable: true, nowrap: true, cell: (c) => <FollowUpCell date={c.nextFollowUpDate} today={today} /> },
  ];

  // One empty state, not one per layout.
  if (rows.length === 0) return <>{empty}</>;

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(c) => c.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        (
          <MobileList label="Contacts">
            {rows.map((c) => (
              <MobileListItem
                key={c.id}
                href={`${HQ_ROUTES.contacts}/${c.id}`}
                title={c.fullName}
                subtitle={c.organisationName ?? "No organisation"}
                status={
                  <span className="flex flex-wrap gap-1.5">
                    <RelationshipChip status={c.status} />
                    {c.needsVerification ? <NeedsVerifyingChip /> : null}
                  </span>
                }
                meta={followUpText(c.nextFollowUpDate, today) ?? (agoLabel(c.lastContactAt, timezone) ? `Last contact: ${agoLabel(c.lastContactAt, timezone)}` : "Not contacted yet")}
              />
            ))}
          </MobileList>
        )
      }
    />
  );
}
