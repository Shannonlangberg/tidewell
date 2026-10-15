import { contactRecency, formatDay, lastContactedLabel } from "@/lib/hq/growth/dates";
import { PARTNER_QUIET_DAYS } from "@/lib/hq/growth/params";
import { formatDateTime } from "@/lib/hq/format";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { RelationshipChip, StatusChip } from "../../StatusChip";

/*
 * Small server-safe pieces for the Referral partners page and the organisation's partner summary.
 */

/**
 * "3 days ago", "Never". Longer than a month, or never, reads in the gentle warning tone (a dot and
 * the words, never colour alone); the exact date and time is on hover and in the <time> element.
 */
export function LastContacted({ partner, timezone }: { partner: Pick<ReferralPartner, "daysSinceContact" | "lastContactedAt">; timezone: string }) {
  const label = lastContactedLabel(partner.daysSinceContact);
  const tone = contactRecency(partner.daysSinceContact, PARTNER_QUIET_DAYS);
  if (tone === "never") {
    return (
      <StatusChip tone="warning" title="No call, meeting or note has been logged yet">
        Never
      </StatusChip>
    );
  }
  const exact = formatDateTime(partner.lastContactedAt, timezone);
  const time = (
    <time dateTime={partner.lastContactedAt ?? undefined} title={exact}>
      {label}
    </time>
  );
  return tone === "quiet" ? (
    <StatusChip tone="warning" title={`${exact}. Over ${PARTNER_QUIET_DAYS} days ago`}>
      {time}
    </StatusChip>
  ) : (
    time
  );
}

/** The relationship status, or a quiet note when an organisation has no contacts to carry one. */
export function PartnerStatus({ partner }: { partner: Pick<ReferralPartner, "status"> }) {
  return partner.status ? <RelationshipChip status={partner.status} /> : <span className="hq-cell-nil">No contacts yet</span>;
}

/** "Referred 3" with "1 signed · 1 sent by Planted · Last Tue 7 Oct" beneath; a plain "Referred 0" when nothing has come in. */
export function ReferralsCell({ partner, today }: { partner: Pick<ReferralPartner, "received" | "sent" | "signed" | "lastReferralDate">; today: string }) {
  const sub = [partner.signed > 0 ? `${partner.signed.toLocaleString("en-AU")} signed` : null, partner.sent > 0 ? `${partner.sent.toLocaleString("en-AU")} sent by Planted` : null, partner.lastReferralDate ? `Last ${formatDay(partner.lastReferralDate, today)}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <span className={partner.received === 0 ? "hq-cell-nil" : "font-medium"}>Referred {partner.received.toLocaleString("en-AU")}</span>
      {sub ? <span className="hq-cell-sub">{sub}</span> : null}
    </>
  );
}

/** The one-line text form for a mobile card. */
export function referralLine(p: Pick<ReferralPartner, "received" | "sent" | "signed">): string {
  if (p.received === 0 && p.sent === 0) return "Referred 0";
  return [`Referred ${p.received}`, p.sent ? `${p.sent} sent` : null, p.signed ? `${p.signed} signed` : null].filter(Boolean).join(" · ");
}
