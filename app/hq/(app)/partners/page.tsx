import type { Metadata } from "next";
import {
  CONTRACTOR_CATEGORIES,
  CONTRACTOR_CATEGORY_LABEL,
  CONTRACTOR_EXPIRY_STATES,
  CONTRACTOR_EXPIRY_STATE_LABEL,
  CONTRACTOR_STATUSES,
  CONTRACTOR_STATUS_LABEL,
} from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { directoryCounts, directoryQuery, listContractors, placeChoices } from "@/lib/hq/contractors/queries";
import { DIRECTORY_PAGE_SIZE, STATUS_FILTER_CLEARED } from "@/lib/hq/contractors/params";
import {
  EmptyState,
  ErrorState,
  FilterBar,
  LinkButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Stat,
  StatBand,
  Tabs,
  TextInput,
  buildHref,
  type SortState,
} from "@/components/hq";
import { ContractorsTable } from "@/components/hq/features/contractors/ContractorsTable";

export const metadata: Metadata = { title: "Contractors" };

const PATH = "/hq/partners";

const SORT_LABEL: Record<string, string> = {
  name: "business name",
  status: "status",
  vetting: "vetting progress",
  insurance: "insurance expiry",
  licence: "licence expiry",
  owner: "owner",
  rating: "rating",
  contacted: "last contact",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContractorDirectoryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("contractors.read", false, buildHref(PATH, sp));

  const query = directoryQuery(sp);
  const canWrite = can("contractors.write");
  const canImport = can("import.run") && canWrite;

  const [list, counts, places] = await Promise.all([listContractors(db, query), directoryCounts(db), placeChoices(db)]);

  const sort: SortState = { key: query.sort, dir: query.dir };
  const defaultSort = query.sort === "name" && query.dir === "asc";
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null });
  const regionOptions = [...new Set([...(query.region ? [query.region] : []), ...places.regions])].sort((a, b) => a.localeCompare(b, "en-AU"));
  const total = counts.ok ? counts.data.total : null;

  const chipHref = (chip: string | null) => buildHref(PATH, sp, { chip, page: null });

  const emptyState =
    total === 0 && !query.filtered ? (
      <EmptyState
        title="No contractors yet"
        action={
          canWrite || canImport ? (
            <span className="flex flex-wrap justify-center gap-3">
              {canWrite ? (
                <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                  Add contractor
                </LinkButton>
              ) : null}
              {canImport ? <LinkButton href={`${PATH}/import`}>Import contractors</LinkButton> : null}
            </span>
          ) : undefined
        }
      >
        {canWrite || canImport
          ? "Add the first contractor you work with, or load the maintenance prospects file. Nobody is approved to be sent to a property until a person has completed vetting."
          : "Nobody has been added yet. Someone with write access can add a contractor or import a list."}
      </EmptyState>
    ) : (
      <EmptyState
        title="No contractors match those filters"
        action={
          <LinkButton href={PATH} variant="secondary">
            Clear filters
          </LinkButton>
        }
      >
        {query.status === STATUS_FILTER_CLEARED
          ? "Only approved and preferred contractors are listed here. Contractors still being vetted are not included. Try another trade or suburb, or clear the filters."
          : "Try a shorter search, or clear the filters to see everyone."}
      </EmptyState>
    );

  return (
    <>
      <PageHeader
        eyebrow="Partners"
        title="Contractors"
        description="The maintenance contractors Planted may send to a property, and the paperwork that clears them. Nobody is approved until a person has checked them and said so."
        actions={
          <>
            {canImport ? <LinkButton href={`${PATH}/import`}>Import</LinkButton> : null}
            {canWrite ? (
              <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                Add contractor
              </LinkButton>
            ) : null}
          </>
        }
      />

      {counts.ok ? (
        <StatBand label="Contractors at a glance" columns={4} className="mb-8">
          <Stat label="Contractors" value={counts.data.total} hint="Everyone currently listed." href={PATH} />
          <Stat label="Approved or preferred" value={counts.data.cleared} hint="Cleared to be sent to a property." href={buildHref(PATH, {}, { status: STATUS_FILTER_CLEARED })} />
          <Stat label="Awaiting vetting" value={counts.data.awaiting} hint="In vetting, or part-way through the checklist." href={buildHref(PATH, {}, { chip: "awaiting" })} />
          <Stat
            label="Expired or expiring"
            value={counts.data.expired + counts.data.expiring}
            hint={`Licences, insurance and documents: ${counts.data.expired} expired, ${counts.data.expiring} expiring soon.`}
            href={buildHref(PATH, {}, { chip: "expiring" })}
          />
        </StatBand>
      ) : null}

      <Tabs
        label="Quick views"
        className="mb-6"
        items={[
          { label: "All contractors", href: chipHref(null), current: query.chip === null },
          { label: "Awaiting vetting", href: chipHref("awaiting"), current: query.chip === "awaiting", count: counts.ok ? counts.data.awaiting : null },
          { label: "Expiring soon", href: chipHref("expiring"), current: query.chip === "expiring" },
          { label: "Preferred", href: chipHref("preferred"), current: query.chip === "preferred", count: counts.ok ? counts.data.preferred : null },
        ]}
      />

      <FilterBar
        action={PATH}
        label="Filter contractors"
        hidden={{ chip: query.chip ?? undefined, sort: defaultSort ? undefined : query.sort, dir: defaultSort ? undefined : query.dir }}
        resetHref={query.chip ? buildHref(PATH, {}, { chip: query.chip }) : PATH}
        active={query.filtered && Boolean(query.q || query.trade || query.suburb || query.region || query.status || query.emergency || query.insurance || query.licence)}
        moreActive={Boolean(query.region || query.emergency || query.insurance || query.licence)}
        more={
          <>
            <Select name="region" label="Service region" hideLabel placeholder="Any region" defaultValue={query.region ?? ""} options={regionOptions.map((r) => ({ value: r, label: r }))} />
            <Select
              name="emergency"
              label="Emergency call-outs"
              hideLabel
              placeholder="Any emergency answer"
              defaultValue={query.emergency ?? ""}
              options={[
                { value: "yes", label: "Does emergency call-outs" },
                { value: "no", label: "No emergency call-outs" },
                { value: "unknown", label: "Emergency answer not known" },
              ]}
            />
            <Select
              name="insurance"
              label="Insurance"
              hideLabel
              placeholder="Any insurance state"
              defaultValue={query.insurance ?? ""}
              options={CONTRACTOR_EXPIRY_STATES.map((s) => ({ value: s, label: `Insurance: ${CONTRACTOR_EXPIRY_STATE_LABEL[s].toLowerCase()}` }))}
            />
            <Select
              name="licence"
              label="Licence"
              hideLabel
              placeholder="Any licence state"
              defaultValue={query.licence ?? ""}
              options={CONTRACTOR_EXPIRY_STATES.map((s) => ({ value: s, label: `Licence: ${CONTRACTOR_EXPIRY_STATE_LABEL[s].toLowerCase()}` }))}
            />
          </>
        }
      >
        <SearchInput placeholder="Search by business, contact, email or ABN" defaultValue={query.q} />
        <Select
          name="trade"
          label="Trade"
          hideLabel
          placeholder="All trades"
          defaultValue={query.trade ?? ""}
          options={CONTRACTOR_CATEGORIES.map((c) => ({ value: c, label: CONTRACTOR_CATEGORY_LABEL[c] }))}
        />
        <Select
          name="status"
          label="Status"
          hideLabel
          placeholder="All statuses"
          defaultValue={query.status ?? ""}
          options={[
            { value: STATUS_FILTER_CLEARED, label: "Approved or preferred" },
            ...CONTRACTOR_STATUSES.map((s) => ({ value: s, label: CONTRACTOR_STATUS_LABEL[s] })),
          ]}
        />
        <div>
          <TextInput name="suburb" label="Suburb serviced" hideLabel placeholder="Suburb serviced" list="partner-suburbs" defaultValue={query.suburb ?? ""} maxLength={80} />
          <datalist id="partner-suburbs">
            {places.suburbs.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load contractors"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <ContractorsTable
              rows={list.data.rows}
              caption={`Contractors, ${list.data.total} ${list.data.total === 1 ? "result" : "results"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              timezone={staff.timezone}
              empty={emptyState}
            />
            <Pagination page={list.data.page} pageSize={DIRECTORY_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="contractor" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
