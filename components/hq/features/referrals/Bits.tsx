import Link from "next/link";
import { DIRECTION_LABEL, SENT_OUTCOME_LABEL, type OpportunityStage, type ReferralDirection, type SentOutcome } from "@/lib/hq/constants";
import { formatAud, formatDate } from "@/lib/hq/format";
import { HQ_ROUTES } from "../../nav";
import { StageChip, StatusChip, type StatusTone } from "../../StatusChip";

/*
 * Small pieces shared by the register, the detail page and the Growth overview. Server-safe: no
 * state. Meaning is always a dot AND a word (the chips do that), never colour alone.
 */

const ORGANISATIONS = "/hq/growth/organisations";
const CONTACTS = "/hq/growth/contacts";

export function DirectionChip({ direction }: { direction: ReferralDirection }) {
  return <StatusChip tone={direction === "received" ? "info" : "neutral"}>{DIRECTION_LABEL[direction]}</StatusChip>;
}

const OUTCOME_TONE: Record<SentOutcome, StatusTone> = {
  sent: "neutral",
  acknowledged: "info",
  converted: "success",
  no_outcome: "neutral",
};

/** `labelled` adds "Outcome:" so the chip is not read as a second "Sent" beside the direction. */
export function OutcomeChip({ outcome, labelled }: { outcome: SentOutcome; labelled?: boolean }) {
  return <StatusChip tone={OUTCOME_TONE[outcome]}>{labelled ? `Outcome: ${SENT_OUTCOME_LABEL[outcome]}` : SENT_OUTCOME_LABEL[outcome]}</StatusChip>;
}

/** Credited: the partner who gets the signed management. Not credited: a further claim on the same prospect. */
export function CreditChip({ isAttributed }: { isAttributed: boolean }) {
  return isAttributed ? (
    <StatusChip plain title="This partner is credited if the prospect signs">
      Credited
    </StatusChip>
  ) : (
    <StatusChip tone="warning" title="Another partner introduced this prospect first, so this referral is not credited">
      Not credited
    </StatusChip>
  );
}

/** The stage of a received referral, or the outcome of a sent one. */
export function StageOrOutcome({
  direction,
  stage,
  outcome,
  labelled,
}: {
  direction: ReferralDirection;
  stage: OpportunityStage | null;
  outcome: SentOutcome | null;
  labelled?: boolean;
}) {
  if (direction === "sent") return outcome ? <OutcomeChip outcome={outcome} labelled={labelled} /> : <Nil />;
  return stage ? <StageChip stage={stage} /> : <Nil />;
}

export function Nil({ children = "Not recorded" }: { children?: string }) {
  return <span className="hq-cell-nil">{children}</span>;
}

/** An em dash for a figure that does not apply or does not exist, with the reason for screen readers. */
export function Dash({ label, right }: { label: string; right?: boolean }) {
  return (
    <span className={right ? "hq-cell-nil block text-right" : "hq-cell-nil"}>
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The organisation (a link) with the person at it underneath, or whichever of the two there is. */
export function PartnerCell({
  organisationId,
  organisationName,
  contactId,
  contactName,
}: {
  organisationId: string | null;
  organisationName: string | null;
  contactId: string | null;
  contactName: string | null;
}) {
  const org = organisationId && organisationName ? <Link href={`${ORGANISATIONS}/${organisationId}`}>{organisationName}</Link> : null;
  const person = contactId && contactName ? <Link href={`${CONTACTS}/${contactId}`}>{contactName}</Link> : null;
  if (!org && !person) return <Nil>No partner</Nil>;
  return (
    <>
      {org ?? person}
      {org && person ? <span className="hq-cell-sub">{person}</span> : null}
    </>
  );
}

/** An estimate in dollars, or a quiet "No estimate". Always labelled as an estimate where it is read. */
export function EstimateText({ cents }: { cents: number | null }) {
  return cents === null ? <Dash label="No estimate" right /> : <span className="hq-nums block text-right">{formatAud(cents)}</span>;
}

export function SignedDate({ signedAt, timezone }: { signedAt: string | null; timezone: string }) {
  return signedAt ? <time dateTime={signedAt}>{formatDate(signedAt, timezone)}</time> : <Dash label="Not signed" />;
}

/** The text of a link to a record, for pages that build their own markup. */
export function referralHref(id: string): string {
  return `${HQ_ROUTES.referrals}/${id}`;
}
