import type { Metadata } from "next";
import { DataTable, ResponsiveTable, type Column } from "@/components/hq/DataTable";
import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { FilterBar } from "@/components/hq/FilterBar";
import { MobileList, MobileListItem } from "@/components/hq/MobileList";
import { PageHeader } from "@/components/hq/PageHeader";
import { Pagination } from "@/components/hq/Pagination";
import { Select } from "@/components/hq/Select";
import { requireStaff } from "@/lib/hq/auth";
import { formatDateTime } from "@/lib/hq/format";
import { ENTITY_LABEL, actionLabel, entityLabel } from "@/lib/hq/audit-labels";
import { intParam, isUuid, strParam } from "@/lib/hq/forms";

export const metadata: Metadata = { title: "Audit log" };

type SP = Record<string, string | string[] | undefined>;

const PATH = "/hq/settings/audit";
const PAGE_SIZE = 25;
const SYSTEM = "system";

type Event = {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  summary: string | null;
};

/*
 * The audit log: who changed what, and when. audit.read only (directors and administrators), and the
 * database refuses anyone else whatever this page does. It is append-only: nothing here edits or
 * removes a row. Filters write into the URL, so a filtered view can be bookmarked or shared.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, db } = await requireStaff("audit.read");
  const sp = await searchParams;

  const page = intParam(sp.page, 1, 1, 10_000);
  const entityParam = strParam(sp.entity, 40);
  const entity = Object.hasOwn(ENTITY_LABEL, entityParam) ? entityParam : "";
  const actorParam = strParam(sp.actor, 40);
  const actor = actorParam === SYSTEM || isUuid(actorParam) ? actorParam : "";

  const from = (page - 1) * PAGE_SIZE;
  let query = db
    .from("audit_events")
    .select("id, at, actor_id, actor_name, action, entity_type, summary", { count: "exact" })
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (entity) query = query.eq("entity_type", entity);
  if (actor === SYSTEM) query = query.is("actor_id", null);
  else if (actor) query = query.eq("actor_id", actor);

  const [eventsRes, peopleRes] = await Promise.all([query, db.from("staff_profiles").select("id, full_name").order("full_name")]);
  if (eventsRes.error) console.error("[hq] reading the audit log failed:", eventsRes.error.code);

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Settings", href: "/hq/settings" }, { label: "Audit log" }]}
      title="Audit log"
      description="Who changed what, and when. Nothing here can be edited or deleted."
    />
  );
  if (eventsRes.error) {
    return (
      <>
        {header}
        <ErrorState className="mt-8" />
      </>
    );
  }

  const events = (eventsRes.data ?? []) as Event[];
  const total = eventsRes.count ?? events.length;
  const filtered = Boolean(entity || actor);

  const columns: Column<Event>[] = [
    { key: "at", header: "When", primary: true, nowrap: true, cell: (e) => formatDateTime(e.at, staff.timezone) },
    { key: "who", header: "Who", cell: (e) => e.actor_name ?? "System" },
    { key: "action", header: "Action", nowrap: true, cell: (e) => actionLabel(e.action) },
    { key: "entity", header: "Entity", nowrap: true, hideBelow: "lg", cell: (e) => entityLabel(e.entity_type) },
    { key: "summary", header: "Summary", cell: (e) => e.summary ?? <span className="hq-cell-nil">No summary</span> },
  ];

  return (
    <>
      {header}
      <FilterBar action={PATH} label="Filter the audit log" resetHref={PATH} active={filtered}>
        <Select
          name="entity"
          label="Entity"
          hideLabel
          placeholder="Every kind of record"
          options={Object.entries(ENTITY_LABEL)
            .map(([value, label]) => ({ value, label }))
            .sort((x, y) => x.label.localeCompare(y.label))}
          defaultValue={entity}
        />
        <Select
          name="actor"
          label="Who"
          hideLabel
          placeholder="Everyone"
          options={[{ value: SYSTEM, label: "System (no person)" }, ...(peopleRes.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))]}
          defaultValue={actor}
        />
      </FilterBar>

      <ResponsiveTable
        table={
          <DataTable
            caption={`Audit events, ${total} ${filtered ? "matching" : "in total"}, newest first`}
            columns={columns}
            rows={events}
            rowKey={(e) => String(e.id)}
            empty={
              <EmptyState title={filtered ? "Nothing matches those filters" : "Nothing recorded yet"}>
                {filtered ? "Clear the filters to see every event." : "Changes to people, partners, referrals and tasks are recorded here as they happen."}
              </EmptyState>
            }
          />
        }
        list={
          <MobileList label="Audit events">
            {events.map((e) => (
              <MobileListItem
                key={e.id}
                title={e.summary ?? `${actionLabel(e.action)} ${entityLabel(e.entity_type).toLowerCase()}`}
                subtitle={`${formatDateTime(e.at, staff.timezone)} · ${e.actor_name ?? "System"}`}
              />
            ))}
          </MobileList>
        }
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} pathname={PATH} searchParams={sp} noun="event" />
    </>
  );
}
