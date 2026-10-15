import {
  CONTRACTOR_EXPIRY_STATE_LABEL,
  CONTRACTOR_EXPIRY_STATE_TONE,
  CONTRACTOR_STATUS_LABEL,
  CONTRACTOR_STATUS_TONE,
  type ContractorExpiryState,
  type ContractorStatus,
} from "@/lib/hq/constants";
import { formatDate } from "@/lib/hq/format";
import { clearedButExpired, ratingText, type Contractor } from "@/lib/hq/contractors/types";
import { lastUsedText } from "@/lib/hq/trades/rules";
import { StatusChip } from "../../StatusChip";

/*
 * Small server-safe pieces shared by the contractor directory and profile. Status is always a
 * dot AND words (StatusChip), never colour alone, and an unknown value says so in words.
 */

export function ContractorStatusChip({ status, className }: { status: ContractorStatus; className?: string }) {
  return (
    <StatusChip tone={CONTRACTOR_STATUS_TONE[status]} className={className}>
      {CONTRACTOR_STATUS_LABEL[status]}
    </StatusChip>
  );
}

/** One chip per trade (no dot, its current label from hq.trades), the first `max` and then "+n". */
export function TradeTags({ labels, max }: { labels: readonly string[]; max?: number }) {
  if (labels.length === 0) return <span className="hq-cell-nil">Not recorded</span>;
  const shown = max ? labels.slice(0, max) : labels;
  const rest = labels.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((label, i) => (
        <StatusChip key={`${i}-${label}`} plain>
          {label}
        </StatusChip>
      ))}
      {rest > 0 ? <StatusChip plain>+{rest}</StatusChip> : null}
    </span>
  );
}

/** "Moonta, Moonta Bay +2", or "Not recorded" (an empty list is unknown, not "everywhere"). */
export function areasText(suburbs: readonly string[], regions: readonly string[], max = 3): string | null {
  const places = suburbs.length > 0 ? suburbs : regions;
  if (places.length === 0) return null;
  const shown = places.slice(0, max).join(", ");
  return places.length > max ? `${shown} +${places.length - max}` : shown;
}

export function ServiceAreas({ suburbs, regions, max = 3 }: { suburbs: readonly string[]; regions: readonly string[]; max?: number }) {
  const text = areasText(suburbs, regions, max);
  if (!text) return <span className="hq-cell-nil">Not recorded</span>;
  const all = [...suburbs, ...regions].join(", ");
  return <span title={all}>{text}</span>;
}

/** Insurance or licence: the state as a chip, with the expiry date beneath it when there is one. */
export function ExpiryCell({ state, expiresOn, daysRemaining }: { state: ContractorExpiryState; expiresOn: string | null; daysRemaining: number | null }) {
  if (state === "not_recorded") return <span className="hq-cell-nil">Not recorded</span>;
  return (
    <>
      <StatusChip tone={CONTRACTOR_EXPIRY_STATE_TONE[state]}>{CONTRACTOR_EXPIRY_STATE_LABEL[state]}</StatusChip>
      {expiresOn ? (
        <span className="hq-cell-sub">
          {daysRemaining !== null && daysRemaining < 0 ? "Expired " : "Expires "}
          {formatDate(expiresOn)}
        </span>
      ) : (
        <span className="hq-cell-sub">No expiry date recorded</span>
      )}
    </>
  );
}

/** The rating, or the rule that says why there is none yet. Never a placeholder star. */
export function RatingCell({ contractor }: { contractor: Pick<Contractor, "rating" | "ratedReviewCount" | "ratingThreshold"> }) {
  if (contractor.rating === null) return <span className="hq-cell-nil block max-w-[9rem]">{ratingText(contractor)}</span>;
  return <span className="hq-nums">{ratingText(contractor)}</span>;
}

/** The loud flag for a contractor who is approved or preferred but whose paperwork has expired. Null otherwise. */
export function ClearedButExpired({ contractor }: { contractor: Pick<Contractor, "status" | "insuranceState" | "licenceState"> }) {
  if (!clearedButExpired(contractor)) return null;
  const what = contractor.insuranceState === "expired" && contractor.licenceState === "expired" ? "insurance and licence expired" : contractor.insuranceState === "expired" ? "insurance expired" : "licence expired";
  return <StatusChip tone="error">{`Cleared, but ${what}`}</StatusChip>;
}

/**
 * "Last used 12 Oct 2026 (3 days ago)" or "Never recorded". The date is recorded by staff (HQ is not
 * connected to Ailo), so it is only as current as the last "Record a job".
 */
export function LastUsed({ date, today, className }: { date: string | null; today: string; className?: string }) {
  if (!date) return <span className={className ?? "hq-cell-nil"}>Never recorded</span>;
  return <span className={className}>{lastUsedText(date, today)}</span>;
}
