import Link from "next/link";
import type { ReactNode } from "react";
import { partnerHref, type ReferralPartner } from "@/lib/hq/referral-partners/types";
import { LinkButton } from "../../Button";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { CategoryTags, FollowUpCell, NeedsVerifyingChip, followUpText } from "../contacts/Bits";
import { LastContacted, PartnerStatus, ReferralsCell, referralLine } from "./Bits";

/*
 * The Referral partners list: a semantic table from 768px up, one card per partner below that
 * (the switch is CSS only, see DataTable.tsx). Server-rendered; sorting is link-based. Each row
 * carries the three quick actions the person may take (log a call, record a referral, create a
 * follow-up task); the links reuse the existing drawer and forms.
 */

export type PartnerActions = {
  /** Present when the person may log a call (growth.write). */
  logHref?: (p: ReferralPartner) => string;
  /** Present when the person may record a referral (growth.write). */
  referralHref?: (p: ReferralPartner) => string;
  /** Present when the person may create tasks (tasks.write). */
  taskHref?: (p: ReferralPartner) => string;
};

function QuickActions({ partner, actions, layout }: { partner: ReferralPartner; actions: PartnerActions; layout: "icons" | "buttons" }) {
  const items: { key: string; href: string; icon: "phone" | "link" | "task"; label: string; short: string }[] = [];
  if (actions.logHref) items.push({ key: "log", href: actions.logHref(partner), icon: "phone", label: `Log a call with ${partner.name}`, short: "Log a call" });
  if (actions.referralHref) items.push({ key: "ref", href: actions.referralHref(partner), icon: "link", label: `Record a referral for ${partner.name}`, short: "Referral" });
  if (actions.taskHref) items.push({ key: "task", href: actions.taskHref(partner), icon: "task", label: `Create a follow-up task for ${partner.name}`, short: "Follow-up task" });
  if (items.length === 0) return null;
  if (layout === "icons") {
    return (
      <span className="flex justify-end gap-1">
        {items.map((i) => (
          <LinkButton key={i.key} href={i.href} variant="ghost" size="sm" icon={i.icon} className="hq-iconbtn" aria-label={i.label} title={i.label} />
        ))}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-2">
      {items.map((i) => (
        <LinkButton key={i.key} href={i.href} size="sm" icon={i.icon} aria-label={i.label}>
          {i.short}
        </LinkButton>
      ))}
    </span>
  );
}

export function PartnersTable({
  rows,
  caption,
  sort,
  hrefForSort,
  timezone,
  today,
  actions,
  empty,
}: {
  rows: readonly ReferralPartner[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  timezone: string;
  today: string;
  actions: PartnerActions;
  empty: ReactNode;
}) {
  // One empty state, not one per layout.
  if (rows.length === 0) return <>{empty}</>;
  const hasActions = Boolean(actions.logHref || actions.referralHref || actions.taskHref);

  const columns: Column<ReferralPartner>[] = [
    {
      key: "name",
      header: "Partner",
      primary: true,
      sortable: true,
      width: "14rem",
      cell: (p) => (
        <>
          <Link href={partnerHref(p)}>{p.name}</Link>
          <span className="hq-cell-sub">
            {p.kind === "independent" ? "Independent" : p.primaryContactName ? p.primaryContactName : p.contactCount === 0 ? "No contacts yet" : "No primary contact"}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <CategoryTags categories={p.categories} max={1} />
            {p.needsVerification ? <NeedsVerifyingChip /> : null}
          </span>
        </>
      ),
    },
    { key: "status", header: "Status", sortable: true, cell: (p) => <PartnerStatus partner={p} /> },
    { key: "owner", header: "Owner", sortable: true, hideBelow: "xl", cell: (p) => p.ownerName ?? <span className="hq-cell-nil">Unassigned</span> },
    { key: "last_contacted", header: "Last contacted", sortable: true, nowrap: true, cell: (p) => <LastContacted partner={p} timezone={timezone} /> },
    { key: "follow_up", header: "Next follow-up", sortable: true, nowrap: true, cell: (p) => <FollowUpCell date={p.nextFollowUpDate} today={today} /> },
    { key: "referrals", header: "Referrals", sortable: true, cell: (p) => <ReferralsCell partner={p} today={today} /> },
    ...(hasActions
      ? [{ key: "actions", header: <span className="sr-only">Quick actions</span>, align: "right" as const, cell: (p: ReferralPartner) => <QuickActions partner={p} actions={actions} layout="icons" /> }]
      : []),
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(p) => p.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <ul className="hq-mlist" aria-label="Referral partners">
          {rows.map((p) => {
            const follow = followUpText(p.nextFollowUpDate, today);
            return (
              <li key={p.id} className="hq-mitem">
                <Link href={partnerHref(p)} className="hq-mitem__link">
                  <span className="hq-mitem__top">
                    <span className="hq-mitem__text">
                      <span className="hq-mitem__title">{p.name}</span>
                      <span className="hq-mitem__sub">
                        {p.kind === "independent" ? "Independent" : (p.primaryContactName ?? (p.contactCount === 0 ? "No contacts yet" : "No primary contact"))}
                        {p.ownerName ? ` · ${p.ownerName}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="hq-mitem__row">
                    <span className="flex flex-wrap gap-1.5">
                      <PartnerStatus partner={p} />
                      {p.needsVerification ? <NeedsVerifyingChip /> : null}
                    </span>
                  </span>
                  <span className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                    <span>
                      <span className="hq-cell-sub">Last contacted</span>
                      <LastContacted partner={p} timezone={timezone} />
                    </span>
                    <span>
                      <span className="hq-cell-sub">Referrals</span>
                      <span className={p.received === 0 && p.sent === 0 ? "hq-cell-nil" : undefined}>{referralLine(p)}</span>
                    </span>
                    {follow ? <span className={p.followUpOverdue ? "col-span-2 font-medium" : "col-span-2"}>{follow}</span> : null}
                  </span>
                </Link>
                {hasActions ? (
                  <div className="pb-4">
                    <QuickActions partner={p} actions={actions} layout="buttons" />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
