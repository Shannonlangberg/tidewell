import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { formatDate, formatDateTime, relativeDay, todayIn } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { buildActivity, staffIdsInAudit } from "@/lib/hq/tasks/activity";
import { isOverdue, overdueLabel } from "@/lib/hq/tasks/rules";
import { getTask, staffNames, taskAudit } from "@/lib/hq/tasks/queries";
import { isOpen } from "@/lib/hq/tasks/rules";
import {
  ErrorState,
  KeyValueList,
  LinkButton,
  PageHeader,
  Panel,
  PanelHeader,
  PriorityChip,
  SectionLabel,
  StatusChip,
  TaskStatusChip,
  type KeyValueItem,
} from "@/components/hq";
import { CompleteReopenButton, ManageTask, StatusSelect } from "@/components/hq/features/tasks/TaskControls";
import { RelatedChips, hasRelated } from "@/components/hq/features/tasks/TaskParts";
import { TaskTimeline } from "@/components/hq/features/tasks/TaskTimeline";
import { archiveTask, changeTaskStatus } from "../../actions";

export const metadata: Metadata = { title: "Task" };

type Params = Promise<{ id: string }>;

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by hand",
  interaction: "Created when a call or meeting was logged",
  ai_draft: "Drafted by Ask Planted",
};

export default async function TaskPage({ params }: { params: Params }) {
  const { id } = await params;
  // Any signed-in staff member may ask; the database only returns a task they are allowed to see.
  const { db, staff, can } = await requireStaff(undefined, false, isUuid(id) ? `/hq/operations/tasks/${id}` : "/hq/operations");
  if (!isUuid(id)) notFound();

  const canWrite = can("tasks.write");
  const found = await getTask(db, id, { canGrowth: can("growth.read") });
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Task" breadcrumbs={[{ label: "Operations", href: "/hq/operations" }, { label: "Task" }]} />
        <ErrorState
          title="We could not load this task"
          action={
            <LinkButton href={`/hq/operations/tasks/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing, archived and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const t = found.data;

  // Audit history only for people who hold audit.read (the policy decides; others get an empty read, so it is not even requested).
  const audit = can("audit.read") ? await taskAudit(db, t.id) : null;
  const names = await staffNames(db, [t.createdBy, t.completedBy, ...staffIdsInAudit(audit)]);
  const nameOf = (staffId: string | null | undefined) => (staffId ? (names.get(staffId) ?? null) : null);
  const events = buildActivity({
    task: { id: t.id, status: t.status, createdAt: t.createdAt, createdBy: t.createdBy, completedAt: t.completedAt, completedBy: t.completedBy, updatedAt: t.updatedAt },
    audit,
    nameOf,
  });

  const today = todayIn(staff.timezone);
  const overdue = isOverdue(t.status, t.dueDate, today);
  const canArchive = canWrite && (can("growth.delete") || t.createdBy === staff.id || t.assignedTo === staff.id);

  const details: KeyValueItem[] = [
    { label: "Status", value: <TaskStatusChip status={t.status} /> },
    { label: "Priority", value: <PriorityChip priority={t.priority} /> },
    {
      label: "Due",
      empty: "No due date",
      value: t.dueDate ? (
        <>
          <time dateTime={t.dueDate}>{formatDate(t.dueDate)}</time>
          {isOpen(t.status) ? <span className="hq-cell-sub font-normal">{overdue ? overdueLabel(t.dueDate, today) : relativeDay(t.dueDate, today)}</span> : null}
        </>
      ) : null,
    },
    { label: "Assigned to", empty: "Unassigned", value: t.assignedToName ?? (t.assignedTo ? "A colleague" : null) },
    { label: "Linked to", empty: "Nothing", value: hasRelated(t.related) ? <RelatedChips related={t.related} /> : null },
    {
      label: "Created",
      value: (
        <>
          <time dateTime={t.createdAt}>{formatDateTime(t.createdAt, staff.timezone)}</time>
          {t.createdByName ? <span className="hq-cell-sub font-normal">by {t.createdByName}</span> : null}
        </>
      ),
    },
    ...(t.completedAt
      ? [
          {
            label: "Completed",
            value: (
              <>
                <time dateTime={t.completedAt}>{formatDateTime(t.completedAt, staff.timezone)}</time>
                {t.completedByName ? <span className="hq-cell-sub font-normal">by {t.completedByName}</span> : null}
              </>
            ),
          } satisfies KeyValueItem,
        ]
      : []),
    { label: "Source", value: SOURCE_LABEL[t.source] ?? t.source },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Operations", href: "/hq/operations" }, { label: "Task" }]}
        eyebrow="Task"
        title={t.title}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <TaskStatusChip status={t.status} />
            {overdue ? <StatusChip tone="error">{overdueLabel(t.dueDate, today)}</StatusChip> : null}
            <PriorityChip priority={t.priority} />
            {t.dueDate ? (
              <span className="text-[13px] text-grey-text">
                Due {formatDate(t.dueDate)}
                {isOpen(t.status) && !overdue ? ` (${relativeDay(t.dueDate, today).toLowerCase()})` : ""}
              </span>
            ) : null}
          </span>
        }
        actions={
          canWrite ? (
            <>
              <LinkButton href={`/hq/operations/tasks/${t.id}/edit`} icon="note">
                Edit
              </LinkButton>
              <CompleteReopenButton id={t.id} status={t.status} setStatus={changeTaskStatus} />
            </>
          ) : undefined
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="task-description">
            <SectionLabel as="h2" id="task-description" className="mb-4 border-b border-line pb-3.5">
              Description
            </SectionLabel>
            {t.description ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{t.description}</p> : <p className="hq-muted">No description.</p>}
          </section>

          <section aria-labelledby="task-activity">
            <SectionLabel as="h2" id="task-activity" className="mb-5 border-b border-line pb-3.5">
              Activity
            </SectionLabel>
            <TaskTimeline events={events} timezone={staff.timezone} />
            {audit === null && can("audit.read") ? <p className="hq-muted mt-4 text-[13px]">The full change history could not be loaded just now.</p> : null}
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Task details">
          <Panel aria-labelledby="task-details">
            <PanelHeader id="task-details" title="Details" level={2} />
            <KeyValueList items={details} />
          </Panel>

          {canWrite ? (
            <Panel aria-labelledby="task-manage">
              <PanelHeader id="task-manage" title="Manage" level={2} />
              <div className="grid gap-5">
                <StatusSelect id={t.id} status={t.status} setStatus={changeTaskStatus} />
                <ManageTask id={t.id} title={t.title} status={t.status} setStatus={changeTaskStatus} archive={archiveTask} canArchive={canArchive} />
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
