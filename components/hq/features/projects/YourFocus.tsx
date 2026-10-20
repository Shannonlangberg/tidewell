import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { myFocus } from "@/lib/hq/projects/queries";

/*
 * Your Focus, first on Today for people who have tasks: the next three things to do, from
 * hq.my_focus (assigned to you, open, not blocked, not a parent whose subtasks are the work; overdue
 * first, then priority, due date, project priority, oldest), each with the database's short reason.
 * Quiet: numbered lines on hairlines, no box. One line when there is nothing, and nothing at all for
 * people who cannot hold tasks.
 */
export async function YourFocus() {
  const { db, can } = await requireStaff();
  if (!can("tasks.write")) return null;
  const loaded = await myFocus(db, 3);
  if (!loaded.ok) return <p className="hq-today__quiet mt-6">Your focus: this could not be loaded just now. Reload the page to try again.</p>;
  const items = loaded.data;
  return (
    <section className="hq-focus" aria-labelledby="your-focus-h">
      <h2 id="your-focus-h" className="hq-label hq-focus__label">
        Your focus
      </h2>
      {items.length === 0 ? (
        <p className="hq-today__quiet">Nothing needs you right now: your tasks are done, or waiting on something else.</p>
      ) : (
        <ol className="hq-focus__list">
          {items.map((f) => (
            <li key={f.taskId} className="hq-focus__item">
              <p className="hq-focus__title">
                <Link href={`/hq/operations/tasks/${f.taskId}`}>{f.title}</Link>
              </p>
              <p className="hq-focus__why">
                <Why text={f.why} />
                {f.projectName && f.projectId ? (
                  <>
                    {" · "}
                    <Link href={`/hq/projects/${f.projectId}`} className="hq-today__inline">
                      {f.projectName}
                    </Link>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The first reason is the one that matters most; it is set a shade stronger (and in the error tone when overdue). */
function Why({ text }: { text: string }) {
  const [lead, ...rest] = text.split("; ");
  return (
    <>
      <em className={/^Overdue/.test(lead) ? "hq-prj-late" : undefined}>{lead}</em>
      {rest.length > 0 ? ` · ${rest.join(" · ")}` : ""}
    </>
  );
}
