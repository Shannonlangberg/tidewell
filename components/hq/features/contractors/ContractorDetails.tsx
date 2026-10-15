import { CONTRACTOR_EXPIRY_STATE_LABEL, CONTRACTOR_EXPIRY_STATE_TONE } from "@/lib/hq/constants";
import { formatAbn } from "@/lib/hq/contractors/abn";
import { formatRate } from "@/lib/hq/contractors/money";
import { ratingText, vettingProgressText, type Contractor } from "@/lib/hq/contractors/types";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { agoLabel, todayInZone } from "@/lib/hq/growth/dates";
import { lastUsedText } from "@/lib/hq/trades/rules";
import { KeyValueList, SectionLabel, type KeyValueItem } from "../../Primitives";
import { StatusChip } from "../../StatusChip";
import { NeedsVerifyingChip } from "../contacts/Bits";
import { TradeTags } from "./Bits";

/*
 * Details, rates and service areas for the contractor profile. Every unknown reads "Not recorded":
 * a missing rate is not $0, a missing emergency answer is not "no", an empty service area list is not
 * "everywhere". Server-rendered, no controls.
 */

function Group({ title, items }: { title: string; items: readonly KeyValueItem[] }) {
  return (
    <section aria-label={title}>
      <h3 className="hq-label mb-3 border-b border-line pb-2.5">{title}</h3>
      <KeyValueList items={items} />
    </section>
  );
}

function Paperwork({ details, state, expiresOn, verifiedAt }: { details: string | null; state: Contractor["licenceState"]; expiresOn: string | null; verifiedAt: string | null }) {
  if (state === "not_recorded" && !details) return null;
  return (
    <span className="grid gap-1.5">
      <span className="flex flex-wrap items-center gap-2">
        <StatusChip tone={CONTRACTOR_EXPIRY_STATE_TONE[state]}>{CONTRACTOR_EXPIRY_STATE_LABEL[state]}</StatusChip>
        <span className="text-[13px] font-normal text-grey-text">
          {expiresOn ? `${state === "expired" ? "Expired" : "Expires"} ${formatDate(expiresOn)}` : "No expiry date recorded"}
        </span>
      </span>
      {details ? <span className="whitespace-pre-line font-normal">{details}</span> : null}
      <span className="text-[13px] font-normal text-grey-text">{verifiedAt ? `Verified ${formatDate(verifiedAt)}` : "Not yet verified against a document"}</span>
    </span>
  );
}

export function ContractorDetails({ c, timezone }: { c: Contractor; timezone: string }) {
  const money = (cents: number | null) => (cents === null ? null : formatRate(cents));
  const ago = agoLabel(c.lastContactedAt, timezone);

  const contact: KeyValueItem[] = [
    { label: "Contact person", value: c.primaryContactName },
    { label: "Phone", value: c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">{c.phone}</a> : null },
    { label: "Email", value: c.email ? <a href={`mailto:${c.email}`} className="underline underline-offset-2 break-all">{c.email}</a> : null },
    {
      label: "Website",
      value: c.website ? (
        <a href={c.website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">
          {c.website.replace(/^https?:\/\//i, "")}
        </a>
      ) : null,
    },
    { label: "ABN", value: c.abn ? <span className="hq-nums">{formatAbn(c.abn)}</span> : null },
    { label: "Business hours", value: c.businessHours },
  ];

  const rates: KeyValueItem[] = [
    { label: "Hourly rate", value: money(c.hourlyRateCents) },
    { label: "Call-out fee", value: money(c.calloutFeeCents) },
    { label: "After-hours fee", value: money(c.afterHoursFeeCents) },
    { label: "Minimum charge", value: money(c.minimumChargeCents) },
    { label: "Invoice terms", value: c.invoiceTerms },
  ];

  const where: KeyValueItem[] = [
    { label: "Trades", value: c.categories.length > 0 ? <TradeTags labels={c.tradeLabels} /> : null },
    { label: "Suburbs", value: c.serviceSuburbs.length > 0 ? c.serviceSuburbs.join(", ") : null },
    { label: "Regions", value: c.serviceRegions.length > 0 ? c.serviceRegions.join(", ") : null },
    { label: "Emergency call-outs", value: c.emergencyAvailable === null ? null : c.emergencyAvailable ? "Yes" : "No" },
  ];

  const standing: KeyValueItem[] = [
    { label: "Licence", value: c.licenceState === "not_recorded" && !c.licenceDetails ? null : <Paperwork details={c.licenceDetails} state={c.licenceState} expiresOn={c.licenceExpiresOn} verifiedAt={c.licenceVerifiedAt} /> },
    { label: "Insurance", value: c.insuranceState === "not_recorded" && !c.insuranceDetails ? null : <Paperwork details={c.insuranceDetails} state={c.insuranceState} expiresOn={c.insuranceExpiresOn} verifiedAt={c.insuranceVerifiedAt} /> },
  ];

  const relationship: KeyValueItem[] = [
    { label: "Relationship owner", empty: "No owner", value: c.ownerName },
    { label: "Vetting", value: `${vettingProgressText(c.vettingDoneCount)} steps done` },
    { label: "Feedback", value: ratingText(c) },
    { label: "Last contact", empty: "Not contacted yet", value: c.lastContactedAt ? <time dateTime={c.lastContactedAt}>{ago}<span className="block text-[13px] font-normal text-grey-text">{formatDateTime(c.lastContactedAt, timezone)}</span></time> : null },
    {
      label: "Last used",
      empty: "Never recorded",
      value: c.lastJobDate ? (
        <>
          {lastUsedText(c.lastJobDate, todayInZone(timezone))}
          <span className="block text-[13px] font-normal text-grey-text">Recorded by staff (HQ is not connected to Ailo)</span>
        </>
      ) : null,
    },
    { label: "Approved", value: c.approvedAt ? `${formatDate(c.approvedAt, timezone)}${c.approvedByName ? ` by ${c.approvedByName}` : ""}` : null, empty: "Not approved" },
    { label: "Source", value: c.source },
    { label: "Verification", value: c.needsVerification ? <NeedsVerifyingChip /> : c.verifiedAt ? `Verified ${formatDate(c.verifiedAt, timezone)}` : "No flag" },
    { label: "Added", value: c.createdAt ? formatDate(c.createdAt, timezone) : null },
  ];

  return (
    <section aria-labelledby="details-h">
      <SectionLabel as="h2" id="details-h" className="mb-6 border-b border-line pb-3.5">
        Details
      </SectionLabel>
      <div className="grid gap-x-14 gap-y-9 md:grid-cols-2">
        <Group title="Contact" items={contact} />
        <Group title="Rates and terms" items={rates} />
        <Group title="Where they work" items={where} />
        <Group title="Licence and insurance" items={standing} />
        <Group title="Relationship" items={relationship} />
        {c.internalNotes ? (
          <section aria-label="Internal notes">
            <h3 className="hq-label mb-3 border-b border-line pb-2.5">Internal notes</h3>
            <p className="whitespace-pre-line text-[14px]">{c.internalNotes}</p>
          </section>
        ) : null}
      </div>
    </section>
  );
}
