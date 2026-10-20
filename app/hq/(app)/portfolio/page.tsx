import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { AILO_STATUSES, AILO_STATUS_LABEL, LIST_PAGE_SIZE, MANAGED_STATUSES, MANAGED_STATUS_LABEL, SERVICE_TYPES, SERVICE_TYPE_LABEL, managedOfGoalText, parsePortfolioListQuery, serviceSplitText } from "@/lib/hq/portfolio/rules";
import { listProperties, loadBusinessSummary } from "@/lib/hq/portfolio/queries";
import { Checkbox, EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, SearchInput, Select, buildHref } from "@/components/hq";
import { PropertiesTable } from "@/components/hq/features/portfolio/PortfolioParts";

export const metadata: Metadata = { title: "Properties" };

const PATH = "/hq/portfolio";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Properties: the managed portfolio. A light HQ record per property (owner, service, fee, dates,
 * status, Ailo reference) and its handover progress. Ailo holds the rest. Read as the signed-in
 * person (portfolio.read; RLS decides). The header line is the goal: "Managed 3 of 20".
 */
export default async function PortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, can } = await requireStaff("portfolio.read", false, buildHref(PATH, sp));
  const canWrite = can("portfolio.write");

  const query = parsePortfolioListQuery(sp);
  const [list, summary] = await Promise.all([
    listProperties(db, query, { offset: (query.page - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE }),
    loadBusinessSummary(db),
  ]);
  const m = summary.ok ? summary.data.managed : null;
  const goalLine =
    summary.ok && m ? `${managedOfGoalText(m.managed, summary.data.goal.target)}${m.managed > 0 ? `: ${serviceSplitText(m.longTerm.managed, m.shortTerm.managed)}` : ""}.` : null;

  const add = canWrite ? (
    <LinkButton href={`${PATH}/new`} icon="plus">
      Add a property signed before HQ
    </LinkButton>
  ) : null;

  const empty = query.filtered ? (
    <EmptyState
      title="No properties match"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try fewer words, or clear the filters to see the whole portfolio.
    </EmptyState>
  ) : (
    <EmptyState title="No managed properties recorded yet" action={add ?? undefined}>
      {canWrite
        ? "When a lead signs, open it and choose “Make this a managed property”. A property signed before HQ can be added here."
        : "When a signed management is set up as a managed property, it will appear here with its handover progress."}
    </EmptyState>
  );

  return (
    <>
      <PageHeader
        title="Properties"
        description={goalLine ?? "The properties Planted manages. Rent, trust accounting and maintenance stay in Ailo."}
        actions={add}
      />

      <FilterBar
        action={PATH}
        label="Search and filter properties"
        resetHref={PATH}
        active={query.filtered}
        more={
          <>
            <Select
              name="status"
              label="Status"
              hideLabel
              placeholder="Any status"
              defaultValue={query.status ?? ""}
              options={MANAGED_STATUSES.map((s) => ({ value: s, label: MANAGED_STATUS_LABEL[s] }))}
            />
            <Select
              name="service"
              label="Service"
              hideLabel
              placeholder="Any service"
              defaultValue={query.service ?? ""}
              options={SERVICE_TYPES.map((s) => ({ value: s, label: SERVICE_TYPE_LABEL[s] }))}
            />
            <Select name="ailo" label="Ailo" hideLabel placeholder="Any Ailo status" defaultValue={query.ailo ?? ""} options={AILO_STATUSES.map((s) => ({ value: s, label: `Ailo: ${AILO_STATUS_LABEL[s].toLowerCase()}` }))} />
            <Checkbox name="handover" value="open" label="Handover not finished" defaultChecked={query.handoverOpen} />
          </>
        }
        moreActive={query.moreActive}
        moreLabel="Filter"
      >
        <SearchInput placeholder="Search address, owner, Ailo reference or MP-0001" defaultValue={query.q} label="Search properties" />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load the properties"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <PropertiesTable rows={list.data.rows} caption={`Managed properties, ${list.data.total} ${list.data.total === 1 ? "property" : "properties"}, newest first`} empty={empty} />
            <Pagination page={query.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="property record" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
