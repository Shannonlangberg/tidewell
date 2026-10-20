import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, formatDateTime, plural } from "@/lib/hq/format";
import { MEETING_TYPE_LABEL, durationLabel, summaryExcerpt, type MeetingType } from "@/lib/hq/meetings/rules";
import type { MeetingRow, OpenAction } from "@/lib/hq/meetings/queries";
import { overdueText } from "@/lib/hq/today";
import { DataTable, ResponsiveTable, type Column } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { StatusChip } from "../../StatusChip";
import { SubmitButton } from "../../SubmitButton";
import { completeTaskAction } from "../dashboard/actions";

/*
 * Small pieces of Meetings: the kind of meeting (a plain tag), the confidential marker (dot plus
 * label), the "This week" summary cards (hairline-separated, no boxes), the open-actions rows with the
 * existing quick-complete Done button, and the full list (a table from 768px, one item per meeting
 * below). Server-rendered; the only interaction is the Done form.
 */

export const meetingHref = (id: string) => `/hq/meetings/${id}`;

export function MeetingTypeTag({ type }: { type: MeetingType }) {
  return <StatusChip plain>{MEETING_TYPE_LABEL[type]}</StatusChip>;
}

export function ConfidentialChip() {
  return (
    <StatusChip tone="warning" title="Only its team attendees, the person who saved it, and directors and administrators can see it.">
      Confidential
    </StatusChip>
  );
}

/** "Tue 20 Oct, 9:30 am · 45 min · Coffee at Kadina" */
export function whenLine(m: Pick<MeetingRow, "heldAt" | "durationMinutes" | "location">, timezone: string): string {
  return [formatDateTime(m.heldAt, timezone), durationLabel(m.durationMinutes), m.location].filter(Boolean).join(" · ");
}

