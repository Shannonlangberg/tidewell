import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { addDays, localParts } from "@/lib/hq/meetings/rules";
import { formOptions } from "@/lib/hq/meetings/form-options";
import { PageHeader } from "@/components/hq";
import { MeetingForm } from "@/components/hq/features/meetings/MeetingForm";
import { createMeeting } from "../actions";

export const metadata: Metadata = { title: "Record a meeting" };

export default async function NewMeetingPage() {
  // Recording needs meetings.write: anyone else who opens this URL is sent back out before anything loads.
  const { db, staff, can } = await requireStaff("meetings.write", false, "/hq/meetings/new");
  const today = todayIn(staff.timezone);
  const options = await formOptions(db, can);
  const now = localParts(new Date().toISOString(), staff.timezone);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Meetings", href: "/hq/meetings" }, { label: "Record a meeting" }]}
        title="Record a meeting"
        description="Type up a meeting yourself. The quicker way is in chat: tell ChatGPT or Claude about the meeting and ask it to save the minutes to Planted HQ."
      />
      <MeetingForm
        mode="create"
        action={createMeeting}
        initial={{ title: "", meetingType: "", heldDate: today, heldTime: now.time, durationMinutes: "", location: "", summary: "", minutes: "", decisionsText: "", confidential: false }}
        options={options}
        meStaffId={staff.id}
        canTasks={can("tasks.write")}
        canChangeConfidential
        maxDate={addDays(today, 1)}
        cancelHref="/hq/meetings"
      />
    </>
  );
}
