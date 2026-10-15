import type { Metadata } from "next";
import { CATEGORY_LABEL, PARTNER_CATEGORIES } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { LIST_PAGE_SIZE } from "@/lib/hq/growth/params";
import { listOrganisations, organisationListQuery, organisationRegionChoices } from "@/lib/hq/organisations/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, SearchInput, Select, buildHref, type SortState } from "@/components/hq";
import { OrganisationsTable } from "@/components/hq/features/organisations/OrganisationsTable";

export const metadata: Metadata = { title: "Organisations" };

const PATH = "/hq/growth/organisations";

const SORT_LABEL: Record<string, string> = { name: "name", region: "region", contacts: "number of contacts", owner: "owner", last_contact: "last interaction" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function OrganisationsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const query = organisationListQuery(sp);
  const canWrite = can("growth.write");
  const canImport = can("import.run");

  const [list, regions, staffList] = await Promise.all([listOrganisations(db, query, { staffId: staff.id }), organisationRegionChoices(db), staffOptions(db)]);

  const sort: SortState = { key: query.sort, dir: query.dir };
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null });
  const ownerValue = query.owner ? (query.owner.kind === "staff" ? query.owner.id : query.owner.kind) : "";
  const regionOptions = [...new Set([...(query.region ? [query.region] : []), ...regions])].sort((a, b) => a.localeCompare(b, "en-AU"));
  const noneAtAll = list.ok && list.data.total === 0 && !query.filtered;

  const empty = noneAtAll ? (
    <EmptyState
      title="No organisations yet"
      action={
        canWrite || canImport ? (
          <span className="flex flex-wrap justify-center gap-3">
            {canWrite ? (
              <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                Add organisation
              </LinkButton>
            ) : null}
            {canImport ? <LinkButton href="/hq/growth/import">Import contacts</LinkButton> : null}
          </span>
        ) : undefined
      }
    >
      {canWrite || canImport
        ? "Add the agencies, brokers and firms you work with, or import a list of research leads. Organisations are also created when you add a contact."
        : "Nothing has been added yet. Someone with write access can add organisations or import a list."}
    </EmptyState>
  ) : (
    <EmptyState
      title="No organisations match those filters"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try a shorter search, or clear the filters to see every organisation.
    </EmptyState>
  );

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Organisations"
        description="The agencies, brokers and firms your referral partners work for, with who you know at each and how often you have been in touch."
        actions={
          canWrite ? (
            <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
              Add organisation
            </LinkButton>
          ) : undefined
        }
      />

      <FilterBar
        action={PATH}
        label="Filter organisations"
        hidden={{ sort: query.sort === "name" && query.dir === "asc" ? undefined : query.sort, dir: query.sort === "name" && query.dir === "asc" ? undefined : query.dir }}
        resetHref={PATH}
        active={query.filtered}
      >
        <SearchInput placeholder="Search by organisation name" defaultValue={query.q} />
        <Select name="category" label="Category" hideLabel placeholder="All categories" defaultValue={query.category ?? ""} options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} />
        <Select name="region" label="Service region" hideLabel placeholder="Any region" defaultValue={query.region ?? ""} options={regionOptions.map((r) => ({ value: r, label: r }))} />
        <Select
          name="owner"
          label="Relationship owner"
          hideLabel
          placeholder="Any owner"
          defaultValue={ownerValue}
          options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id).map((s) => ({ value: s.value, label: s.label }))]}
        />
        <Select
          name="verify"
          label="Verification"
          hideLabel
          placeholder="Any verification"
          defaultValue={query.verify ?? ""}
          options={[
            { value: "needs", label: "Needs verifying" },
            { value: "verified", label: "Not flagged" },
          ]}
        />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load organisations"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <OrganisationsTable
              rows={list.data.rows}
              referrals={list.data.referrals}
              caption={`Organisations, ${list.data.total} ${list.data.total === 1 ? "result" : "results"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              timezone={staff.timezone}
              empty={empty}
            />
            <Pagination page={list.data.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="organisation" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
