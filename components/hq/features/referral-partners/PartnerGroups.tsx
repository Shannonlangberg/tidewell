import Link from "next/link";
import type { ReactNode } from "react";
import { followUpState, formatDay, lastContactedLabel, overdueLabel } from "@/lib/hq/growth/dates";
import type { PartnerGroup } from "@/lib/hq/growth/params";
import { partnerHref, type ReferralPartner } from "@/lib/hq/referral-partners/types";
import { LinkButton } from "../../Button";
import { StatusChip } from "../../StatusChip";

/*
 * The Referral partners list as the groups a BDM works through: Call first (a follow-up is due),
 * Warm, Quiet, Never spoken. One clean row per partner that says only what is different about it:
 * the person, a phone to tap, when we last spoke, referrals when there are any, the next follow-up
 * when one is set, and labelled Call / Log / Follow up buttons. Server-rendered; the collapsed
 * group is a native <details>, so it works without JavaScript.
 */

export type PartnerActions = {
  /** Present when the person may log a call (growth.write). */
  logHref?: (p: ReferralPartner) => string;
  /** Present when the person may create tasks (tasks.write). */
  taskHref?: (p: ReferralPartner) => string;
};

/**
 * Which rows carry a verification marker. When most partners still need verifying the page says so
 * once, and only the checked ones are marked; otherwise only the unchecked ones are.
 */
export type VerifyMarker = "needs" | "verified" | "none";

export const GROUP_TITLE: Record<PartnerGroup, string> = {
  call: "Call first",
  warm: "Warm",
  quiet: "Quiet",
  never: "Never spoken",
};

export const GROUP_HINT: Record<PartnerGroup, string> = {
  call: "A follow-up is due today or overdue.",
  warm: "Spoken to in the last 30 days.",
  quiet: "Last spoke more than 30 days ago.",
  never: "No call, meeting or note logged yet.",
};

/** A phone number as a tel: target: digits and a leading plus only. */
function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? `tel:${digits}` : null;
}

/** "Last spoke today", "Last spoke 3 days ago". */
function lastSpoke(days: number | null): string | null {
  if (days === null) return null;
  const label = lastContactedLabel(days);
  return `Last spoke ${label === "Today" || label === "Yesterday" ? label.toLowerCase() : label}`;
}

function FollowUp({ date, today }: { date: string | null; today: string }) {
  const state = followUpState(date, today);
  if (state.kind === "none") return null;
  if (state.kind === "overdue") return <StatusChip tone="error">Follow-up {overdueLabel(state.days)}</StatusChip>;
  if (state.kind === "today") return <span className="font-semibold">Follow-up due today</span>;
  return <span>Follow up {formatDay(date, today)}</span>;
}

