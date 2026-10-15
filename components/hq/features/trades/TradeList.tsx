import Link from "next/link";
import type { ContractorExpiryState } from "@/lib/hq/constants";
import type { Contractor } from "@/lib/hq/contractors/types";
import { listText, missingDetails, tradeCountsText, usedAgoText, type TradeContainer as Container } from "@/lib/hq/trades/rules";
import { LinkButton } from "../../Button";
import { Icon } from "../../icons";
import { HQ_ROUTES } from "../../nav";
import { StatusChip } from "../../StatusChip";
import { ContractorStatusChip } from "../contractors/Bits";
import { RecordJobButton } from "../contractors/RecordJob";

/*
 * The compact Trades list (docs/hq-simple-layouts.md, change 4). One row per trade: its name, the
 * contractors in words, when anyone in it was last used, and a small "No approved contractor" marker.
 * Each row opens (native <details>, no script) to its contractors, one line each: name, status, a
 * Call button when a phone is recorded, "Used 3 days ago" when known, one "Details missing" marker,
 * and "Record a job". Trades with nobody in them fold into one "No contractors yet (n)" row.
 *
 * Only what differs is shown on a row: a status every contractor in the trade shares is left to the
 * trade's counts, and details nobody has recorded are said once above the list (`sharedMissing`).
 * Server-rendered; "Record a job" is the only client part. `suppressHydrationWarning` on <details>:
 * the browser may already have opened one for a #trade-<slug> link before React hydrates.
 */

type Props = {
  today: string;
  canWrite: boolean;
  returnTo: string;
};

const PAPER_LABEL: Partial<Record<ContractorExpiryState, string>> = { expired: "expired", expiring_soon: "expiring soon" };

function PaperChip({ what, state }: { what: string; state: ContractorExpiryState }) {
  const label = PAPER_LABEL[state];
  if (!label) return null;
  return <StatusChip tone={state === "expired" ? "error" : "warning"}>{`${what} ${label}`}</StatusChip>;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function ContractorRow({
  c,
  showStatus,
  sharedMissing,
  today,
  canWrite,
  returnTo,
}: Props & { c: Contractor; showStatus: boolean; sharedMissing: ReadonlySet<string> }) {
  const used = usedAgoText(c.lastJobDate, today);
  const missing = missingDetails(c).filter((m) => !sharedMissing.has(m));
  const phone = c.phone?.trim() || null;
  return (
    <li className={phone ? "hq-trade-person hq-trade-person--call" : "hq-trade-person"}>
      <div className="hq-trade-person__main">
        <Link href={`${HQ_ROUTES.partners}/${c.id}`} className="hq-trade-person__name">
          {c.businessName}
        </Link>
        <span className="hq-trade-person__meta">
          {showStatus ? <ContractorStatusChip status={c.status} /> : null}
          <PaperChip what="Insurance" state={c.insuranceState} />
          <PaperChip what="Licence" state={c.licenceState} />
          {missing.length > 0 ? (
            <span className="hq-trade-missing" title={`Not recorded: ${listText(missing)}`}>
              Details missing<span className="sr-only">: {listText(missing)}</span>
            </span>
          ) : null}
          {used ? <span className="hq-trade-person__used">{used}</span> : null}
        </span>
      </div>
      {phone || canWrite ? (
        <div className="hq-trade-person__actions">
          {phone ? (
            <LinkButton href={telHref(phone)} size="sm" icon="phone" aria-label={`Call ${c.businessName} on ${phone}`}>
              {`Call ${phone}`}
            </LinkButton>
          ) : null}
          {canWrite ? <RecordJobButton contractorId={c.id} businessName={c.businessName} lastJobDate={c.lastJobDate} today={today} returnTo={returnTo} variant="secondary" /> : null}
        </div>
      ) : null}
    </li>
  );
}

export function TradeRow({
  container,
  markUncovered,
  sharedMissing,
  today,
  canWrite,
  returnTo,
}: Props & { container: Container<Contractor>; markUncovered: boolean; sharedMissing: ReadonlySet<string> }) {
  const { trade, contractors, counts, lastUsed } = container;
  const label = trade?.label ?? "Trades not on the list";
  const slug = trade?.slug ?? "unknown";
  const used = usedAgoText(lastUsed, today);
  const oneStatus = contractors.every((c) => c.status === contractors[0]?.status);
  const marker = !trade ? (
    <StatusChip tone="warning">Choose a current trade</StatusChip>
  ) : !trade.isActive ? (
    <StatusChip>Archived trade</StatusChip>
  ) : markUncovered && counts.cleared === 0 && trade.slug !== "other" ? (
    <StatusChip tone="warning">No approved contractor</StatusChip>
  ) : null;

  return (
    <details id={`trade-${slug}`} className="hq-trade" suppressHydrationWarning>
      <summary className="hq-trade__summary">
        <Icon name="chevron-right" size={18} className="hq-trade__chevron" />
        <span className="hq-trade__cols">
          <span className="hq-trade__name">{label}</span>
          <span className="hq-trade__counts">
            {tradeCountsText(counts)}
            {used ? <span className="hq-trade__used-inline">{` · ${used}`}</span> : null}
          </span>
          <span className="hq-trade__used">{used ?? ""}</span>
          <span className="hq-trade__marker">{marker}</span>
        </span>
      </summary>
      <div className="hq-trade__body">
        {!trade ? <p className="mb-2 text-[14px] text-grey-text">These contractors carry a trade that is no longer on the list. Open one and choose a current trade.</p> : null}
        <ul aria-label={`Contractors in ${label}`}>
          {contractors.map((c) => (
            <ContractorRow key={c.id} c={c} showStatus={!oneStatus} sharedMissing={sharedMissing} today={today} canWrite={canWrite} returnTo={returnTo} />
          ))}
        </ul>
        {trade ? (
          <p className="hq-trade__links">
            {canWrite && trade.isActive ? (
              <Link href={`${HQ_ROUTES.partnerNew}?trade=${encodeURIComponent(trade.slug)}`}>Add a contractor to {label}</Link>
            ) : null}
            <Link href={`${HQ_ROUTES.partners}?trade=${encodeURIComponent(trade.slug)}`}>Open in directory</Link>
          </p>
        ) : null}
      </div>
    </details>
  );
}

/** Every active trade nobody is in yet, folded into one quiet row. */
export function EmptyTrades({ trades, canWrite }: { trades: ReadonlyArray<{ id: string; slug: string; label: string }>; canWrite: boolean }) {
  if (trades.length === 0) return null;
  return (
    <details id="trades-empty" className="hq-trade hq-trade--empty" suppressHydrationWarning>
      <summary className="hq-trade__summary">
        <Icon name="chevron-right" size={18} className="hq-trade__chevron" />
        <span className="hq-trade__cols">
          <span className="hq-trade__name">No contractors yet ({trades.length})</span>
        </span>
      </summary>
      <div className="hq-trade__body">
        {canWrite ? <p className="mb-2 text-[14px] text-grey-text">Choose a trade to add its first contractor.</p> : null}
        <ul className="hq-trade-empty-list" aria-label="Trades with no contractors yet">
          {trades.map((t) => (
            <li key={t.id} id={`trade-${t.slug}`}>
              {canWrite ? (
                <Link href={`${HQ_ROUTES.partnerNew}?trade=${encodeURIComponent(t.slug)}`} aria-label={`Add a contractor to ${t.label}`}>
                  {t.label}
                </Link>
              ) : (
                <span>{t.label}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