/** The "This week" cards: date, title, kind, who, the 2-3 line summary, open actions. */
export function WeekCards({ rows, timezone }: { rows: readonly MeetingRow[]; timezone: string }) {
  return (
    <ul className="hq-mtg-week" aria-label="Meetings in the last 7 days">
      {rows.map((m) => (
        <li key={m.id} className="hq-mtg-card">
          <p className="hq-mtg-card__when">
            <time dateTime={m.heldAt}>{formatDateTime(m.heldAt, timezone)}</time>
            {m.location ? <span> · {m.location}</span> : null}
          </p>
          <h3 className="hq-mtg-card__title">
            <Link href={meetingHref(m.id)} className="hq-today__link">
              {m.title}
            </Link>
          </h3>
          <p className="hq-mtg-card__tags">
            <MeetingTypeTag type={m.type} />
            {m.confidential ? <ConfidentialChip /> : null}
          </p>
          {m.attendeeNames ? <p className="hq-mtg-card__who">With {m.attendeeNames}</p> : null}
          {m.summary ? <p className="hq-mtg-card__summary">{summaryExcerpt(m.summary, 260)}</p> : null}
          {m.openActions > 0 ? (
            <p className="hq-mtg-card__foot">
              <Link href={`${meetingHref(m.id)}#actions`} className="hq-today__inline">
                {plural(m.openActions, "open action")}
              </Link>
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Open actions from meetings: the task, who has it, when it is due (overdue marked), the meeting, Done. */
export function OpenActionRows({ rows, today, canComplete, returnTo }: { rows: readonly OpenAction[]; today: string; canComplete: boolean; returnTo: string }) {
  return (
    <ul className="hq-today__list" aria-label="Open actions from meetings">
      {rows.map((a) => {
        const late = a.dueDate ? overdueText(a.dueDate, today) : null;
        return (
          <li key={a.taskId} className="hq-today__row">
            <div className="hq-today__main">
              <p className="hq-today__name">
                <Link href={`/hq/operations/tasks/${a.taskId}`} className="hq-today__link">
                  {a.title}
                </Link>
              </p>
              <p className="hq-today__sub">
                {a.assigneeName ?? "Unassigned"}
                {a.dueDate ? (
                  <>
                    {" · "}
                    {late ? <span className="hq-today__late">{late}</span> : <>due {formatDate(a.dueDate)}</>}
                  </>
                ) : null}
                {" · "}
                <Link href={meetingHref(a.meetingId)} className="hq-today__inline">
                  {a.meetingRef}
                </Link>{" "}
                {a.meetingTitle}
              </p>
            </div>
            {canComplete ? (
              <div className="hq-today__actions">
                <form action={completeTaskAction}>
                  <input type="hidden" name="taskId" value={a.taskId} />
                  <input type="hidden" name="next" value={returnTo} />
                  <SubmitButton size="sm" variant="secondary" icon="check" className="hq-today__btn" pendingLabel="Completing" aria-label={`Mark done: ${a.title}`}>
                    Done
                  </SubmitButton>
                </form>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function MeetingsTable({ rows, caption, empty, timezone }: { rows: readonly MeetingRow[]; caption: string; empty: ReactNode; timezone: string }) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<MeetingRow>[] = [
    { key: "when", header: "When", nowrap: true, width: "9.5rem", cell: (m) => <time dateTime={m.heldAt}>{formatDate(m.heldAt, timezone)}</time> },
    {
      key: "title",
      header: "Meeting",
      primary: true,
      cell: (m) => (
        <>
          <Link href={meetingHref(m.id)}>{m.title}</Link>
          {m.summary ? <span className="hq-cell-sub">{summaryExcerpt(m.summary, 140, 2)}</span> : null}
        </>
      ),
    },
    { key: "type", header: "Kind", nowrap: true, hideBelow: "lg", cell: (m) => (m.confidential ? <ConfidentialChip /> : <MeetingTypeTag type={m.type} />) },
    { key: "who", header: "With", hideBelow: "lg", cell: (m) => (m.attendeeNames ? <span className="text-[13px]">{m.attendeeNames}</span> : <span className="hq-cell-nil">Not recorded</span>) },
    { key: "actions", header: "Open actions", nowrap: true, cell: (m) => (m.openActions > 0 ? <span className="hq-nums">{m.openActions}</span> : <span className="hq-cell-nil">None</span>) },
    { key: "ref", header: "Ref", nowrap: true, hideBelow: "lg", cell: (m) => <span className="tabular-nums text-grey-text">{m.ref}</span> },
  ];

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(m) => m.id} />}
      list={
        <MobileList label="Meetings">
          {rows.map((m) => (
            <li key={m.id} className="hq-mitem relative">
              <div className="hq-mitem__link">
                <Link href={meetingHref(m.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                  {m.title}
                </Link>
                <span className="hq-mitem__sub">
                  {formatDate(m.heldAt, timezone)}
                  {m.attendeeNames ? <> &middot; {m.attendeeNames}</> : null}
                </span>
                <span className="hq-mitem__row">
                  {m.confidential ? <ConfidentialChip /> : <MeetingTypeTag type={m.type} />}
                  <span className="hq-mitem__meta shrink-0 whitespace-nowrap">{m.openActions > 0 ? plural(m.openActions, "open action") : m.ref}</span>
                </span>
              </div>
            </li>
          ))}
        </MobileList>
      }
    />
  );
}

/** A compact list of meetings for a record's page (contact, organisation, lead, contractor). */
export function MeetingMiniList({ rows, timezone }: { rows: readonly MeetingRow[]; timezone: string }) {
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((m) => (
        <li key={m.id} className="border-b border-line py-2.5 text-[14px]">
          <Link href={meetingHref(m.id)}>{m.title}</Link>
          <span className="hq-muted block text-[13px]">
            {formatDate(m.heldAt, timezone)}
            {m.confidential ? " · confidential" : ""}
            {m.openActions > 0 ? ` · ${plural(m.openActions, "open action")}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
