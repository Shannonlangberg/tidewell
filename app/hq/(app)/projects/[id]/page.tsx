import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { formatDate } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { contactOptions, organisationOptions, staffOptions } from "@/lib/hq/queries/options";
import { PROJECT_VIEWS, PROJECT_VIEW_LABEL, TASK_PRIORITY_WORD, TASK_STATUS_WORD, filterProjectTasks, parseProjectViewQuery } from "@/lib/hq/projects/rules";
import { dependencyMap, getProject, projectActivity, projectDocuments, projectLinks, projectMilestones, projectTasks } from "@/lib/hq/projects/queries";
import { buildTimeline } from "@/lib/hq/projects/timeline";
import { ErrorState, FilterBar, InlineNote, LinkButton, PageHeader, Select, Tabs, buildHref, type TabItem } from "@/components/hq";
import { HealthDot, ProjectStatusDot } from "@/components/hq/features/projects/ProjectParts";
import { ProjectOverview } from "@/components/hq/features/projects/ProjectOverview";
import { ProjectListView } from "@/components/hq/features/projects/ProjectListView";
import { ProjectBoard } from "@/components/hq/features/projects/ProjectBoard";
import { ProjectTimeline } from "@/components/hq/features/projects/ProjectTimeline";
import { MilestoneForm } from "@/components/hq/features/projects/ProjectForms";
import { changeTaskStatus } from "../../operations/actions";
import { addProjectDocument, addProjectLink, addProjectTask, createMilestone, removeProjectDocument, removeProjectLink, restoreProject, setMilestoneDone, setTaskField } from "../actions";

