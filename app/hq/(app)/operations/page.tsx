import type { Metadata } from "next";
import Link from "next/link";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { todayIn } from "@/lib/hq/format";
import { staffOptions } from "@/lib/hq/queries/options";
import { LIST_PAGE_SIZE, RELATED_FILTERS, RELATED_FILTER_LABEL, buildPredicate, defaultDirFor, parseTaskListQuery } from "@/lib/hq/tasks/rules";
import { listTasks, viewCounts } from "@/lib/hq/tasks/queries";
import { PRIORITIES_DESC } from "@/lib/hq/tasks/rules";
import { TASK_VIEWS, viewsFor } from "@/lib/hq/tasks/rules";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  LinkButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tabs,
  buildHref,
  type SortState,
  type TabItem,
} from "@/components/hq";
import { TasksTable } from "@/components/hq/features/tasks/TasksTable";
import { changeTaskStatus } from "./actions";

export const metadata: Metadata = { title: "Tasks" };

const PATH = "/hq/operations";

const SORT_LABEL = { due: "due date", priority: "priority", created: "date created", completed: "date completed" } as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OperationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Any signed-in staff member may open this page: what they see is decided by row level security
  // (their own tasks, ones they created, or everyone's with tasks.read_all). The tabs offered are a courtesy.
  const { db, staff, can } = await requireStaff(undefined, false, buildHref(PATH, sp));

  const canReadAll = can("tasks.read_all");
  const canWrite = can("tasks.write");
  const canGrowth = can("growth.read");
  const canContractors = can("contractors.read");

  const query = parseTaskListQuery(sp, { canReadAll, canFilterRelated: canGrowth || canContractors });
  const def = TASK_VIEWS[query.view];
  const today = todayIn(staff.timezone);
  const ctx = { meId: staff.id, today, now: new Date() };
  const views = viewsFor(canReadAll);

  const [list, counts, staffList] = await Promise.all([
    listTasks(db, buildPredicate(query, ctx), { sort: query.sort, dir: query.dir, page: query.page, pageSize: LIST_PAGE_SIZE, canGrowth, canContractors }),
    viewCounts(
      db,
      views.map((v) => v.key),
      ctx,
    ),
    def.assigneeFilter ? staffOptions(db) : Promise.resolve([]),
  ]);

  const tabs: TabItem[] = views.map((v) => ({
    label: v.label,
    href: buildHref(PATH, {}, { view: v.key === "mine" ? null : v.key }),
    current: v.key === query.view,
    count: counts[v.key] ?? null,
  }));

  const sort: SortState = { key: query.sort, dir: query.dir };
  // A column you have not sorted by yet starts in its natural direction: most pressing first, soonest first, newest first.
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.key === query.sort ? s.dir : defaultDirFor(s.key as typeof query.sort), page: null });

  const sortChanged = query.sort !== def.defaultSort || query.dir !== defaultDirFor(query.sort);
  const viewParam = query.view === "mine" ? null : query.view;
  const clearHref = buildHref(PATH, {}, { view: viewParam });

  const assigneeOptions =
    def.assignee === "not_me"
      ? [{ value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id)]
      : [{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id)];

  const newTask = canWrite ? (
    <LinkButton href="/hq/operations/tasks/new" variant="primary" icon="plus">
      New task
    </LinkButton>
  ) : null;

  const empty = query.filtered ? (
    <EmptyState
      title="No tasks match those filters"
      action={
        <LinkButton href={clearHref} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try a shorter search, or clear the filters to see everything in this view.
    </EmptyState>
  ) : (
    <EmptyState title={def.empty.title} action={query.view === "mine" || query.view === "all" ? (newTask ?? undefined) : undefined}>
      {query.view === "mine" && !canWrite ? "Nothing is assigned to you. You can see every task in the team under Team tasks." : def.empty.body}
    </EmptyState>
  );

  return (
    <>
      <PageHeader eyebrow="Operations" title="Tasks" description={def.description} actions={newTask} />

      <Tabs label="Task views" items={tabs} />

      <FilterBar
        action={PATH}
        label="Filter tasks"
        hidden={{
          view: viewParam,
          sort: sortChanged ? query.sort : null,
          dir: sortChanged ? query.dir : null,
          older: query.older ? "1" : null,
        }}
        resetHref={clearHref}
        active={query.filtered}
      >
        <SearchInput placeholder="Search task titles" defaultValue={query.q} label="Search task titles" />
        {def.assigneeFilter ? (
          <Select name="assignee" label="Assigned to" hideLabel placeholder={def.assignee === "not_me" ? "Anyone else" : "Anyone"} defaultValue={query.assignee ?? ""} options={assigneeOptions} />
        ) : null}
        <Select
          name="priority"
          label="Priority"
          hideLabel
          placeholder="Any priority"
          defaultValue={query.priority ?? ""}
          options={PRIORITIES_DESC.map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] }))}
        />
        {def.statusChoices.length > 0 ? (
          <Select
            name="status"
            label="Status"
            hideLabel
            placeholder="Any status"
            defaultValue={query.status && def.statusChoices.includes(query.status) ? query.status : ""}
            options={def.statusChoices.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
          />
        ) : null}
        {canGrowth || canContractors ? (
          <Select
            name="related"
            label="Linked records"
            hideLabel
            placeholder="Any link"
            defaultValue={query.related ?? ""}
            options={RELATED_FILTERS.filter((r) => (r === "contractor" ? canContractors : r === "none" ? true : canGrowth)).map((r) => ({ value: r, label: RELATED_FILTER_LABEL[r] }))}
          />
        ) : null}
      </FilterBar>

      {query.view === "completed" ? (
        <p className="mt-4 text-[14px] text-grey-text">
          {query.older ? "Showing every completed task assigned to you. " : "Showing tasks completed in the last 30 days. "}
          <Link className="underline underline-offset-4 hover:text-charcoal" href={buildHref(PATH, sp, { older: query.older ? null : "1", page: null })}>
            {query.older ? "Show only the last 30 days" : "Show older completed tasks"}
          </Link>
        </p>
      ) : null}

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load tasks"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <TasksTable
              rows={list.data.rows}
              caption={`${def.label}, ${list.data.total} ${list.data.total === 1 ? "task" : "tasks"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              today={today}
              timezone={staff.timezone}
              setStatus={canWrite ? changeTaskStatus : undefined}
              showCompleted={query.view === "completed" || query.view === "all"}
              meId={staff.id}
              empty={empty}
            />
            <Pagination page={list.data.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="task" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
