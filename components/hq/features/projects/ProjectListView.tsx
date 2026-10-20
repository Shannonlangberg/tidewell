import Link from "next/link";
import { formatDate } from "@/lib/hq/format";
import { TASK_STATUS_WORD, checklistText, groupTasks, isOpenTask, type ListGrouping, type TaskGroup } from "@/lib/hq/projects/rules";
import type { Milestone, ProjectTask } from "@/lib/hq/projects/types";
import type { TaskActionResult } from "@/lib/hq/tasks/types";
import { QuickComplete } from "../tasks/QuickComplete";
import { AssigneeMini, DueMini, PriorityMini, StatusMini, type SetField } from "./TaskInline";
import { MilestoneDone } from "./MilestoneDone";

/*
 * The List view: tasks grouped by milestone (in the milestones' order, then "No milestone") or by
 * status, each subtask indented under its parent. People who may write tasks get the small inline
 * controls and an add-task row under each group; everyone else reads the same list as plain text.
 */

type Options = { value: string; label: string }[];

export function ProjectListView({
  projectId,
  tasks,
  allTasks,
  milestones,
  group,
  today,
  canWriteTasks,
  canWriteProject,
  staff,
  setStatus,
  setField,
  addTask,
  setMilestoneDone,
  filtered,
}: {
  projectId: string;
  /** The tasks after the filters. */
  tasks: ProjectTask[];
  /** Every task the person can see in the project (for counts under a milestone). */
  allTasks: ProjectTask[];
  milestones: Milestone[];
  group: ListGrouping;
  today: string;
  canWriteTasks: boolean;
  canWriteProject: boolean;
  staff: Options;
  setStatus: (id: string, to: string) => Promise<TaskActionResult>;
  setField: SetField;
  addTask: (formData: FormData) => Promise<void>;
  setMilestoneDone: (formData: FormData) => Promise<void>;
  filtered: boolean;
}) {
  const groups = groupTasks(tasks, milestones, group);
  if (groups.every((g) => g.rows.length === 0) && (filtered || group === "status")) {
    return <p className="hq-prj-quiet mt-8">{filtered ? "No tasks match those filters." : "No tasks yet."}</p>;
  }
  return (
    <div>
      {groups.map((g) => (
        <Group
          key={g.key}
          g={g}
          projectId={projectId}
          allTasks={allTasks}
          group={group}
          today={today}
          canWriteTasks={canWriteTasks}
          canWriteProject={canWriteProject}
          staff={staff}
          setStatus={setStatus}
          setField={setField}
          addTask={addTask}
          setMilestoneDone={setMilestoneDone}
        />
      ))}
    </div>
  );
}

