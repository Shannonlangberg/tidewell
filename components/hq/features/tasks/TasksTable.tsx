import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate } from "@/lib/hq/format";
import { isOverdue, overdueLabel } from "@/lib/hq/tasks/rules";
import type { TaskActionResult, TaskListItem } from "@/lib/hq/tasks/types";
import { DataTable, ResponsiveTable, type Column, type SortState } from "../../DataTable";
import { MobileList } from "../../MobileList";
import { PriorityChip, StatusChip, TaskStatusChip } from "../../StatusChip";
import { QuickComplete } from "./QuickComplete";
import { DueCell, RelatedChips, dueMeta, hasRelated } from "./TaskParts";

/*
 * The task list: a semantic table from 768px up, one card per task below that (the switch is
 * CSS only, see components/hq/DataTable.tsx). Server-rendered, so sorting is link-based and
 * the page works before any script loads; only the quick-complete button is interactive.
 *
 * The first column is the quick-complete button, and exists ONLY when the person may write
 * tasks (`setStatus` is passed). A read-only person gets the same list with no controls.
 */

const taskHref = (id: string) => `/hq/operations/tasks/${id}`;

export function TasksTable({
  rows,
  caption,
  sort,
  hrefForSort,
  today,
  timezone,
  setStatus,
  showCompleted,
  meId,
  empty,
}: {
  rows: readonly TaskListItem[];
  caption: string;
  sort: SortState;
  hrefForSort: (s: SortState) => string;
  today: string;
  timezone: string;
  /** Present only for people who hold tasks.write. */
  setStatus?: (id: string, to: string) => Promise<TaskActionResult>;
  /** Add a "Completed" column (the Completed and All views). */
  showCompleted: boolean;
  /** The signed-in person: below 1024px the Assigned to column is hidden, so someone else's task says who has it under its title. */
  meId: string;
  empty: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  const columns: Column<TaskListItem>[] = [];
  if (setStatus) {
    columns.push({
      key: "done",
      header: <span className="sr-only">Complete</span>,
      width: "2.75rem",
      cell: (t) => <QuickComplete id={t.id} title={t.title} status={t.status} setStatus={setStatus} />,
    });
  }
  columns.push(
    {
      key: "title",
      header: "Task",
      primary: true,
      cell: (t) => (
        <>
          <Link href={taskHref(t.id)}>{t.title}</Link>
          {t.assignedTo !== meId ? (
            <span className="hq-cell-sub lg:hidden">{t.assignedToName ? `Assigned to ${t.assignedToName}` : t.assignedTo ? "Assigned to a colleague" : "Unassigned"}</span>
          ) : null}
          {hasRelated(t.related) ? <RelatedChips related={t.related} className="hq-cell-sub mt-1.5 flex flex-wrap gap-1.5" /> : null}
        </>
      ),
    },
    { key: "due", header: "Due", sortable: true, sortKey: "due", nowrap: true, cell: (t) => <DueCell due={t.dueDate} status={t.status} today={today} /> },
    { key: "priority", header: "Priority", sortable: true, sortKey: "priority", nowrap: true, cell: (t) => <PriorityChip priority={t.priority} /> },
    { key: "status", header: "Status", nowrap: true, cell: (t) => <TaskStatusChip status={t.status} /> },
    {
      key: "assignee",
      header: "Assigned to",
      hideBelow: "lg",
      nowrap: true,
      cell: (t) => (t.assignedToName ?? (t.assignedTo ? "A colleague" : <span className="hq-cell-nil">Unassigned</span>)),
    },
  );
  if (showCompleted) {
    columns.push({
      key: "completed",
      header: "Completed",
      sortable: true,
      sortKey: "completed",
      hideBelow: "xl",
      nowrap: true,
      cell: (t) => (t.completedAt ? <time dateTime={t.completedAt}>{formatDate(t.completedAt, timezone)}</time> : <span className="hq-cell-nil">&mdash;</span>),
    });
  }
  columns.push({
    key: "created",
    header: "Created",
    sortable: true,
    sortKey: "created",
    hideBelow: "xl",
    nowrap: true,
    cell: (t) => <time dateTime={t.createdAt}>{formatDate(t.createdAt, timezone)}</time>,
  });

  return (
    <ResponsiveTable
      table={<DataTable caption={caption} columns={columns} rows={rows} rowKey={(t) => t.id} sort={sort} hrefForSort={hrefForSort} />}
      list={
        <MobileList label="Tasks">
          {rows.map((t) => {
            const overdue = isOverdue(t.status, t.dueDate, today);
            return (
              <li key={t.id} className="hq-mitem relative">
                <div className="hq-mitem__link flex items-start gap-3">
                  {setStatus ? (
                    <span className="relative z-10 shrink-0">
                      <QuickComplete id={t.id} title={t.title} status={t.status} setStatus={setStatus} />
                    </span>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    {/* The whole card is the link: this one anchor stretches over it, and the controls sit above it. */}
                    <Link href={taskHref(t.id)} className="hq-mitem__title no-underline after:absolute after:inset-0 after:content-['']">
                      {t.title}
                    </Link>
                    <span className="hq-mitem__sub">{t.assignedToName ? `Assigned to ${t.assignedToName}` : t.assignedTo ? "Assigned to a colleague" : "Unassigned"}</span>
                    {hasRelated(t.related) ? <RelatedChips related={t.related} className="relative z-10 mt-2 flex flex-wrap gap-1.5" /> : null}
                    <span className="hq-mitem__row">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {overdue ? <StatusChip tone="error">{overdueLabel(t.dueDate, today)}</StatusChip> : null}
                        <TaskStatusChip status={t.status} />
                        {t.priority !== "normal" ? <PriorityChip priority={t.priority} /> : null}
                      </span>
                      <span className="hq-mitem__meta shrink-0 whitespace-nowrap">{dueMeta(t.dueDate, t.status, today)}</span>
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </MobileList>
      }
    />
  );
}
