import Link from "next/link";
import type { CSSProperties } from "react";
import { formatDate } from "@/lib/hq/format";
import type { TimelineBar, TimelineModel } from "@/lib/hq/projects/timeline";

/*
 * The Timeline: months across, one lane per milestone (its marker a small diamond on its due date),
 * dated tasks as thin bars from when the work can start to when it is due, a clay line for today,
 * overdue work in the error tone, and "after X" when a task waits for another. Plain CSS positioned
 * by percentages from lib/hq/projects/timeline.ts. On a phone the same model is drawn as a stacked
 * list, lane by lane, with a "Today" marker in the order of dates.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""}`;

function barLabelStyle(b: TimelineBar): CSSProperties {
  // Near the right edge, the label runs back from the end of the bar so it stays on the chart.
  return b.left > 62 ? { right: `${Math.max(0, 100 - b.left - b.width)}%`, textAlign: "right" } : { left: `${b.left}%` };
}

export function ProjectTimeline({ model, today }: { model: TimelineModel; today: string }) {
  const hasBars = model.lanes.some((l) => l.bars.length > 0 || l.marker);
  if (!hasBars) {
    return (
      <p className="hq-prj-quiet mt-8">
        Nothing to draw yet. Give milestones and tasks due dates and they will appear here on a calendar.
        {model.undated.length > 0 ? ` ${model.undated.length === 1 ? "1 task has" : `${model.undated.length} tasks have`} no due date.` : ""}
      </p>
    );
  }
  return (
    <div className="hq-prj-tl">
      <figure className="hq-prj-tl__chart m-0" aria-label="Project timeline">
        <div className="hq-prj-tl__grid relative">
          <div aria-hidden="true" className="border-b border-charcoal" />
          <div className="hq-prj-tl__months" aria-hidden="true">
            {model.months.map((m) => (
              <span key={m.key} className="hq-prj-tl__month" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
                {m.label}
              </span>
            ))}
          </div>

          {model.lanes.map((lane) => (
            <Lane key={lane.key} lane={lane} />
          ))}

          <div className="hq-prj-tl__overlay" aria-hidden="true">
            {model.months.slice(1).map((m) => (
              <span key={m.key} className="absolute top-[34px] bottom-0 border-l border-line" style={{ left: `${m.left}%` }} />
            ))}
            {model.todayLeft !== null ? (
              <span className="hq-prj-tl__today" style={{ left: `${model.todayLeft}%` }}>
                <span>Today</span>
              </span>
            ) : null}
          </div>
        </div>
        <figcaption className="hq-prj-tl__legend">
          <span>
            <i className="hq-prj-tl__key" aria-hidden="true" /> Open task
          </span>
          <span>
            <i className="hq-prj-tl__key hq-prj-tl__key--late" aria-hidden="true" /> Overdue
          </span>
          <span>
            <i className="hq-prj-tl__key hq-prj-tl__key--done" aria-hidden="true" /> Done
          </span>
          <span>
            <i className="hq-prj-tl__key hq-prj-tl__key--ms" aria-hidden="true" /> Milestone
          </span>
          <span>
            <i className="hq-prj-tl__key hq-prj-tl__key--today" aria-hidden="true" /> Today, {formatDate(today)}
          </span>
        </figcaption>
      </figure>

      <Stacked model={model} today={today} />

      {model.undated.length > 0 ? (
        <p className="hq-prj-quiet mt-6">
          Not on the timeline (no due date):{" "}
          {model.undated.slice(0, 8).map((u, i) => (
            <span key={u.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/hq/operations/tasks/${u.id}`} className="underline underline-offset-4">
                {u.title}
              </Link>
            </span>
          ))}
          {model.undated.length > 8 ? ` and ${model.undated.length - 8} more` : ""}.
        </p>
      ) : null}
    </div>
  );
}

function Lane({ lane }: { lane: TimelineModel["lanes"][number] }) {
  const m = lane.marker;
  return (
    <>
      <div className="hq-prj-tl__lanelabel">
        <p>{lane.label}</p>
        {m ? <span className={m.overdue ? "hq-prj-late" : undefined}>{m.done ? `Done · ${short(m.due)}` : `${m.overdue ? "Was due" : "Due"} ${short(m.due)}`}</span> : lane.key === "none" ? null : <span>No due date</span>}
      </div>
      <div className="hq-prj-tl__track">
        {m ? <span className="hq-prj-tl__marker" style={{ left: `${m.left}%` }} data-done={m.done || undefined} data-late={m.overdue || undefined} title={`${lane.label}: ${formatDate(m.due)}`} /> : null}
        {lane.bars.length === 0 ? <div className="hq-prj-tl__bar" aria-hidden="true" /> : null}
        <ul className="m-0 list-none p-0">
          {lane.bars.map((b) => (
            <li key={b.id} className="hq-prj-tl__bar" data-done={b.done || undefined} data-late={b.overdue || undefined} data-status={b.status}>
              <Link href={`/hq/operations/tasks/${b.id}`} className="hq-prj-tl__label" style={barLabelStyle(b)}>
                {b.title}
                {b.afterLabel ? <span className="hq-prj-tl__after"> · {b.afterLabel.charAt(0).toLowerCase() + b.afterLabel.slice(1)}</span> : null}
                <span className="sr-only">
                  , {b.start === b.due ? `due ${formatDate(b.due)}` : `from ${formatDate(b.start)} to ${formatDate(b.due)}`}
                  {b.overdue ? ", overdue" : b.done ? ", done" : ""}
                </span>
              </Link>
              <span className="hq-prj-tl__fill" style={{ left: `${b.left}%`, width: `${b.width}%` }} aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Stacked({ model, today }: { model: TimelineModel; today: string }) {
  return (
    <div className="hq-prj-tl__stack">
      {model.lanes.map((lane) => {
        const bars = [...lane.bars].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
        const todayAt = bars.findIndex((b) => b.due >= today);
        return (
          <section key={lane.key} aria-label={lane.label}>
            <div className="hq-prj-st__head">
              <p>{lane.label}</p>
              {lane.marker ? <span className={lane.marker.overdue ? "hq-prj-late" : undefined}>{lane.marker.done ? "Done" : `${lane.marker.overdue ? "Was due" : "Due"} ${short(lane.marker.due)}`}</span> : null}
            </div>
            {bars.length === 0 ? (
              <p className="hq-prj-quiet py-3">No dated tasks.</p>
            ) : (
              <ol className="hq-prj-st__list">
                {bars.map((b, i) => (
                  <li key={b.id} className="contents">
                    {i === todayAt && todayAt > 0 ? <p className="hq-prj-st__today">Today</p> : null}
                    <div className="hq-prj-st__item" data-late={b.overdue || undefined} data-done={b.done || undefined}>
                      <Link href={`/hq/operations/tasks/${b.id}`}>{b.title}</Link>
                      <span className="hq-prj-st__when">
                        {b.start === b.due ? short(b.due) : `${short(b.start)} → ${short(b.due)}`}
                        {b.overdue ? " · overdue" : b.done ? " · done" : ""}
                        {b.afterLabel ? ` · ${b.afterLabel.charAt(0).toLowerCase()}${b.afterLabel.slice(1)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
