import Link from "next/link";
import { INTERACTION_LABEL, type InteractionType } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import { agoLabel, followUpState, formatDay } from "@/lib/hq/growth/dates";
import type { InteractionItem } from "@/lib/hq/growth/types";
import type { IconName } from "../../icons";
import { StatusChip } from "../../StatusChip";
import { Timeline, TimelineItem } from "../../Timeline";

/*
 * The relationship timeline: interactions newest first, each with its type icon, who and when
 * (relative and exact), the summary, the next action and any follow-up. Server-rendered.
 */

const ICON: Record<InteractionType, IconName> = {
  phone_call: "phone",
  coffee_meeting: "coffee",
  office_meeting: "calendar",
  email: "mail",
  message: "message",
  note: "note",
};

export function InteractionTimeline({
  items,
  timezone,
  today,
  label,
  /** Name the contact on each entry (for an organisation's combined history). */
  showContact,
}: {
  items: readonly InteractionItem[];
  timezone: string;
  today: string;
  label: string;
  showContact?: boolean;
}) {
  return (
    <Timeline label={label}>
      {items.map((i) => {
        const ago = agoLabel(i.occurredAt, timezone);
        const exact = formatDateTime(i.occurredAt, timezone);
        const state = followUpState(i.followUpDate, today);
        const meta = (
          <>
            <time dateTime={i.occurredAt} title={exact}>
              {ago ? `${ago}, ${exact}` : exact}
            </time>
            {i.staffName ? ` · ${i.staffName}` : ""}
            {showContact && i.contactName && i.contactId ? (
              <>
                {" · "}
                <Link href={`/hq/growth/contacts/${i.contactId}`} className="underline underline-offset-2">
                  {i.contactName}
                </Link>
              </>
            ) : null}
          </>
        );
        const hasFooter = Boolean(i.followUpDate) || Boolean(i.taskId);
        return (
          <TimelineItem
            key={i.id}
            icon={ICON[i.type]}
            title={INTERACTION_LABEL[i.type]}
            meta={meta}
            footer={
              hasFooter ? (
                <span className="flex flex-wrap items-center gap-2">
                  {i.followUpDate ? (
                    <StatusChip tone={state.kind === "overdue" ? "neutral" : "warning"}>
                      {state.kind === "overdue" ? "Follow-up was set for" : "Follow-up"} {formatDay(i.followUpDate, today)}
                    </StatusChip>
                  ) : null}
                  {i.taskId ? (
                    <Link href={`/hq/operations/tasks/${i.taskId}`} className="text-[13px] underline underline-offset-2">
                      Follow-up task
                    </Link>
                  ) : null}
                </span>
              ) : undefined
            }
          >
            <span className="block whitespace-pre-line">{i.summary}</span>
            {i.nextAction ? (
              <span className="mt-1 block">
                <span className="font-medium">Next: </span>
                {i.nextAction}
              </span>
            ) : null}
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
