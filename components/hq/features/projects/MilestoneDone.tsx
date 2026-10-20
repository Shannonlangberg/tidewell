import type { Milestone } from "@/lib/hq/projects/types";

/*
 * Complete or reopen a milestone: plain forms posting to the setMilestoneDone Server Action, so they
 * work before any script loads. A milestone with open tasks is refused by the database unless it is
 * completed "anyway" with a note, so that choice sits behind a small disclosure that asks for one.
 */
export function MilestoneDone({
  projectId,
  milestone: m,
  openTasks,
  action,
  returnView,
  returnGroup,
}: {
  projectId: string;
  milestone: Milestone;
  openTasks: number;
  action: (formData: FormData) => Promise<void>;
  returnView?: "list" | "board" | "timeline";
  returnGroup?: string;
}) {
  const hidden = (
    <>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="milestone_id" value={m.id} />
      {returnView ? <input type="hidden" name="return_view" value={returnView} /> : null}
      {returnGroup ? <input type="hidden" name="return_group" value={returnGroup} /> : null}
    </>
  );
  if (m.status === "done") {
    return (
      <form action={action}>
        {hidden}
        <input type="hidden" name="done" value="0" />
        <button type="submit" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={`Reopen milestone ${m.name}`}>
          <span className="hq-btn__label">Reopen</span>
        </button>
      </form>
    );
  }
  if (openTasks === 0) {
    return (
      <form action={action}>
        {hidden}
        <input type="hidden" name="done" value="1" />
        <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm" aria-label={`Mark milestone ${m.name} done`}>
          <span className="hq-btn__label">Mark done</span>
        </button>
      </form>
    );
  }
  return (
    <details className="relative">
      <summary className="hq-btn hq-btn--ghost hq-btn--sm list-none" aria-label={`Mark milestone ${m.name} done`}>
        <span className="hq-btn__label">Mark done</span>
      </summary>
      <form action={action} className="hq-prj-inline-form absolute right-0 z-10 w-72 rounded-panel border border-line bg-white p-4" style={{ boxShadow: "var(--shadow-subtle)" }}>
        {hidden}
        <input type="hidden" name="done" value="1" />
        <input type="hidden" name="force" value="1" />
        <p className="m-0 text-[13.5px]">
          {openTasks === 1 ? "1 task here is still open." : `${openTasks} tasks here are still open.`} Say why it is done anyway.
        </p>
        <label className="sr-only" htmlFor={`ms-note-${m.id}`}>
          Why it is done
        </label>
        <input id={`ms-note-${m.id}`} name="note" className="hq-input" maxLength={300} required placeholder="For example: moved to the next stage" />
        <button type="submit" className="hq-btn hq-btn--primary hq-btn--sm justify-self-start">
          <span className="hq-btn__label">Complete anyway</span>
        </button>
      </form>
    </details>
  );
}
