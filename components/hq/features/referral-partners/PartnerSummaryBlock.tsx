import Link from "next/link";
import { formatAud, formatDateTime } from "@/lib/hq/format";
import { formatDay } from "@/lib/hq/growth/dates";
import type { Loaded } from "@/lib/hq/growth/types";
import type { ReferralPartner } from "@/lib/hq/referral-partners/types";
import { HQ_ROUTES } from "../../nav";
import { SectionLabel } from "../../Primitives";
import { FollowUpCell } from "../contacts/Bits";
import { LastContacted, PartnerStatus } from "./Bits";

/*
 * "Partner summary" on an organisation's page: the same row the Referral partners list shows
 * (hq.referral_partner_overview), so the two always agree. Compact: a short definition list,
 * hairline above, no box.
 */

function Item({ term, children, hint }: { term: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt>
        {term}
        {hint ? <span className="block text-[13px] text-grey-text">{hint}</span> : null}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function PartnerSummaryBlock({ partner, timezone, today }: { partner: Loaded<ReferralPartner | null>; timezone: string; today: string }) {
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
      {!partner.ok || !partner.data ? (
        <p className="text-[14px] text-grey-text">We couldn&rsquo;t load the partner summary just now. Reload the page to try again.</p>
      ) : (
        <dl className="grid gap-2.5 text-[14px]">
          <Item term="Last contacted">
            <LastContacted partner={partner.data} timezone={timezone} />
            {partner.data.lastContactedAt ? <span className="block text-[13px] text-grey-text">{formatDateTime(partner.data.lastContactedAt, timezone)}</span> : null}
          </Item>
          <Item term="Next follow-up">
            <FollowUpCell date={partner.data.nextFollowUpDate} today={today} />
          </Item>
          <Item term="Relationship">
            <PartnerStatus partner={partner.data} />
          </Item>
          <Item term="Referred to Planted">
            <span className={partner.data.received === 0 ? "text-grey-text tabular-nums" : "font-semibold tabular-nums"}>{partner.data.received}</span>
          </Item>
          <Item term="Qualified" hint="Reached the Qualified stage">
            <span className="tabular-nums">{partner.data.qualified}</span>
          </Item>
          <Item term="Signed managements" hint="Each counted once, ever">
            <span className={partner.data.signed === 0 ? "text-grey-text tabular-nums" : "font-semibold tabular-nums"}>{partner.data.signed}</span>
          </Item>
          <Item term="Sent by Planted">
            <span className="tabular-nums">{partner.data.sent}</span>
          </Item>
          <Item term="Last referral">{partner.data.lastReferralDate ? formatDay(partner.data.lastReferralDate, today) : <span className="text-grey-text">None yet</span>}</Item>
          {partner.data.reciprocal ? <Item term="Both ways">Referrals received and sent</Item> : null}
          {partner.data.signed > 0 && partner.data.valueSignedCents > 0 ? (
            <Item term="Estimated value signed" hint="Your own yearly estimates">
              <span className="tabular-nums">{formatAud(partner.data.valueSignedCents)}</span>
            </Item>
          ) : null}
        </dl>
      )}
    </section>
  );
}
