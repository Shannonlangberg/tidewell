"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import type { TaskStatus } from "@/lib/hq/constants";
import { TASK_STATUS_WORD, boardColumns, canMove, checklistText, dueWords, initialsOf, isTaskOverdue, moveRefusal, moveTargets } from "@/lib/hq/projects/rules";
import type { ProjectActionResult, ProjectTask } from "@/lib/hq/projects/types";
import { useToast } from "../../Toast";

/*
 * The Board: one column per status (To do, In progress, Waiting, Completed). A card moves by its
 * status menu (a native select: keyboard and screen reader friendly, and the way to move on a
 * phone) or by native HTML5 drag and drop on a pointer screen. Only the moves the task page allows
 * are offered; a refused drop says why. The move is shown at once (optimistic) and the Server Action
 * (changeTaskStatus, passed in) is the authority: if it refuses, the card goes back and a toast says so.
 * People who may not write tasks see the same board with no menus and nothing draggable.
 */

type SetStatus = (id: string, to: string) => Promise<ProjectActionResult>;

export function ProjectBoard({ tasks, today, setStatus, cancelledCount }: { tasks: ProjectTask[]; today: string; setStatus?: SetStatus; cancelledCount: number }) {
  const { toast } = useToast();
  const [, start] = useTransition();
  const [optimistic, move] = useOptimistic(tasks, (state: ProjectTask[], m: { id: string; to: TaskStatus }) => state.map((t) => (t.id === m.id ? { ...t, status: m.to } : t)));
  const [dragging, setDragging] = useState<{ id: string; from: TaskStatus } | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const titleOf = (id: string) => optimistic.find((t) => t.id === id)?.title ?? "Task";

  function run(id: string, from: TaskStatus, to: TaskStatus) {
    if (!setStatus || from === to) return;
    if (!canMove(from, to)) {
      toast(moveRefusal(from, to), { tone: "error" });
      return;
    }
    setPendingId(id);
    start(async () => {
      move({ id, to });
      try {
        const r = await setStatus(id, to);
        toast(r.message, { tone: r.ok ? "success" : "error" });
        setAnnounce(r.ok ? `${titleOf(id)} moved to ${TASK_STATUS_WORD[to]}` : r.message);
      } catch {
        toast("We could not move that task. Try again in a moment.", { tone: "error" });
      } finally {
        setPendingId(null);
      }
    });
  }

  const cols = boardColumns(optimistic);

  const onDragOver = (status: TaskStatus) => (e: DragEvent) => {
    if (!dragging) return;
    if (canMove(dragging.from, status)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    if (over !== status) setOver(status);
  };

  return (
    <>
      <div className="hq-prj-board" role="list" aria-label="Board, by status">
        {cols.map((c) => {
          const refuse = dragging !== null && over === c.status && dragging.from !== c.status && !canMove(dragging.from, c.status);
          return (
            <section
              key={c.status}
              role="listitem"
              aria-labelledby={`col-${c.status}`}
              className="hq-prj-col"
              data-over={(dragging !== null && over === c.status && canMove(dragging.from, c.status)) || undefined}
              data-refuse={refuse || undefined}
              onDragOver={setStatus ? onDragOver(c.status) : undefined}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === c.status ? null : o));
              }}
              onDrop={
                setStatus
                  ? (e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      const from = dragging?.from ?? optimistic.find((t) => t.id === id)?.status;
                      setDragging(null);
                      setOver(null);
                      if (id && from) run(id, from, c.status);
                    }
                  : undefined
              }
            >
              <div className="hq-prj-col__head">
                <h3 id={`col-${c.status}`} className="hq-label m-0">
                  {TASK_STATUS_WORD[c.status]}
                </h3>
                <span className="hq-prj-col__count" aria-label={`${c.tasks.length} ${c.tasks.length === 1 ? "task" : "tasks"}`}>
                  {c.tasks.length}
                </span>
              </div>
              {c.tasks.length === 0 ? (
                <p className="hq-prj-col__empty">{setStatus ? "Nothing here. Drag a card in, or use its status menu." : "Nothing here."}</p>
              ) : (
                <ul className="hq-prj-cards">
                  {c.tasks.map((t) => (
                    <Card
                      key={t.id}
                      t={t}
                      today={today}
                      pending={pendingId === t.id}
                      dragging={dragging?.id === t.id}
                      canWrite={!!setStatus}
                      onMove={(to) => run(t.id, t.status, to)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", t.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging({ id: t.id, from: t.status });
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {cancelledCount > 0 ? <p className="hq-prj-board__note">{cancelledCount === 1 ? "1 cancelled task is" : `${cancelledCount} cancelled tasks are`} not on the board. The List view shows them when you choose every status.</p> : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </>
  );
}

function Card({
  t,
  today,
  pending,
  dragging,
  canWrite,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  t: ProjectTask;
  today: string;
  pending: boolean;
  dragging: boolean;
  canWrite: boolean;
  onMove: (to: TaskStatus) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
}) {
  const late = isTaskOverdue(t.status, t.dueDate, today);
  const due = dueWords(t.dueDate, t.status, today);
  const initials = initialsOf(t.assignedToName);
  return (
    <li
      className="hq-prj-card"
      draggable={canWrite && !pending ? true : undefined}
      onDragStart={canWrite ? onDragStart : undefined}
      onDragEnd={canWrite ? onDragEnd : undefined}
      data-dragging={dragging || undefined}
      data-pending={pending || undefined}
      data-depth={t.parentId ? 1 : 0}
      aria-busy={pending || undefined}
    >
      <p className="hq-prj-card__title">
        {t.parentId && t.parentTitle ? <span className="hq-prj-card__parent">Subtask of {t.parentTitle}</span> : null}
        <Link href={`/hq/operations/tasks/${t.id}`} draggable={false}>
          {t.title}
        </Link>
      </p>
      <div className="hq-prj-card__foot">
        {t.blocked ? <span className="hq-prj-blocked">Blocked</span> : null}
        {t.priority === "urgent" || t.priority === "high" ? <span className={t.priority === "urgent" ? "hq-prj-pri--urgent" : "hq-prj-pri--high"}>{t.priority === "urgent" ? "Urgent" : "High"}</span> : null}
        {t.dueDate ? <span className={late ? "hq-prj-late" : undefined}>{due || shortDate(t.dueDate)}</span> : null}
        {t.checklistTotal > 0 ? <span aria-label={`Checklist ${t.checklistDone} of ${t.checklistTotal} done`}>✓ {checklistText(t.checklistDone, t.checklistTotal)}</span> : null}
        <span className={initials ? "hq-prj-initials" : "hq-prj-initials hq-prj-initials--none"} title={t.assignedToName ?? "Unassigned"} aria-label={t.assignedToName ? `Assigned to ${t.assignedToName}` : "Unassigned"}>
          {initials}
        </span>
      </div>
      {canWrite ? (
        <span className="hq-prj-mini">
          <select
            className="hq-prj-card__move"
            aria-label={`Move ${t.title}`}
            value=""
            disabled={pending}
            onChange={(e) => {
              const to = e.currentTarget.value as TaskStatus;
              if (to) onMove(to);
            }}
          >
            <option value="">Move to…</option>
            {moveTargets(t.status).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_WORD[s]}
              </option>
            ))}
          </select>
        </span>
      ) : null}
    </li>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(d: string): string {
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""}`;
}
