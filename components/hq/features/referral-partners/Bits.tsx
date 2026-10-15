import { contactRecency, lastContactedLabel } from "@/lib/hq/growth/dates";
import { PARTNER_QUIET_DAYS } from "@/lib/hq/growth/params";
import { formatDateTime } from "@/lib/hq/format";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { StatusChip } from "../../StatusChip";

/*
 * "Last contacted" for the organisation page's partner summary.
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
