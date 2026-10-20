import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { formatDate } from "@/lib/hq/format";
import { HEALTH_LABEL, PROJECT_HEALTHS, PROJECT_STATUSES, PROJECT_STATUS_LABEL, parseProjectListQuery } from "@/lib/hq/projects/rules";
import { listProjects } from "@/lib/hq/projects/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, SearchInput, Select, buildHref } from "@/components/hq";
import { HealthDot, ProgressRule, ProjectStatusDot } from "@/components/hq/features/projects/ProjectParts";

export const metadata: Metadata = { title: "Projects" };

const PATH = "/hq/projects";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Projects: a calm list. One row per project: its name, status and health as a dot and a word, a
 * thin progress rule with "n of m done", the owner, the target date and the next milestone. The
 * figures are the database's (hq.project_overview) and count only the tasks this person can see.
 */
export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("projects.read", false, buildHref(PATH, sp));
  const canWrite = can("projects.write");
  const query = parseProjectListQuery(sp);
  const [list, people] = await Promise.all([listProjects(db, query, staff.id), staffOptions(db)]);

  const newProject = canWrite ? (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
      New project
    </LinkButton>
  ) : null;

  const statusOptions = [{ value: "all", label: "Every status" }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s] }))];

  let body;
  if (!list.ok) {
    body = (
      <ErrorState
        title="We could not load projects"
        action={
          <LinkButton href={buildHref(PATH, sp)} size="sm">
            Try again
          </LinkButton>
        }
      />
    );
  } else if (list.data.length === 0) {
    body = query.filtered ? (
      <EmptyState
        title="No projects match"
        action={
          <LinkButton href={PATH} variant="secondary">
            Clear filters
          </LinkButton>
        }
      >
        Try fewer words, or clear the filters to see every open project.
      </EmptyState>
    ) : (
      <EmptyState title="No projects yet" action={newProject ?? undefined}>
        {canWrite
          ? "A project gathers the tasks, milestones and people behind one piece of work, such as launching the business or bringing on a new area. Start with the one that matters most this quarter."
          : "When someone starts a project, it will appear here with its progress and what is next."}
      </EmptyState>
    );
  } else {
    const rows = list.data;
    const atRisk = rows.filter((p) => p.health === "at_risk" || p.health === "off_track").length;
    body = (
      <>
        <p className="hq-prj-summary">
          {rows.length === 1 ? "1 project" : `${rows.length} projects`}
          {query.status === "open" ? " in progress or planned" : ""}
          {atRisk > 0 ? ` · ${atRisk === 1 ? "1 needs" : `${atRisk} need`} attention` : ""}
        </p>
        <ul className="hq-prj-list" aria-label="Projects">
          {rows.map((p) => (
            <li key={p.id} className="hq-prj-row">
              <div className="min-w-0">
                <p className="hq-prj-row__name">
                  <Link href={`${PATH}/${p.id}`}>{p.name}</Link>
                </p>
                <span className="hq-prj-row__ref">{p.ref}</span>
              </div>
              <div className="hq-prj-row__states">
                <ProjectStatusDot status={p.status} />
                {p.health !== "done" && p.health !== "on_hold" ? <HealthDot health={p.health} /> : null}
              </div>
              <ProgressRule done={p.doneCount} total={p.totalCount} progress={p.progress} label={`${p.name} progress`} />
              <dl className="hq-prj-row__facts">
                <div>
                  <dt className="sr-only">Owner</dt>
                  <dd className="m-0">{p.ownerName ? <b>{p.ownerName}</b> : "No owner"}</dd>
                </div>
                {p.targetDate ? (
                  <div>
                    <dt className="sr-only">Target date</dt>
                    <dd className="m-0">Target {formatDate(p.targetDate)}</dd>
                  </div>
                ) : null}
                {p.nextMilestoneName ? (
                  <div>
                    <dt className="sr-only">Next milestone</dt>
                    <dd className="m-0">
                      Next: {p.nextMilestoneName}
                      {p.nextMilestoneDue ? `, ${formatDate(p.nextMilestoneDue)}` : ""}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Projects" description="The larger pieces of work, how far along each one is, and what comes next." actions={newProject} />

      <FilterBar
        action={PATH}
        label="Search and filter projects"
        resetHref={PATH}
        active={query.filtered}
        more={
          <>
            <Select name="status" label="Status" hideLabel placeholder="Open projects" defaultValue={query.status === "open" ? "" : query.status} options={statusOptions} />
            <Select name="owner" label="Owner" hideLabel placeholder="Any owner" defaultValue={query.owner ?? ""} options={[{ value: "me", label: "Me" }, ...people.filter((o) => o.value !== staff.id)]} />
            <Select name="health" label="Health" hideLabel placeholder="Any health" defaultValue={query.health ?? ""} options={PROJECT_HEALTHS.map((h) => ({ value: h, label: HEALTH_LABEL[h] }))} />
          </>
        }
        moreActive={query.status !== "open" || query.owner !== null || query.health !== null}
        moreLabel="Filter"
      >
        <SearchInput placeholder="Search projects" defaultValue={query.q} label="Search projects" />
      </FilterBar>

      <div className="mt-8">{body}</div>
    </>
  );
}
