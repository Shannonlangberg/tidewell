import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { SectionLabel } from "@/components/hq/Primitives";
import { Timeline, TimelineItem } from "@/components/hq/Timeline";
import type { IconName } from "@/components/hq/icons";
import { requireStaff } from "@/lib/hq/auth";
import { formatDateTime } from "@/lib/hq/format";
import { loadTimeline, type TimelineEvent } from "@/lib/hq/contractors/timeline-queries";

/*
 * The timeline section: what has happened to this contractor, newest first. Built in SQL
 * (hq.contractor_timeline) from the underlying tables, so what a person sees is limited by their own
 * access: it is not the audit log. The one-line summary of each event is written in plain English by
 * the database; this only chooses an icon and lays it out.
 */

const CONTACT_ICON: Record<string, IconName> = {
  phone_call: "phone",
  email: "mail",
  message: "message",
  coffee_meeting: "coffee",
  office_meeting: "coffee",
  note: "note",
};

export function timelineIcon(e: Pick<TimelineEvent, "kind" | "interactionType">): IconName {
  switch (e.kind) {
    case "status_change":
      return "partners";
    case "vetting_step":
    case "document_verified":
      return "check";
    case "document_uploaded":
      return "inbox";
    case "document_rejected":
      return "alert";
    case "review":
      return "task";
    case "contact":
      return CONTACT_ICON[e.interactionType ?? ""] ?? "phone";
    default:
      return "clock";
  }
}

export async function TimelineSection({ contractorId }: { contractorId: string }) {
  const { staff } = await requireStaff("contractors.read");

  let data: Awaited<ReturnType<typeof loadTimeline>>;
  try {
    data = await loadTimeline(contractorId);
  } catch (e) {
    console.error("[hq] contractor timeline failed:", e instanceof Error ? e.message : "error");
    return (
      <section aria-labelledby="timeline-h">
        <SectionLabel as="h2" id="timeline-h" className="mb-5 border-b border-line pb-3.5">
          Timeline
        </SectionLabel>
        <ErrorState title="We could not load the timeline" />
      </section>
    );
  }

  return (
    <section aria-labelledby="timeline-h">
      <SectionLabel as="h2" id="timeline-h" className="mb-5 border-b border-line pb-3.5">
        Timeline
      </SectionLabel>
      {data.events.length === 0 ? (
        <EmptyState compact title="Nothing has happened yet">
          Status changes, checklist steps, documents, feedback and logged contacts appear here as they happen.
        </EmptyState>
      ) : (
        <>
          <Timeline label="Contractor history, newest first">
            {data.events.map((e) => (
              <TimelineItem key={e.key} icon={timelineIcon(e)} title={e.summary} meta={[formatDateTime(e.occurredAt, staff.timezone), e.actorName].filter(Boolean).join(" · ")}>
                {e.detail ? <span className="whitespace-pre-line">{e.detail}</span> : null}
              </TimelineItem>
            ))}
          </Timeline>
          {data.total > data.events.length ? <p className="hq-muted mt-6 text-[13px]">Showing the latest {data.events.length} of {data.total} events.</p> : null}
        </>
      )}
    </section>
  );
}
