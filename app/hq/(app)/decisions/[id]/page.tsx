import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/hq/constants";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { DECISION_STATUS_LABEL, isClosedStatus } from "@/lib/hq/decisions/rules";
import { getDecision, staffNameMap, supersedeCandidates } from "@/lib/hq/decisions/queries";
import { newTaskHref } from "@/lib/hq/tasks/rules";
import { Button, ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, TaskStatusChip, type KeyValueItem } from "@/components/hq";
import { NativeSelectPicker } from "@/components/hq/Select";
import { DecisionControls, RestoreDecision } from "@/components/hq/features/decisions/DecisionControls";
import { DecisionHistory } from "@/components/hq/features/decisions/DecisionHistory";
import { DecisionStatusChip, categoryLabel } from "@/components/hq/features/decisions/DecisionParts";
import { archiveDecision, linkTask, restoreDecision, reverseDecision, supersedeDecision, unlinkTask } from "../actions";

export const metadata: Metadata = { title: "Decision" };

type Params = Promise<{ id: string }>;

export default async function DecisionPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("decisions.read", false, isUuid(id) ? `/hq/decisions/${id}` : "/hq/decisions");
  if (!isUuid(id)) notFound();
  const canWrite = can("decisions.write");
  const canTasks = can("tasks.write");

  const found = await getDecision(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Decision" breadcrumbs={[{ label: "Decisions", href: "/hq/decisions" }, { label: "Decision" }]} />
        <ErrorState
          title="We could not load this decision"
          action={
            <LinkButton href={`/hq/decisions/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing, archived (for a reader) and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const { decision: d, supersedes, history, tasks, hiddenTaskCount } = found.data;
  const closed = isClosedStatus(d.status);

  // Names for history entries that changed the decision maker.
  const makerIds = history.flatMap((h) => {
    const c = h.changes.decision_maker_id;
    return c ? [c.from, c.to].filter((x): x is string => typeof x === "string") : [];
  });
  const [names, candidates, openTasks] = await Promise.all([
    staffNameMap(db, makerIds),
    canWrite && !closed && !d.archived ? supersedeCandidates(db, d.id) : Promise.resolve([]),
    canWrite && !d.archived
      ? db.from("tasks").select("id, title").is("deleted_at", null).in("status", ["to_do", "in_progress", "waiting"]).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);
  const linkable = (openTasks.data ?? []).filter((t) => !tasks.some((x) => x.id === t.id)).map((t) => ({ value: t.id, label: t.title }));

  const details: KeyValueItem[] = [
    { label: "Status", value: <DecisionStatusChip status={d.status} /> },
    { label: "Category", value: categoryLabel(d.category) },
    { label: "Decided", value: <time dateTime={d.decisionDate}>{formatDate(d.decisionDate)}</time> },
    { label: "Decision maker", value: d.decisionMakerName ?? "A colleague" },
    { label: "Last changed", value: <time dateTime={d.updatedAt}>{formatDateTime(d.updatedAt, staff.timezone)}</time> },
  ];

  const createTaskHref = newTaskHref({ decision: d.id, title: `Follow up ${d.ref}: ${d.title}`.slice(0, 200), returnTo: `/hq/decisions/${d.id}` });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Decisions", href: "/hq/decisions" }, { label: d.ref }]}
        eyebrow={d.ref}
        title={d.title}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <DecisionStatusChip status={d.status} />
            <span className="text-[13px] text-grey-text">
              {categoryLabel(d.category)} &middot; decided {formatDate(d.decisionDate)}
              {d.decisionMakerName ? ` by ${d.decisionMakerName}` : ""}
            </span>
          </span>
        }
        actions={
          canWrite && !d.archived ? (
            <LinkButton href={`/hq/decisions/${d.id}/edit`} icon="note">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {d.archived ? (
        <InlineNote className="mb-6">This decision is archived: it is not in the register or in search. Restore it to bring it back.</InlineNote>
      ) : null}

      {d.status === "superseded" && d.supersededById ? (
        <InlineNote className="mb-6">
          Superseded by{" "}
          <Link href={`/hq/decisions/${d.supersededById}`} className="underline underline-offset-4">
            {d.supersededByRef}
            {d.supersededByTitle ? `: ${d.supersededByTitle}` : ""}
          </Link>
          . This decision no longer applies.
        </InlineNote>
      ) : null}
      {d.status === "reversed" ? <InlineNote className="mb-6">Reversed: {d.reversedNote}</InlineNote> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="d-what">
            <SectionLabel as="h2" id="d-what" className="mb-4 border-b border-line pb-3.5">
              What was decided
            </SectionLabel>
            {d.description ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{d.description}</p> : <p className="hq-muted">No more detail recorded.</p>}
          </section>

          <section aria-labelledby="d-why">
            <SectionLabel as="h2" id="d-why" className="mb-4 border-b border-line pb-3.5">
              Why
            </SectionLabel>
            {d.rationale ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{d.rationale}</p> : <p className="hq-muted">No reasons recorded.</p>}
          </section>

          {supersedes.length > 0 ? (
            <section aria-labelledby="d-chain">
              <SectionLabel as="h2" id="d-chain" className="mb-4 border-b border-line pb-3.5">
                Replaces
              </SectionLabel>
              <ul className="m-0 grid list-none gap-2 p-0 text-[15px]">
                {supersedes.map((s) => (
                  <li key={s.id}>
                    This replaces{" "}
                    <Link href={`/hq/decisions/${s.id}`} className="underline underline-offset-4">
                      {s.ref}: {s.title}
                    </Link>{" "}
                    <span className="text-grey-text">({formatDate(s.decisionDate)})</span>
                  </li>
                ))}
                {d.supersededById ? (
                  <li>
                    Replaced by{" "}
                    <Link href={`/hq/decisions/${d.supersededById}`} className="underline underline-offset-4">
                      {d.supersededByRef}
                      {d.supersededByTitle ? `: ${d.supersededByTitle}` : ""}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="d-tasks">
            <SectionLabel as="h2" id="d-tasks" className="mb-4 border-b border-line pb-3.5">
              Tasks
            </SectionLabel>
            {tasks.length === 0 ? (
              hiddenTaskCount > 0 ? null : <p className="hq-muted">No tasks linked yet.</p>
            ) : (
              <ul className="m-0 grid list-none gap-0 p-0">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
                    <span className="min-w-0">
                      <Link href={`/hq/operations/tasks/${t.id}`} className="font-medium">
                        {t.title}
                      </Link>
                      <span className="block text-[13px] text-grey-text">
                        {t.assignedToName ? `Assigned to ${t.assignedToName}` : "Unassigned"}
                        {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {t.status in TASK_STATUS_LABEL ? <TaskStatusChip status={t.status as TaskStatus} /> : null}
                      {canWrite && !d.archived ? (
                        <form action={unlinkTask}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="task_id" value={t.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Unlink
                          </Button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {hiddenTaskCount > 0 ? (
              <p className="hq-muted mt-2 text-[13px]">
                {hiddenTaskCount === 1 ? "1 linked task is" : `${hiddenTaskCount} linked tasks are`} not shown: archived, or assigned to someone else.
              </p>
            ) : null}
            {canWrite && !d.archived && !closed ? (
              <div className="mt-5 grid gap-4">
                {canTasks ? (
                  <div>
                    <LinkButton href={createTaskHref} icon="plus" size="sm">
                      Create a task from this decision
                    </LinkButton>
                  </div>
                ) : null}
                {linkable.length > 0 ? (
                  <form action={linkTask} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="id" value={d.id} />
                    <NativeSelectPicker name="task_id" idPrefix="link" label="Link an existing task" placeholder="Choose an open task" options={linkable} className="min-w-0 flex-1 sm:max-w-md" />
                    <Button type="submit" size="sm">
                      Link task
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="d-history">
            <SectionLabel as="h2" id="d-history" className="mb-5 border-b border-line pb-3.5">
              History
            </SectionLabel>
            {history.length > 0 ? <DecisionHistory entries={history} timezone={staff.timezone} names={names} /> : <p className="hq-muted">No history recorded.</p>}
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Decision details">
          <Panel aria-labelledby="d-details">
            <PanelHeader id="d-details" title="Details" level={2} />
            <KeyValueList items={details} />
          </Panel>

          {canWrite ? (
            <Panel aria-labelledby="d-manage">
              <PanelHeader id="d-manage" title="Manage" level={2} />
              {d.archived ? (
                <RestoreDecision id={d.id} restore={restoreDecision} />
              ) : (
                <>
                  {closed ? <p className="mb-4 text-[14px] text-grey-text">This decision is {DECISION_STATUS_LABEL[d.status].toLowerCase()}, so its status cannot change again. To change course, record a new decision.</p> : null}
                  <DecisionControls
                    id={d.id}
                    refLabel={d.ref}
                    title={d.title}
                    canChangeStatus={!closed}
                    candidates={candidates}
                    supersede={supersedeDecision}
                    reverse={reverseDecision}
                    archive={archiveDecision}
                  />
                </>
              )}
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
