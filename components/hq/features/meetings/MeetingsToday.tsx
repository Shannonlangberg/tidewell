import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { sinceDaysIso } from "@/lib/hq/meetings/rules";
import { recentMeetings } from "@/lib/hq/meetings/queries";

/*
 * One quiet line on Today for people who can read meetings (meetings.read): how many meetings were
 * saved in the last seven days and the latest one, linking to Meetings. Read as the person, so a
 * confidential meeting they may not see is neither counted nor named. Nothing is shown when there
 * were none.
 */
export async function MeetingsToday() {
  const { db, staff, can } = await requireStaff();
  if (!can("meetings.read")) return null;
  const today = todayIn(staff.timezone);
  const since = sinceDaysIso(today, 7, staff.timezone);
  const loaded = await recentMeetings(db, since, 1);
  if (!loaded.ok) return <p className="hq-today__quiet">Recent meetings: this could not be loaded just now. Reload the page to try again.</p>;
  const { rows, total } = loaded.data;
  if (total === 0 || !rows[0]) return null;
  const last = rows[0];
  return (
    <p className="hq-today__quiet" id="recent-meetings">
      Recent meetings:{" "}
      <Link href="/hq/meetings" className="hq-today__inline">
        {total === 1 ? "1 this week" : `${total} this week`}
      </Link>
      , the latest{" "}
      <Link href={`/hq/meetings/${last.id}`} className="hq-today__inline">
        {last.title}
      </Link>
      {last.openActions > 0 ? ` (${last.openActions === 1 ? "1 open action" : `${last.openActions} open actions`})` : ""}.
    </p>
  );
}
