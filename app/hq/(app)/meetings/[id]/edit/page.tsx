import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { addDays, localParts } from "@/lib/hq/meetings/rules";
import { getMeeting } from "@/lib/hq/meetings/queries";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { MeetingForm } from "@/components/hq/features/meetings/MeetingForm";
import { updateMeeting } from "../../actions";

export const metadata: Metadata = { title: "Edit meeting" };

type Params = Promise<{ id: string }>;

export default async function EditMeetingPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("meetings.write", false, isUuid(id) ? `/hq/meetings/${id}/edit` : "/hq/meetings");
  if (!isUuid(id)) notFound();
  const found = await getMeeting(db, id, { historyLimit: 1 });
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit meeting" breadcrumbs={[{ label: "Meetings", href: "/hq/meetings" }, { label: "Edit" }]} />
        <ErrorState title="We could not load this meeting" action={<LinkButton href={`/hq/meetings/${id}/edit`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data || found.data.meeting.archived) notFound();
  const m = found.data.meeting;
  const when = localParts(m.heldAt, staff.timezone);
  const today = todayIn(staff.timezone);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Meetings", href: "/hq/meetings" }, { label: m.ref, href: `/hq/meetings/${m.id}` }, { label: "Edit" }]}
        eyebrow={m.ref}
        title="Edit meeting"
        description="Every save is a new version: the earlier summary and minutes stay in the meeting's history."
      />
      <MeetingForm
        mode="edit"
        action={updateMeeting}
        meetingId={m.id}
        version={m.version}
        initial={{
          title: m.title,
          meetingType: m.type,
          heldDate: when.date,
          heldTime: when.time,
          durationMinutes: m.durationMinutes ? String(m.durationMinutes) : "",
          location: m.location ?? "",
          summary: m.summary ?? "",
          minutes: m.minutes ?? "",
          decisionsText: m.decisionsText ?? "",
          confidential: m.confidential,
        }}
        options={{ staff: [], contacts: [], organisations: [], leads: [], contractors: [] }}
        meStaffId={staff.id}
        canTasks={can("tasks.write")}
        canChangeConfidential={m.createdBy === staff.id || can("audit.read")}
        maxDate={addDays(today, 1)}
        cancelHref={`/hq/meetings/${m.id}`}
      />
    </>
  );
}