function Group({
  g,
  projectId,
  allTasks,
  group,
  today,
  canWriteTasks,
  canWriteProject,
  staff,
  setStatus,
  setField,
  addTask,
  setMilestoneDone,
}: {
  g: TaskGroup;
  projectId: string;
  allTasks: ProjectTask[];
  group: ListGrouping;
  today: string;
  canWriteTasks: boolean;
  canWriteProject: boolean;
  staff: Options;
  setStatus: (id: string, to: string) => Promise<TaskActionResult>;
  setField: SetField;
  addTask: (formData: FormData) => Promise<void>;
  setMilestoneDone: (formData: FormData) => Promise<void>;
}) {
  const m = g.milestone;
  const inMs = m ? allTasks.filter((t) => t.milestoneId === m.id && t.status !== "cancelled") : [];
  const doneInMs = inMs.filter((t) => t.status === "completed").length;
  const openInMs = inMs.filter((t) => isOpenTask(t.status)).length;
  const late = m && m.status === "open" && m.dueDate !== null && m.dueDate < today;
  const headId = `grp-${g.key}`;
  return (
    <section className="hq-prj-group" aria-labelledby={headId} data-done={m?.status === "done" || undefined}>
      <div className="hq-prj-group__head">
        <h3 id={headId} className="hq-prj-group__title">
          {g.label}
        </h3>
        <span className="hq-prj-group__meta">
          {m ? (
            <>
              {m.status === "done" ? "Done" : m.dueDate ? <span className={late ? "hq-prj-late" : undefined}>{late ? "Was due" : "Due"} {formatDate(m.dueDate)}</span> : "No due date"}
              {inMs.length > 0 ? ` · ${doneInMs} of ${inMs.length} done` : ""}
            </>
          ) : (
            `${g.rows.length} ${g.rows.length === 1 ? "task" : "tasks"}`
          )}
        </span>
        {m && canWriteProject ? (
          <span className="hq-prj-group__actions">
            <MilestoneDone projectId={projectId} milestone={m} openTasks={openInMs} action={setMilestoneDone} returnView="list" returnGroup={group} />
          </span>
        ) : null}
      </div>

      {g.rows.length > 0 ? (
        <ul className="hq-prj-tasks">
          {g.rows.map(({ task: t, depth }) => (
            <li key={t.id} className="hq-prj-task" data-depth={depth} data-closed={!isOpenTask(t.status) || undefined}>
              <span>{canWriteTasks ? <QuickComplete id={t.id} title={t.title} status={t.status} setStatus={setStatus} /> : null}</span>
              <p className="hq-prj-task__title">
                {depth === 0 && t.parentId && t.parentTitle ? <span className="hq-prj-line__sub mt-0 mb-0.5">Subtask of {t.parentTitle}</span> : null}
                <Link href={`/hq/operations/tasks/${t.id}`}>{t.title}</Link>
                <span className="hq-prj-task__flags">
                  {t.blocked ? <span className="hq-prj-blocked">Blocked</span> : null}
                  {t.subtaskCount > 0 ? <span>{t.subtaskCount - t.subtaskOpen}/{t.subtaskCount} subtasks</span> : null}
                  {t.checklistTotal > 0 ? <span>Checklist {checklistText(t.checklistDone, t.checklistTotal)}</span> : null}
                  {!canWriteTasks ? <ReadOnlyFacts t={t} today={today} /> : null}
                </span>
              </p>
              {canWriteTasks ? (
                <div className="hq-prj-task__controls">
                  <StatusMini id={t.id} title={t.title} status={t.status} setStatus={setStatus} />
                  <AssigneeMini id={t.id} title={t.title} assignedTo={t.assignedTo} assignedName={t.assignedToName} staff={staff} setField={setField} />
                  <PriorityMini id={t.id} title={t.title} priority={t.priority} setField={setField} />
                  <DueMini id={t.id} title={t.title} due={t.dueDate} status={t.status} today={today} setField={setField} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hq-prj-quiet py-3">{m ? "No tasks under this milestone yet." : "No tasks."}</p>
      )}

      {canWriteTasks && canWriteProject && group === "milestone" ? (
        <form action={addTask} className="hq-prj-add">
          <input type="hidden" name="project_id" value={projectId} />
          {m ? <input type="hidden" name="milestone_id" value={m.id} /> : null}
          <input type="hidden" name="return_view" value="list" />
          <label className="sr-only" htmlFor={`add-${g.key}`}>
            Add a task{m ? ` to ${m.name}` : ""}
          </label>
          <input id={`add-${g.key}`} name="title" className="hq-prj-add__input" placeholder={m ? `Add a task to ${m.name}` : "Add a task"} maxLength={200} autoComplete="off" required />
          <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm">
            <span className="hq-btn__label">Add</span>
          </button>
        </form>
      ) : null}
    </section>
  );
}

function ReadOnlyFacts({ t, today }: { t: ProjectTask; today: string }) {
  const late = isOpenTask(t.status) && t.dueDate !== null && t.dueDate < today;
  return (
    <>
      <span>{t.assignedToName ?? "Unassigned"}</span>
      {t.priority === "urgent" || t.priority === "high" ? <span className={t.priority === "urgent" ? "hq-prj-pri--urgent" : "hq-prj-pri--high"}>{t.priority === "urgent" ? "Urgent" : "High"}</span> : null}
      {t.dueDate ? <span className={late ? "hq-prj-late" : undefined}>Due {formatDate(t.dueDate)}</span> : null}
      <span>{TASK_STATUS_WORD[t.status]}</span>
    </>
  );
}