function PartnerRow({
  partner: p,
  group,
  today,
  actions,
  marker,
}: {
  partner: ReferralPartner;
  group: PartnerGroup;
  today: string;
  actions: PartnerActions;
  marker: VerifyMarker;
}) {
  const person = p.kind === "organisation" ? p.primaryContactName : null;
  const tel = p.primaryContactPhone ? telHref(p.primaryContactPhone) : null;
  const who = person ? `${person} at ${p.name}` : p.name;
  const meta: ReactNode[] = [];
  // The group heading already says "never" for that group; everywhere else the gap is the point.
  if (group !== "never") meta.push(<span key="l">{p.daysSinceContact === null ? "Never spoken" : lastSpoke(p.daysSinceContact)}</span>);
  if (p.received > 0) {
    meta.push(
      <span key="r" className="font-medium">
        Referred {p.received.toLocaleString("en-AU")}
        {p.signed > 0 ? ` · ${p.signed.toLocaleString("en-AU")} signed` : ""}
      </span>,
    );
  }
  const showMarker = (marker === "needs" && p.needsVerification) || (marker === "verified" && !p.needsVerification);

  return (
    <li className="hq-prow">
      <div className="hq-prow__main">
        <p className="hq-prow__title">
          <Link href={partnerHref(p)} className="hq-prow__name">
            {p.name}
          </Link>
          {showMarker ? (
            <StatusChip tone={marker === "needs" ? "warning" : "success"} className="hq-prow__marker">
              {marker === "needs" ? "Needs verifying" : "Verified"}
            </StatusChip>
          ) : null}
        </p>
        {person || p.primaryContactPhone ? (
          <p className="hq-prow__person">
            {person ? <span>{person}</span> : null}
            {p.primaryContactPhone ? (
              tel ? (
                <a href={tel} className="hq-prow__phone">
                  {p.primaryContactPhone}
                </a>
              ) : (
                <span>{p.primaryContactPhone}</span>
              )
            ) : null}
          </p>
        ) : null}
        {p.nextFollowUpDate ? (
          <p className="hq-prow__follow">
            <FollowUp date={p.nextFollowUpDate} today={today} />
          </p>
        ) : null}
        {meta.length > 0 ? <p className="hq-prow__meta">{meta}</p> : null}
      </div>
      {tel || actions.logHref || actions.taskHref ? (
        <div className="hq-prow__actions">
          {tel ? (
            <a href={tel} className={`hq-btn ${group === "call" ? "hq-btn--primary" : "hq-btn--secondary"}`} aria-label={`Call ${who}, ${p.primaryContactPhone}`}>
              <span className="hq-btn__label">Call</span>
            </a>
          ) : null}
          {actions.logHref ? (
            <LinkButton href={actions.logHref(p)} aria-label={`Log a call with ${p.name}`}>
              Log
            </LinkButton>
          ) : null}
          {actions.taskHref ? (
            <LinkButton href={actions.taskHref(p)} aria-label={`Create a follow-up for ${p.name}`}>
              Follow up
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function PartnerRows({
  rows,
  group,
  today,
  actions,
  marker,
  label,
}: {
  rows: readonly ReferralPartner[];
  group: PartnerGroup;
  today: string;
  actions: PartnerActions;
  marker: VerifyMarker;
  label: string;
}) {
  return (
    <ul className="hq-prows" aria-label={label}>
      {rows.map((p) => (
        <PartnerRow key={p.id} partner={p} group={group} today={today} actions={actions} marker={marker} />
      ))}
    </ul>
  );
}

/** One group: a heading with its count, the rows, and a link to the rest when the group is long. */
export function PartnerGroupSection({
  group,
  rows,
  total,
  today,
  actions,
  marker,
  moreHref,
  collapsed,
}: {
  group: PartnerGroup;
  rows: readonly ReferralPartner[];
  total: number;
  today: string;
  actions: PartnerActions;
  marker: VerifyMarker;
  /** Where "Show all" leads when the group has more rows than are shown. */
  moreHref: string;
  /** Start closed (the Never spoken group, when long). */
  collapsed?: boolean;
}) {
  const id = `group-${group}`;
  const heading = (
    <>
      <span className="hq-pgroup__title">{GROUP_TITLE[group]}</span>
      <span className="hq-pgroup__count">{total.toLocaleString("en-AU")}</span>
      <span className="hq-pgroup__hint">{GROUP_HINT[group]}</span>
    </>
  );
  const body = (
    <>
      <PartnerRows rows={rows} group={group} today={today} actions={actions} marker={marker} label={`${GROUP_TITLE[group]}, ${total}`} />
      {total > rows.length ? (
        <p className="hq-pgroup__more">
          <Link href={moreHref}>
            Show all {total.toLocaleString("en-AU")} {GROUP_TITLE[group].toLowerCase()}
          </Link>
        </p>
      ) : null}
    </>
  );

  if (collapsed !== undefined) {
    return (
      <section aria-labelledby={id} className="hq-pgroup">
        <details className="hq-pgroup__details" open={!collapsed || undefined}>
          <summary className="hq-pgroup__head hq-pgroup__summary">
            <h2 id={id} className="hq-pgroup__h">
              {heading}
            </h2>
          </summary>
          {body}
        </details>
      </section>
    );
  }
  return (
    <section aria-labelledby={id} className="hq-pgroup">
      <div className="hq-pgroup__head">
        <h2 id={id} className="hq-pgroup__h">
          {heading}
        </h2>
      </div>
      {body}
    </section>
  );
}
