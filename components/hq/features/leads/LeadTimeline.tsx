import Link from "next/link";
import { INTERACTION_LABEL, STAGE_LABEL, TASK_STATUS_LABEL, type InteractionType } from "@/lib/hq/constants";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { agoLabel } from "@/lib/hq/growth/dates";
import type { LeadEvent } from "@/lib/hq/leads/queries";
import type { AckStatus } from "@/lib/hq/enquiry-rules";
import { AckChip } from "../enquiries/AckChip";
import type { IconName } from "../../icons";
import { Timeline, TimelineItem } from "../../Timeline";

/*
 * A lead's timeline, newest first: the calls, meetings and notes logged on it, its stage changes
 * and the tasks made for it. Server-rendered from data the page has already loaded.
 * `ackMarks` puts the website thank-you chip ("Thank-you sent", with when) on a website enquiry's
 * message and on the automatic thank-you's own entry (the touch point).
 */

export type AckMarks = Record<string, { status: AckStatus; at: string | null; reason: string | null }>;

const ICON: Record<InteractionType, IconName> = {
  phone_call: "phone",
  coffee_meeting: "coffee",
  office_meeting: "calendar",
  email: "mail",
  message: "message",
  note: "note",
};

function When({ at, timezone }: { at: string; timezone: string }) {
  const ago = agoLabel(at, timezone);
  const exact = formatDateTime(at, timezone);
  return (
    <time dateTime={at} title={exact}>
      {ago ? `${ago}, ${exact}` : exact}
    </time>
  );
}

export function LeadTimeline({ events, timezone, label, ackMarks = {} }: { events: readonly LeadEvent[]; timezone: string; label: string; ackMarks?: AckMarks }) {
  return (
    <Timeline label={label}>
      {events.map((e) => {
        if (e.kind === "interaction") {
          const i = e.item;
          const ack = Object.hasOwn(ackMarks, i.id) ? ackMarks[i.id] : null;
          return (
            <TimelineItem
              key={`i-${i.id}`}
              icon={ICON[i.type]}
              title={INTERACTION_LABEL[i.type]}
              meta={
                <>
                  <When at={i.occurredAt} timezone={timezone} />
                  {i.staffName ? ` · ${i.staffName}` : ""}
                </>
              }
              footer={
                i.followUpDate || i.taskId || ack ? (
                  <span className="flex flex-wrap items-center gap-3 text-[13px]">
                    {ack ? <AckChip status={ack.status} at={ack.at} reason={ack.reason} timezone={timezone} detail /> : null}
                    {i.followUpDate ? <span>Follow up {formatDate(i.followUpDate, timezone)}</span> : null}
                    {i.taskId ? (
                      <Link href={`/hq/operations/tasks/${i.taskId}`} className="underline underline-offset-2">
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
        }
        if (e.kind === "stage") {
          const h = e.item;
          return (
            <TimelineItem
              key={`s-${h.id}`}
              icon="growth"
              title={h.fromStage ? `Moved to ${STAGE_LABEL[h.toStage]}` : `Added at ${STAGE_LABEL[h.toStage]}`}
              meta={
                <>
                  <When at={h.changedAt} timezone={timezone} />
                  {h.changedByName ? ` · ${h.changedByName}` : ""}
                </>
              }
            >
              {h.note ? <span className="block whitespace-pre-line">{h.note}</span> : null}
            </TimelineItem>
          );
        }
        const t = e.item;
        return (
          <TimelineItem
            key={`t-${t.id}`}
            icon="task"
            title={
              <Link href={`/hq/operations/tasks/${t.id}`} className="underline underline-offset-2">
                Task: {t.title}
              </Link>
            }
            meta={
              <>
                <When at={e.at} timezone={timezone} />
                {` · ${TASK_STATUS_LABEL[t.status]}`}
                {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                {t.dueDate ? ` · due ${formatDate(t.dueDate, timezone)}` : ""}
              </>
            }
          />
        );
      })}
    </Timeline>
  );
}
