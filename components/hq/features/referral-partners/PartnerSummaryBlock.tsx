import Link from "next/link";
import { formatAud } from "@/lib/hq/format";
import { formatDay } from "@/lib/hq/growth/dates";
import type { Loaded } from "@/lib/hq/growth/types";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { HQ_ROUTES } from "../../nav";
import { SectionLabel } from "../../Primitives";
import { FollowUpCell } from "../contacts/Bits";
import { LastContacted } from "./Bits";

/*
 * "Partner summary" on an organisation's page: the same row the Referral partners list shows
 * (hq.referral_partner_overview), so the two always agree. Only what is true of this partner: when
 * we last spoke, the next follow-up if one is set, and referrals once there are any. A short
 * definition list, hairline above, no box.
 */

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>{term}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function PartnerSummaryBlock({ partner, timezone, today }: { partner: Loaded<ReferralPartner | null>; timezone: string; today: string }) {
  const p = partner.ok ? partner.data : null;
  return (
    <section aria-labelledby="partner-summary-h">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <SectionLabel as="h2" id="partner-summary-h">
          Partner summary
        </SectionLabel>
        <Link href={HQ_ROUTES.referralPartners} className="text-[13px] underline underline-offset-2">
          All referral partners
        </Link>
      </div>
      {!p ? (
        <p className="text-[14px] text-grey-text">We couldn&rsquo;t load the partner summary just now. Reload the page to try again.</p>
      ) : (
        <dl className="grid gap-2.5 text-[14px]">
          <Item term="Last spoke">
            <LastContacted partner={p} timezone={timezone} />
          </Item>
          {p.nextFollowUpDate ? (
            <Item term="Next follow-up">
              <FollowUpCell date={p.nextFollowUpDate} today={today} />
            </Item>
          ) : null}
          <Item term="Referred to Planted">
            {p.received > 0 ? (
              <span className="font-semibold tabular-nums">
                {p.received.toLocaleString("en-AU")}
                {p.signed > 0 ? ` · ${p.signed.toLocaleString("en-AU")} signed` : ""}
              </span>
            ) : (
              <span className="text-grey-text">None yet</span>
            )}
          </Item>
          {p.received > 0 && p.qualified > 0 ? (
            <Item term="Reached qualified">
              <span className="tabular-nums">{p.qualified.toLocaleString("en-AU")}</span>
            </Item>
          ) : null}
          {p.sent > 0 ? (
            <Item term="Sent by Planted">
              <span className="tabular-nums">{p.sent.toLocaleString("en-AU")}</span>
            </Item>
          ) : null}
          {p.lastReferralDate ? <Item term="Last referral">{formatDay(p.lastReferralDate, today)}</Item> : null}
          {p.signed > 0 && p.valueSignedCents > 0 ? (
            <Item term="Estimated value signed">
              <span className="tabular-nums">{formatAud(p.valueSignedCents)}</span>
            </Item>
          ) : null}
        </dl>
      )}
    </section>
  );
}
