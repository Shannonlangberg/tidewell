import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { DataTable, ResponsiveTable, type Column, type SortState } from "@/components/hq/DataTable";
import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { MobileList, MobileListItem } from "@/components/hq/MobileList";
import { PageHeader } from "@/components/hq/PageHeader";
import { Tabs } from "@/components/hq/Tabs";
import { buildHref } from "@/components/hq/url";
import { EmploymentChip, staffStanding } from "@/components/hq/features/people/EmploymentChip";
import { PodsPanel, type PodRow } from "@/components/hq/features/people/PodsPanel";
import { requireStaff } from "@/lib/hq/auth";
import { ROLE_LABEL, type EmploymentStatus, type StaffRole } from "@/lib/hq/constants";
import { formatDate } from "@/lib/hq/format";

export const metadata: Metadata = { title: "People" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const PATH = "/hq/people";
const VIEWS = ["current", "former", "all"] as const;
type View = (typeof VIEWS)[number];

type Person = {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  pod_id: string | null;
  employment_status: EmploymentStatus;
  is_active: boolean;
  start_date: string | null;
};

const STANDING_ORDER: Record<EmploymentStatus, number> = { active: 0, on_leave: 1, ended: 2 };
const SORTS: Record<string, (p: Person, podName: (id: string | null) => string) => string> = {
  name: (p) => p.full_name.toLowerCase(),
  role: (p) => ROLE_LABEL[p.role].toLowerCase(),
  pod: (p, podName) => podName(p.pod_id).toLowerCase(),
  status: (p) => String(STANDING_ORDER[staffStanding(p)]),
  start: (p) => p.start_date ?? "9999-12-31",
};

export default async function PeoplePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, db, can } = await requireStaff("people.read");
  const sp = await searchParams;
  const canAdmin = can("people.admin");

  const [peopleRes, podsRes] = await Promise.all([
    db.from("staff_profiles").select("id, full_name, email, role, pod_id, employment_status, is_active, start_date").order("full_name"),
    db.from("pods").select("id, name, region, is_active").order("name"),
  ]);
  if (peopleRes.error) console.error("[hq] reading people failed:", peopleRes.error.code);
  if (podsRes.error) console.error("[hq] reading pods failed:", podsRes.error.code);

  const header = (
    <PageHeader
      title="People"
      description="Everyone who can use Planted HQ, with their role and pod. A role decides what each person can see and change."
      actions={
        canAdmin ? (
          <LinkButton href={`${PATH}/invite`} variant="primary" icon="plus">
            Add a person
          </LinkButton>
        ) : null
      }
    />
  );

  if (peopleRes.error) {
    return (
      <>
        {header}
        <ErrorState className="mt-8" />
      </>
    );
  }

  const people = (peopleRes.data ?? []) as Person[];
  const pods = podsRes.data ?? [];
  const podNameById = new Map(pods.map((p) => [p.id, p.name]));
  const podName = (id: string | null) => (id ? (podNameById.get(id) ?? "") : "");

  const current = people.filter((p) => staffStanding(p) === "active");
  const former = people.filter((p) => staffStanding(p) !== "active");

  const requested = one(sp.view);
  const view: View = (VIEWS as readonly string[]).includes(requested ?? "") ? (requested as View) : "current";
  const shown = view === "all" ? people : view === "former" ? former : current;

  const requestedSort = one(sp.sort) ?? "";
  const sortKey = Object.hasOwn(SORTS, requestedSort) ? requestedSort : "name";
  const dir = one(sp.dir) === "desc" ? -1 : 1;
  const sorted = [...shown].sort((a, b) => {
    const x = SORTS[sortKey](a, podName);
    const y = SORTS[sortKey](b, podName);
    return (x < y ? -1 : x > y ? 1 : a.full_name.localeCompare(b.full_name)) * dir;
  });
  const sort: SortState = { key: sortKey, dir: dir === 1 ? "asc" : "desc" };
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir });

  const columns: Column<Person>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      cell: (p) => (
        <>
          <Link href={`${PATH}/${p.id}`}>{p.full_name}</Link>
          {p.id === staff.id ? <span className="hq-cell-sub">You</span> : <span className="hq-cell-sub">{p.email}</span>}
        </>
      ),
    },
    { key: "role", header: "Role", sortable: true, cell: (p) => ROLE_LABEL[p.role] },
    {
      key: "pod",
      header: "Pod",
      sortable: true,
      hideBelow: "lg",
      cell: (p) => podName(p.pod_id) || <span className="hq-cell-nil">No pod</span>,
    },
    { key: "status", header: "Status", sortable: true, cell: (p) => <EmploymentChip standing={staffStanding(p)} /> },
    {
      key: "start",
      header: "Started",
      sortable: true,
      nowrap: true,
      hideBelow: "xl",
      cell: (p) => (p.start_date ? formatDate(p.start_date, staff.timezone) : <span className="hq-cell-nil">Not recorded</span>),
    },
  ];

  const podRows: PodRow[] = pods.map((p) => ({ ...p, members: people.filter((x) => x.pod_id === p.id).length }));
  const viewHref = (v: View) => buildHref(PATH, sp, { view: v === "current" ? null : v });

  return (
    <>
      {header}
      <div className="mt-8">
        <Tabs
          label="Which people to show"
          items={[
            { label: "Current", href: viewHref("current"), current: view === "current", count: current.length },
            { label: "Former and on leave", href: viewHref("former"), current: view === "former", count: former.length },
            { label: "Everyone", href: viewHref("all"), current: view === "all", count: people.length },
          ]}
        />
        <ResponsiveTable
          className="mt-2"
          table={
            <DataTable
              caption={`People, ${sorted.length} shown`}
              columns={columns}
              rows={sorted}
              rowKey={(p) => p.id}
              sort={sort}
              hrefForSort={hrefForSort}
              empty={
                <EmptyState title="No one to show here">
                  {view === "former" ? "Nobody has left or is on leave." : "Add the first person to start building the team."}
                </EmptyState>
              }
            />
          }
          list={
            <MobileList label="People">
              {sorted.map((p) => (
                <MobileListItem
                  key={p.id}
                  href={`${PATH}/${p.id}`}
                  title={p.full_name}
                  subtitle={[ROLE_LABEL[p.role], podName(p.pod_id)].filter(Boolean).join(" · ")}
                  status={<EmploymentChip standing={staffStanding(p)} />}
                  meta={p.id === staff.id ? "You" : undefined}
                />
              ))}
            </MobileList>
          }
        />
      </div>
      <PodsPanel pods={podRows} canAdmin={canAdmin} />
    </>
  );
}
