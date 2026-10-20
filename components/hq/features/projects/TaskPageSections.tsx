import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/hq/format";
import type { ActionState } from "@/lib/hq/forms";
import { BLOCKED_REASON_MAX, TASK_STATUS_WORD, dueWords, isOpenTask, isTaskOverdue, progressText } from "@/lib/hq/projects/rules";
import type { ActivityEntry, ChecklistItem, Dependency, ProjectActionResult, ProjectTask, TaskComment } from "@/lib/hq/projects/types";
import { Section } from "./ProjectParts";
import { ChecklistEditor, CommentForm } from "./TaskExtras";

/*
 * The parts the projects work adds to the existing task page (/hq/operations/tasks/[id]): where the
 * task sits (project, milestone, parent), its subtasks, checklist, what it waits for and what waits
 * for it, comments, and its activity history. Server-rendered; the forms post to Server Actions
 * passed in as props, which check the capability again before the hq RPCs apply the task rules.
 * Writing controls appear only for someone with tasks.write (and project or milestone changes only
 * with projects.write); everyone who can see the task sees the rest.
 */

type Option = { value: string; label: string; group?: string };
type FormAction = (fd: FormData) => Promise<void>;

const taskHref = (id: string) => `/hq/operations/tasks/${id}`;

function PickerField({ id, name, label, placeholder, options, defaultValue }: { id: string; name: string; label: string; placeholder: string; options: readonly Option[]; defaultValue: string }) {
  const groups = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];
  const plain = options.filter((o) => !o.group);
  return (
    <div className="hq-field">
      <label htmlFor={id} className="hq-field__label">
        {label}
      </label>
      <span className="hq-select">
        <select id={id} name={name} className="hq-input hq-input--select" defaultValue={defaultValue}>
          <option value="">{placeholder}</option>
          {plain.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {options
                .filter((o) => o.group === g)
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </span>
    </div>
  );
}

// ── where it sits ───────────────────────────────────────────

export function TaskPlacement({
  task: t,
  canSeeProjects,
  canWriteTasks,
  canWriteProjects,
  projects,
  milestones,
  parents,
  action,
}: {
  task: ProjectTask;
  canSeeProjects: boolean;
  canWriteTasks: boolean;
  canWriteProjects: boolean;
  projects: readonly Option[];
  milestones: readonly Option[];
  /** Top-level tasks in the same project that could hold this one (empty when it has subtasks itself). */
  parents: readonly Option[];
  action: FormAction;
}) {
  const editable = canWriteTasks && (canWriteProjects || parents.length > 0 || !!t.parentId);
  return (
    <>
      <dl className="hq-prj-kv">
        <div>
          <dt>Project</dt>
          <dd className={t.projectName ? undefined : "hq-prj-nil"}>
            {t.projectId && t.projectName ? canSeeProjects ? <Link href={`/hq/projects/${t.projectId}`}>{t.projectName}</Link> : t.projectName : "Not in a project"}
          </dd>
        </div>
        {t.projectId ? (
          <div>
            <dt>Milestone</dt>
            <dd className={t.milestoneName ? undefined : "hq-prj-nil"}>{t.milestoneName ?? "No milestone"}</dd>
          </div>
        ) : null}
        {t.parentId ? (
          <div>
            <dt>Part of</dt>
            <dd>
              <Link href={taskHref(t.parentId)}>{t.parentTitle ?? "Another task"}</Link>
            </dd>
          </div>
        ) : null}
      </dl>
      {editable ? (
        <details className="mt-3">
          <summary className="hq-prj-section__link inline-flex min-h-11 cursor-pointer items-center">Change where it sits</summary>
          <form action={action} className="hq-prj-inline-form">
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="current_project" value={t.projectId ?? ""} />
            <input type="hidden" name="current_milestone" value={t.milestoneId ?? ""} />
            <input type="hidden" name="current_parent" value={t.parentId ?? ""} />
            {canWriteProjects ? (
              <PickerField id="tp-project" name="project_id" label="Project" placeholder="Not in a project" options={projects} defaultValue={t.projectId ?? ""} />
            ) : (
              <input type="hidden" name="project_id" value={t.projectId ?? ""} />
            )}
            {canWriteProjects && t.projectId ? (
              <PickerField id="tp-milestone" name="milestone_id" label="Milestone" placeholder="No milestone" options={milestones} defaultValue={t.milestoneId ?? ""} />
            ) : (
              <input type="hidden" name="milestone_id" value={t.milestoneId ?? ""} />
            )}
            {t.projectId && (parents.length > 0 || t.parentId) ? (
              <PickerField id="tp-parent" name="parent_id" label="Subtask of" placeholder="Not a subtask" options={parents} defaultValue={t.parentId ?? ""} />
            ) : (
              <input type="hidden" name="parent_id" value={t.parentId ?? ""} />
            )}
            <p className="hq-prj-quiet">Moving it to another project clears its milestone and parent; choose new ones after.</p>
            <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm justify-self-start">
              <span className="hq-btn__label">Save</span>
            </button>
          </form>
        </details>
      ) : null}
    </>
  );
}

// ── subtasks ────────────────────────────────────────────────

export function SubtasksSection({ task: t, subtasks, today, canAdd, action }: { task: ProjectTask; subtasks: ProjectTask[]; today: string; canAdd: boolean; action: FormAction }) {
  if (t.parentId) return null; // one level only: a subtask has no subtasks
  if (subtasks.length === 0 && !canAdd) return null;
  const done = subtasks.filter((s) => s.status === "completed").length;
  return (
    <Section id="task-subtasks" title="Subtasks" link={subtasks.length > 0 ? <span className="hq-check__summary">{progressText(done, subtasks.length)}</span> : undefined}>
      {subtasks.length === 0 ? (
        <p className="hq-prj-quiet">No subtasks. Break the work into steps if that helps.</p>
      ) : (
        <ul className="hq-prj-lines">
          {subtasks.map((s) => {
            const late = isTaskOverdue(s.status, s.dueDate, today);
            return (
              <li key={s.id} className="hq-prj-line">
                <p className="hq-prj-line__title">
                  <Link href={taskHref(s.id)} className={isOpenTask(s.status) ? undefined : "line-through"}>
                    {s.title}
                  </Link>
                  <span className="hq-prj-line__sub">
                    {TASK_STATUS_WORD[s.status]} · {s.assignedToName ?? "Unassigned"}
                    {s.blocked ? " · Blocked" : ""}
                  </span>
                </p>
                <span className={late ? "hq-prj-line__meta hq-prj-late" : "hq-prj-line__meta"}>{dueWords(s.dueDate, s.status, today)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {canAdd ? (
        <form action={action} className="hq-prj-add mt-2">
          <input type="hidden" name="parent_id" value={t.id} />
          {t.milestoneId ? <input type="hidden" name="milestone_id" value={t.milestoneId} /> : null}
          <label htmlFor="subtask-title" className="sr-only">
            Add a subtask
          </label>
          <input id="subtask-title" name="title" className="hq-prj-add__input" placeholder="Add a subtask" maxLength={200} required />
          <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm">
            <span className="hq-btn__label">Add</span>
          </button>
        </form>
      ) : null}
    </Section>
  );
}

// ── checklist ───────────────────────────────────────────────

export function ChecklistSection({
  taskId,
  items,
  canWrite,
  save,
}: {
  taskId: string;
  items: ChecklistItem[];
  canWrite: boolean;
  save: (taskId: string, items: unknown) => Promise<ProjectActionResult & { items?: { id: string; text: string; done: boolean }[] }>;
}) {
  if (!canWrite && items.length === 0) return null;
  return (
    <Section id="task-checklist" title="Checklist">
      {canWrite ? (
        <ChecklistEditor taskId={taskId} initial={items.map((i) => ({ id: i.id, text: i.text, done: i.done }))} save={save} />
      ) : (
        <>
          <p className="hq-check__summary mb-2">{progressText(items.filter((i) => i.done).length, items.length)}</p>
          <ul className="hq-check">
            {items.map((i) => (
              <li key={i.id} className="hq-check__item" data-done={i.done || undefined}>
                <input type="checkbox" checked={i.done} readOnly disabled aria-label={`${i.done ? "Done" : "Not done"}: ${i.text}`} />
                <span className="hq-check__text">{i.text}</span>
                <span />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

// ── dependencies ────────────────────────────────────────────

function DepLine({ d, today, remove }: { d: Dependency; today: string; remove: ReactNode }) {
  const late = isTaskOverdue(d.status, d.dueDate, today);
  return (
    <li className="hq-prj-line">
      <p className="hq-prj-line__title">
        <Link href={taskHref(d.taskId)}>{d.title}</Link>
        <span className="hq-prj-line__sub">
          {TASK_STATUS_WORD[d.status]}
          {d.projectName ? ` · ${d.projectName}` : ""}
          {d.dueDate && isOpenTask(d.status) ? <span className={late ? "hq-prj-late" : undefined}> · {dueWords(d.dueDate, d.status, today)}</span> : null}
        </span>
      </p>
      {remove}
    </li>
  );
}

export function DependenciesSection({
  task: t,
  waitsFor,
  hiddenOpen,
  blocking,
  candidates,
  today,
  canWrite,
  add,
  remove,
  saveReason,
}: {
  task: ProjectTask;
  waitsFor: Dependency[];
  hiddenOpen: number;
  blocking: Dependency[];
  candidates: readonly Option[];
  today: string;
  canWrite: boolean;
  add: FormAction;
  remove: FormAction;
  saveReason: FormAction;
}) {
  if (!canWrite && waitsFor.length === 0 && blocking.length === 0 && hiddenOpen === 0) return null;
  const already = new Set(waitsFor.map((d) => d.taskId));
  const choices = candidates.filter((c) => !already.has(c.value));
  const removeButton = (taskId: string, dependsOn: string, label: string) =>
    canWrite ? (
      <form action={remove}>
        <input type="hidden" name="id" value={taskId} />
        <input type="hidden" name="depends_on" value={dependsOn} />
        <input type="hidden" name="back_id" value={t.id} />
        <button type="submit" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={label}>
          <span className="hq-btn__label">Remove</span>
        </button>
      </form>
    ) : null;

  return (
    <Section id="task-deps" title="Dependencies" link={t.blocked ? <span className="hq-prj-dot hq-prj-dot--warning">Blocked</span> : undefined}>
      <div className="grid gap-6">
        <div>
          <p className="hq-prj-quiet mb-1">Waits for</p>
          {waitsFor.length === 0 && hiddenOpen === 0 ? (
            <p className="hq-prj-quiet">Nothing. It can start whenever.</p>
          ) : (
            <ul className="hq-prj-lines">
              {waitsFor.map((d) => (
                <DepLine key={d.taskId} d={d} today={today} remove={removeButton(t.id, d.taskId, `Stop waiting for ${d.title}`)} />
              ))}
              {hiddenOpen > 0 ? (
                <li className="hq-prj-line">
                  <p className="hq-prj-line__title hq-muted">{hiddenOpen === 1 ? "An open task you can't see" : `${hiddenOpen} open tasks you can't see`}</p>
                </li>
              ) : null}
            </ul>
          )}
          {canWrite && choices.length > 0 ? (
            <details className="mt-2">
              <summary className="hq-prj-section__link inline-flex min-h-11 cursor-pointer items-center">Add a task it waits for</summary>
              <form action={add} className="hq-prj-inline-form">
                <input type="hidden" name="id" value={t.id} />
                <PickerField id="dep-add" name="depends_on" label="Waits for" placeholder="Choose a task" options={choices} defaultValue="" />
                <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm justify-self-start">
                  <span className="hq-btn__label">Add</span>
                </button>
              </form>
            </details>
          ) : null}
        </div>

        <div>
          <p className="hq-prj-quiet mb-1">Blocking</p>
          {blocking.length === 0 ? (
            <p className="hq-prj-quiet">No other task waits for this one.</p>
          ) : (
            <ul className="hq-prj-lines">
              {blocking.map((d) => (
                <DepLine key={d.taskId} d={d} today={today} remove={removeButton(d.taskId, t.id, `${d.title} no longer waits for this task`)} />
              ))}
            </ul>
          )}
        </div>

        {canWrite && (t.blocked || t.blockedReason) ? (
          <form action={saveReason} className="hq-prj-inline-form">
            <input type="hidden" name="id" value={t.id} />
            <div className="hq-field">
              <label htmlFor="blocked-reason" className="hq-field__label">
                What is holding it up (optional)
              </label>
              <input id="blocked-reason" name="blocked_reason" className="hq-input" defaultValue={t.blockedReason ?? ""} maxLength={BLOCKED_REASON_MAX} />
            </div>
            <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm justify-self-start">
              <span className="hq-btn__label">Save note</span>
            </button>
          </form>
        ) : t.blockedReason ? (
          <p className="text-[14px]">
            <span className="hq-prj-quiet">Holding it up: </span>
            {t.blockedReason}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

// ── comments ────────────────────────────────────────────────

export function CommentsSection({
  taskId,
  comments,
  meId,
  isDirector,
  canWrite,
  timezone,
  now,
  add,
  edit,
}: {
  taskId: string;
  comments: TaskComment[];
  meId: string;
  isDirector: boolean;
  canWrite: boolean;
  timezone: string;
  /** ms since epoch, from the request, for the 60-minute edit window */
  now: number;
  add: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  edit: FormAction;
}) {
  if (!canWrite && comments.length === 0) return null;
  return (
    <Section id="task-comments" title="Comments">
      {comments.length === 0 ? (
        <p className="hq-prj-quiet">No comments yet.</p>
      ) : (
        <ol className="hq-comments">
          {comments.map((c) => {
            const mayEdit = isDirector || (canWrite && c.authorId === meId && now - Date.parse(c.createdAt) < 60 * 60 * 1000);
            return (
              <li key={c.id} className="hq-comment">
                <p className="hq-comment__by">
                  <b>{c.authorName ?? "A colleague"}</b> · <time dateTime={c.createdAt}>{formatDateTime(c.createdAt, timezone)}</time>
                  {c.editedAt ? " · edited" : ""}
                </p>
                <p className="hq-comment__body">{c.body}</p>
                {mayEdit ? (
                  <details>
                    <summary className="hq-prj-section__link inline-flex min-h-11 cursor-pointer items-center">Edit</summary>
                    <form action={edit} className="hq-prj-inline-form">
                      <input type="hidden" name="id" value={taskId} />
                      <input type="hidden" name="comment_id" value={c.id} />
                      <label htmlFor={`comment-edit-${c.id}`} className="sr-only">
                        Edit comment
                      </label>
                      <textarea id={`comment-edit-${c.id}`} name="body" rows={3} maxLength={4000} defaultValue={c.body} className="hq-input hq-textarea" />
                      <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm justify-self-start">
                        <span className="hq-btn__label">Save</span>
                      </button>
                    </form>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {canWrite ? <CommentForm taskId={taskId} action={add} /> : null}
    </Section>
  );
}

// ── history (hq.task_activity) ──────────────────────────────

export function HistorySection({ activity, timezone }: { activity: ActivityEntry[]; timezone: string }) {
  if (activity.length === 0) return null;
  return (
    <Section id="task-history" title="History">
      <ol className="hq-prj-activity">
        {activity.map((a) => (
          <li key={a.id}>
            <span>{a.summary}</span>
            <span className="hq-prj-activity__who">
              <time dateTime={a.at}>{formatDateTime(a.at, timezone)}</time>
              {a.actorName ? ` · ${a.actorName}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
