import Link from "next/link";
import { CONTRACTOR_EXPIRY_STATE_LABEL, CONTRACTOR_EXPIRY_STATE_TONE, type ContractorExpiryState } from "@/lib/hq/constants";
import { ratingText, type Contractor } from "@/lib/hq/contractors/types";
import { coverageLine, lastUsedText, type TradeContainer as Container } from "@/lib/hq/trades/rules";
import { LinkButton } from "../../Button";
import { Icon } from "../../icons";
import { HQ_ROUTES } from "../../nav";
import { StatusChip } from "../../StatusChip";
import { ContractorStatusChip, areasText } from "../contractors/Bits";
import { RecordJobButton } from "../contractors/RecordJob";

/*
 * One trade on the Trades page: its name and description, the counts, a coverage line that says
 * plainly when nobody is approved for it, when it was last used, and its contractors (a contractor
 * in several trades is listed in each). Long lists show the first few and fold the rest under
 * "Show all n" (native <details>, no script). Server-rendered; "Record a job" is the only client part.
 */

const SHOWN = 5;

function Paper({ what, state }: { what: string; state: ContractorExpiryState }) {
  if (state === "not_recorded") return <span className="text-[13px] text-grey-text">{what}: not recorded</span>;
  return (
    <StatusChip tone={CONTRACTOR_EXPIRY_STATE_TONE[state]}>
      {what}: {CONTRACTOR_EXPIRY_STATE_LABEL[state].toLowerCase()}
    </StatusChip>
  );
}

function Row({ c, today, canWrite, returnTo }: { c: Contractor; today: string; canWrite: boolean; returnTo: string }) {
  const areas = areasText(c.serviceSuburbs, c.serviceRegions, 3);
  return (
    <li className="grid gap-2 border-t border-line py-3.5 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-x-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Link href={`${HQ_ROUTES.partners}/${c.id}`} className="font-medium text-charcoal underline-offset-2 hover:underline">
            {c.businessName}
          </Link>
          <ContractorStatusChip status={c.status} />
        </div>
        <p className="text-[13px] text-grey-text">{areas ? `Services ${areas}` : "Service areas not recorded"}</p>
        <div className="flex flex-wrap gap-1.5">
          {c.insuranceState === "not_recorded" && c.licenceState === "not_recorded" ? (
            <span className="text-[13px] text-grey-text">Insurance and licence not recorded</span>
          ) : (
            <>
              <Paper what="Insurance" state={c.insuranceState} />
              <Paper what="Licence" state={c.licenceState} />
            </>
          )}
          {c.rating !== null ? <StatusChip plain>{ratingText(c)}</StatusChip> : null}
        </div>
        <p className="text-[13px]">
          <span className={c.lastJobDate ? "text-charcoal" : "text-grey-text"}>{c.lastJobDate ? lastUsedText(c.lastJobDate, today) : "Last used: never recorded"}</span>
        </p>
      </div>
      {canWrite ? (
        <div className="sm:pt-0.5">
          <RecordJobButton contractorId={c.id} businessName={c.businessName} lastJobDate={c.lastJobDate} today={today} returnTo={returnTo} variant="ghost" />
        </div>
      ) : null}
    </li>
  );
}

export function TradeContainer({ container, today, canWrite, returnTo }: { container: Container<Contractor>; today: string; canWrite: boolean; returnTo: string }) {
  const { trade, contractors, counts, lastUsed } = container;
  const label = trade?.label ?? "Trades not on the list";
  const slug = trade?.slug ?? "unknown";
  const headingId = `trade-${slug}-h`;
  const coverage = trade ? coverageLine(counts, label) : { tone: "warning" as const, text: "These contractors carry a trade that is no longer on the list. Edit them to choose a current trade." };
  const first = contractors.slice(0, SHOWN);
  const rest = contractors.slice(SHOWN);

  return (
    <section id={`trade-${slug}`} aria-labelledby={headingId} className="hq-panel flex min-w-0 flex-col">
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={headingId} className="text-[17px] font-semibold leading-snug text-charcoal">
            {label}
          </h2>
          {trade && !trade.isActive ? <StatusChip tone="neutral">Archived trade</StatusChip> : null}
        </div>
        {trade?.description ? <p className="text-[14px] text-grey-text">{trade.description}</p> : null}
      </header>

      {counts.total === 0 ? null : (
      <dl className="mt-4 grid grid-cols-4 gap-2 border-y border-line py-3 text-center" aria-label={`${label}: contractors by status`}>
        {[
          ["Approved", counts.cleared, "Approved or preferred"],
          ["Vetting", counts.vetting, "Being vetted"],
          ["Prospects", counts.prospects, "Prospects, or contacted and not yet vetting"],
          ["Total", counts.total, "Everyone in this trade, including suspended and inactive"],
        ].map(([name, n, title]) => (
          <div key={name as string} title={title as string}>
            <dt className="hq-label">{name}</dt>
            <dd className="hq-nums mt-1 text-[20px] text-charcoal">{n}</dd>
          </div>
        ))}
      </dl>
      )}

      <p className={`mt-3 flex items-start gap-2 text-[14px] ${coverage.tone === "warning" ? "font-medium text-charcoal" : "text-grey-text"}`}>
        {coverage.tone === "warning" ? <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> : null}
        <span>{coverage.text}</span>
      </p>
      {counts.total === 0 ? null : <p className="mt-1 text-[13px] text-grey-text">{lastUsed ? `Most recent job: ${lastUsedText(lastUsed, today).replace(/^Last used /, "")}` : "No job recorded for this trade yet."}</p>}

      {contractors.length > 0 ? (
        <>
          <ul className="mt-3" aria-label={`Contractors in ${label}`}>
            {first.map((c) => (
              <Row key={c.id} c={c} today={today} canWrite={canWrite} returnTo={returnTo} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer py-3 text-[14px] font-medium text-charcoal underline-offset-2 hover:underline">Show all {contractors.length}</summary>
              <ul aria-label={`More contractors in ${label}`}>
                {rest.map((c) => (
                  <Row key={c.id} c={c} today={today} canWrite={canWrite} returnTo={returnTo} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      <div className="min-h-4 flex-1" aria-hidden="true" />
      {trade ? (
        <div className="mt-auto flex flex-wrap gap-2 border-t border-line pt-4">
          {canWrite && trade.isActive ? (
            <LinkButton href={`${HQ_ROUTES.partnerNew}?trade=${encodeURIComponent(trade.slug)}`} size="sm" icon="plus">
              Add contractor
            </LinkButton>
          ) : null}
          {counts.total > 0 ? (
            <LinkButton href={`${HQ_ROUTES.partners}?trade=${encodeURIComponent(trade.slug)}`} size="sm" variant="ghost">
              Open in directory
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