export const metadata: Metadata = { title: "Project" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * One project, four views by ?view= (overview by default): Overview, List, Board, Timeline. Every
 * read runs as the person: projects need projects.read; the tasks inside follow the task rule, so a
 * private task is absent and every figure counts only what this person can see. Writing controls
 * appear only with tasks.write (task edits) or projects.write (milestones, links, documents); the
 * Server Actions check again and the database has the last word.
 */
export default async function ProjectPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const path = `/hq/projects/${id}`;
  const { db, staff, can } = await requireStaff("projects.read", false, isUuid(id) ? buildHref(path, sp) : "/hq/projects");
  if (!isUuid(id)) notFound();

  const canWriteProject = can("projects.write");
  const canWriteTasks = can("tasks.write");
  const q = parseProjectViewQuery(sp);

  const todayRpc = await db.rpc("today");
  const today = typeof todayRpc.data === "string" ? todayRpc.data : new Date().toISOString().slice(0, 10);

  const [found, ms, ts] = await Promise.all([getProject(db, id), projectMilestones(db, id), projectTasks(db, id)]);
  if (!found.ok || !ms.ok || !ts.ok) {
    return (
      <>
        <PageHeader title="Project" breadcrumbs={[{ label: "Projects", href: "/hq/projects" }, { label: "Project" }]} />
        <ErrorState
          title="We could not load this project"
          action={
            <LinkButton href={buildHref(path, sp)} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data) notFound();
  const { project: p, archived } = found.data;
  const milestones = ms.data;
  const tasks = ts.data;

  const tabs: TabItem[] = PROJECT_VIEWS.map((v) => ({
    label: PROJECT_VIEW_LABEL[v],
    href: buildHref(path, {}, { view: v === "overview" ? null : v }),
    current: v === q.view,
    count: v === "list" ? tasks.length : null,
  }));

  let body: ReactNode = null;
  if (q.view === "overview") {
    const blockedIds = tasks.filter((t) => t.blocked).map((t) => t.id);
    const [blockers, links, documents, activity, contacts, organisations] = await Promise.all([
      dependencyMap(db, blockedIds),
      projectLinks(db, id, { canGrowth: can("growth.read"), canContractors: can("contractors.read") }),
      projectDocuments(db, id),
      projectActivity(db, id, 12),
      canWriteProject && can("growth.read") ? contactOptions(db, 300) : Promise.resolve([]),
      canWriteProject && can("growth.read") ? organisationOptions(db, 300) : Promise.resolve([]),
    ]);
    const linked = new Set(links.map((l) => l.targetId));
    body = (
      <ProjectOverview
        project={p}
        milestones={milestones}
        tasks={tasks}
        blockers={blockers}
        links={links}
        documents={documents}
        activity={activity}
        today={today}
        timezone={staff.timezone}
        canWriteProject={canWriteProject && !archived}
        linkOptions={{ contacts: contacts.filter((c) => !linked.has(c.value)), organisations: organisations.filter((o) => !linked.has(o.value)) }}
        actions={{ setMilestoneDone, addLink: addProjectLink, removeLink: removeProjectLink, addDocument: addProjectDocument, removeDocument: removeProjectDocument }}
      />
    );
  } else if (q.view === "list") {
    const people = canWriteTasks ? await staffOptions(db) : [];
    const shown = filterProjectTasks(tasks, q, staff.id);
    const groupHref = (g: "milestone" | "status") => buildHref(path, sp, { group: g === "milestone" ? null : g });
    const statusOptions = [{ value: "all", label: "Every status" }, ...(["to_do", "in_progress", "waiting", "completed", "cancelled"] as const).map((s) => ({ value: s, label: TASK_STATUS_WORD[s] }))];
    body = (
      <>
        <div className="hq-prj-toolbar">
          <nav className="hq-prj-seg" aria-label="Group tasks by">
            <Link href={groupHref("milestone")} aria-current={q.group === "milestone" ? "true" : undefined}>
              By milestone
            </Link>
            <Link href={groupHref("status")} aria-current={q.group === "status" ? "true" : undefined}>
              By status
            </Link>
          </nav>
        </div>
        <FilterBar
          action={path}
          label="Filter tasks"
          hidden={{ view: "list", group: q.group === "status" ? "status" : null }}
          resetHref={buildHref(path, {}, { view: "list", group: q.group === "status" ? "status" : null })}
          active={q.filtered}
        >
          <Select name="status" label="Status" hideLabel placeholder="Open tasks" defaultValue={q.status === "open" ? "" : q.status} options={statusOptions} />
          <Select
            name="assignee"
            label="Assigned to"
            hideLabel
            placeholder="Anyone"
            defaultValue={q.assignee ?? ""}
            options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...people.filter((o) => o.value !== staff.id)]}
          />
          <Select name="priority" label="Priority" hideLabel placeholder="Any priority" defaultValue={q.priority ?? ""} options={(["urgent", "high", "normal", "low"] as const).map((x) => ({ value: x, label: TASK_PRIORITY_WORD[x] }))} />
          <Select name="blocked" label="Blocked" hideLabel placeholder="Blocked or not" defaultValue={q.blockedOnly ? "1" : ""} options={[{ value: "1", label: "Only blocked" }]} />
        </FilterBar>
        <ProjectListView
          projectId={p.id}
          tasks={shown}
          allTasks={tasks}
          milestones={milestones}
          group={q.group}
          today={today}
          canWriteTasks={canWriteTasks && !archived}
          canWriteProject={canWriteProject && !archived}
          staff={people}
          setStatus={changeTaskStatus}
          setField={setTaskField}
          addTask={addProjectTask}
          setMilestoneDone={setMilestoneDone}
          filtered={q.filtered}
        />
        {canWriteProject && !archived ? (
          <details className="hq-prj-newms">
            <summary>Add a milestone</summary>
            <MilestoneForm projectId={p.id} action={createMilestone} returnView="list" />
          </details>
        ) : null}
      </>
    );
  } else if (q.view === "board") {
    body = <ProjectBoard tasks={tasks.filter((t) => t.status !== "cancelled")} today={today} setStatus={canWriteTasks && !archived ? changeTaskStatus : undefined} cancelledCount={tasks.filter((t) => t.status === "cancelled").length} />;
  } else {
    const deps = await dependencyMap(
      db,
      tasks.filter((t) => t.dependsOnCount > 0).map((t) => t.id),
    );
    const model = buildTimeline({
      projectStart: p.startDate,
      projectTarget: p.targetDate,
      today,
      milestones: milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate, done: m.status === "done" })),
      tasks: tasks
        .filter((t) => t.status !== "cancelled")
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueDate: t.dueDate,
          createdAt: t.createdAt,
          milestoneId: t.milestoneId ?? (t.parentId ? (tasks.find((x) => x.id === t.parentId)?.milestoneId ?? null) : null),
          after: (deps.get(t.id)?.visible ?? []).map((d) => ({ title: d.title, dueDate: d.dueDate })),
        })),
    });
    body = <ProjectTimeline model={model} today={today} />;
  }

  return (
    <>
      <PageHeader
        className="hq-prj-head"
        breadcrumbs={[{ label: "Projects", href: "/hq/projects" }, { label: p.ref }]}
        eyebrow={p.ref}
        title={p.name}
        meta={
          <span className="hq-prj-meta">
            <ProjectStatusDot status={p.status} />
            {p.health !== "done" && p.health !== "on_hold" ? <HealthDot health={p.health} /> : null}
            {p.ownerName ? <span>Owner {p.ownerName}</span> : null}
            {p.targetDate ? <span>Target {formatDate(p.targetDate)}</span> : null}
          </span>
        }
        actions={
          canWriteProject && !archived ? (
            <LinkButton href={`${path}/edit`} icon="note">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {archived ? (
        <InlineNote className="mb-6">
          This project is archived: it is not in the list.{" "}
          {canWriteProject ? (
            <form action={restoreProject} className="inline">
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className="underline underline-offset-4">
                Restore it
              </button>
            </form>
          ) : null}
        </InlineNote>
      ) : null}

      <Tabs label="Project views" items={tabs} className="hq-prj-views" />

      {body}
    </>
  );
}
