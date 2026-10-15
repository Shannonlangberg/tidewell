import Link from "next/link";
import type { ContractorTask } from "@/lib/hq/contractors/queries";
import type { Loaded } from "@/lib/hq/contractors/types";
import { formatDay } from "@/lib/hq/growth/dates";
import { ErrorState, EmptyState } from "../../EmptyState";
import { LinkButton } from "../../Button";
import { SectionLabel } from "../../Primitives";
import { TaskStatusChip } from "../../StatusChip";

/* Open tasks linked to this contractor (a follow-up, an expiry reminder). Row level security limits them to tasks the person may see. */
export function ContractorTasks({ tasks, today, createHref }: { tasks: Loaded<ContractorTask[]>; today: string; createHref?: string }) {
  return (
    <section aria-labelledby="tasks-h">
      <SectionLabel as="h2" id="tasks-h" className="mb-5 border-b border-line pb-3.5">
        Tasks
      </SectionLabel>
      {!tasks.ok ? (
        <ErrorState title="We could not load the tasks" />
      ) : tasks.data.length === 0 ? (
        <EmptyState
          compact
          title="No open tasks"
          action={
            createHref ? (
              <LinkButton href={createHref} size="sm" icon="plus">
                Create follow-up task
              </LinkButton>
            ) : undefined
          }
        >
          Nothing is waiting on this contractor.
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-3">
            {tasks.data.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 text-[14px]">
                <div className="min-w-0">
                  <Link href={`/hq/operations/tasks/${t.id}`} className="font-medium underline-offset-2 hover:underline">
                    {t.title}
                  </Link>
                  <p className="text-[13px] text-grey-text">
                    {t.dueDate ? `Due ${formatDay(t.dueDate, today)}` : "No due date"}
                    {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                  </p>
                </div>
                <TaskStatusChip status={t.status} />
              </li>
            ))}
          </ul>
          {createHref ? (
            <div className="mt-4">
              <LinkButton href={createHref} size="sm" icon="plus">
                Create follow-up task
              </LinkButton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
