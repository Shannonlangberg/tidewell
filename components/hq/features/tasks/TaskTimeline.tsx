import { formatDateTime } from "@/lib/hq/format";
import type { ActivityEvent, ActivityKind } from "@/lib/hq/tasks/activity";
import type { IconName } from "../../icons";
import { Timeline, TimelineItem } from "../../Timeline";

/*
 * The activity timeline on a task's page. The events come from lib/hq/tasks/activity.ts,
 * built only from what this person is allowed to read; this just draws them.
 */

const ICON: Record<ActivityKind, IconName> = {
  created: "plus",
  status: "task",
  completed: "check",
  reopened: "task",
  cancelled: "close",
  reassigned: "user",
  priority: "alert",
  due: "calendar",
  title: "note",
  description: "note",
  linked: "link",
  archived: "inbox",
  restored: "inbox",
  updated: "clock",
};

export function TaskTimeline({ events, timezone }: { events: readonly ActivityEvent[]; timezone: string }) {
  return (
    <Timeline label="Task activity">
      {events.map((e) => (
        <TimelineItem
          key={e.key}
          icon={ICON[e.kind]}
          title={e.title}
          meta={
            <>
              <time dateTime={e.at}>{formatDateTime(e.at, timezone)}</time>
              {e.actor ? <> &middot; {e.actor}</> : null}
            </>
          }
        >
          {e.detail}
        </TimelineItem>
      ))}
    </Timeline>
  );
}
