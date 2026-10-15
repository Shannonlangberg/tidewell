import { STAGE_LABEL } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import type { StageHistoryItem } from "@/lib/hq/referrals/types";
import type { IconName } from "../../icons";
import { Timeline, TimelineItem } from "../../Timeline";

/*
 * The stage history of a prospect: every change, newest first, with who made it, when, and the
 * note they left. The database writes it (a trigger) and it can never be edited or deleted, so
 * this is the evidence that a management was signed once.
 */

function iconFor(item: StageHistoryItem): IconName {
  if (item.fromStage === null) return "inbox";
  if (item.toStage === "management_signed") return "check";
  if (item.toStage === "lost") return "close";
  return "chevron-right";
}

export function StageHistory({ items, timezone }: { items: readonly StageHistoryItem[]; timezone: string }) {
  if (items.length === 0) {
    return <p className="hq-muted text-[14px]">No stage changes have been recorded for this prospect.</p>;
  }
  return (
    <Timeline label="Stage history, newest first">
      {items.map((h) => {
        const by = h.changedByName ? ` · ${h.changedByName}` : "";
        return (
          <TimelineItem
            key={h.id}
            icon={iconFor(h)}
            title={h.fromStage === null ? `Entered the pipeline at ${STAGE_LABEL[h.toStage]}` : `Moved to ${STAGE_LABEL[h.toStage]}`}
            meta={
              <>
                <time dateTime={h.changedAt}>{formatDateTime(h.changedAt, timezone)}</time>
                {by}
              </>
            }
          >
            {h.fromStage ? <p className="hq-muted text-[13px]">From {STAGE_LABEL[h.fromStage]}</p> : null}
            {h.note ? <p>{h.note}</p> : null}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
