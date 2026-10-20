import { formatDateTime } from "@/lib/hq/format";
import { ackChip, type AckStatus } from "@/lib/hq/enquiry-rules";
import { StatusChip } from "../../StatusChip";

/*
 * "Thank-you sent" / "Thank-you not sent", with when: whether the automatic thank-you email reached the
 * email service for this website enquiry (hq.begin_enquiry_auto_reply / finish_enquiry_auto_reply,
 * 0136). Dot plus label, never colour alone; the reason it was not sent is in the title and, with
 * `detail`, written out. Nothing is rendered when no thank-you was attempted.
 */
export function AckChip({
  status,
  at,
  reason,
  timezone,
  detail = false,
}: {
  status: AckStatus;
  at: string | null;
  reason: string | null;
  timezone: string;
  /** Write the time and the reason out next to the chip (the enquiry page); otherwise they are in the title. */
  detail?: boolean;
}) {
  const chip = ackChip(status, reason);
  if (!chip) return null;
  const when = at ? formatDateTime(at, timezone) : null;
  const title = [when, chip.detail].filter(Boolean).join(" · ") || undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusChip tone={chip.tone} title={title}>
        {chip.label}
      </StatusChip>
      {detail ? (
        <span className="hq-muted text-[13px] font-normal">
          {when ? <time dateTime={at ?? undefined}>{when}</time> : null}
          {chip.detail ? <>{when ? " · " : ""}{chip.detail}</> : null}
        </span>
      ) : when ? (
        <time dateTime={at ?? undefined} className="hq-cell-sub">
          {when}
        </time>
      ) : null}
    </span>
  );
}
