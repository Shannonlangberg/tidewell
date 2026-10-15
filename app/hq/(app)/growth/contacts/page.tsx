import type { Metadata } from "next";
import {
  CATEGORY_LABEL,
  PARTNER_CATEGORIES,
  PRIORITIES,
  PRIORITY_LABEL,
  RELATIONSHIP_LABEL,
  RELATIONSHIP_STATUSES,
} from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { contactCounts, contactListQuery, listContacts, regionChoices } from "@/lib/hq/contacts/queries";
import { nowLocalInput, todayInZone } from "@/lib/hq/growth/dates";
import { LIST_PAGE_SIZE, STALE_DAY_CHOICES, parseLogParam } from "@/lib/hq/growth/params";
import { contactOptions, staffOptions } from "@/lib/hq/queries/options";
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
  buildHref,
  type SortState,
} from "@/components/hq";
import { ContactsTable } from "@/components/hq/features/contacts/ContactsTable";
import { LogInteractionDrawer } from "@/components/hq/features/contacts/LogInteractionDrawer";

export const metadata: Metadata = { title: "Contacts" };

const PATH = "/hq/growth/contacts";

const SORT_LABEL: Record<string, string> = {
  name: "name",
  organisation: "organisation",
  status: "status",
  priority: "priority",
  owner: "owner",
  last_contact: "last contact",
  follow_up: "next follow-up",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));

  const query = contactListQuery(sp);
  const canWrite = can("growth.write");
  const canImport = can("import.run");
  const logOpen = parseLogParam(sp.log) !== null && canWrite;
  const today = todayInZone(staff.timezone);

  const [list, counts, regions, staffList, pickerContacts] = await Promise.all([
    listContacts(db, query, { staffId: staff.id }),
    contactCounts(db),
    regionChoices(db),
    staffOptions(db),
    logOpen ? contactOptions(db) : Promise.resolve([]),
  ]);

  const sort: SortState = { key: query.sort, dir: query.dir };
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null });

  const ownerValue = query.owner ? (query.owner.kind === "staff" ? query.owner.id : query.owner.kind) : "";
  const regionOptions = [...new Set([...(query.region ? [query.region] : []), ...regions])].sort((a, b) => a.localeCompare(b, "en-AU"));
  const total = counts.ok ? counts.data.total : null;

  const emptyState =
    total === 0 && !query.filtered ? (
      <EmptyState
        title="No contacts yet"
        action={
          canWrite || canImport ? (
            <span className="flex flex-wrap justify-center gap-3">
              {canWrite ? (
                <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                  Add contact
                </LinkButton>
              ) : null}
              {canImport ? <LinkButton href="/hq/growth/import">Import contacts</LinkButton> : null}
            </span>
          ) : undefined
        }
      >
        {canWrite || canImport
          ? "Add the first person you work with, or import a list of research leads. Everyone you add appears here, and each call you log builds their relationship history."
          : "Nobody has been added yet. Someone with write access can add contacts or import a list."}
      </EmptyState>
    ) : (
      <EmptyState
        title="No contacts match those filters"
        action={
          <LinkButton href={PATH} variant="secondary">
            Clear filters
          </LinkButton>
        }
      >
        Try a shorter search, or clear the filters to see everyone.
      </EmptyState>
    );

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Contacts"
        description="The people at your referral partners. Log a call or meeting each time, so everyone at an organisation knows who has spoken to whom."
        actions={
          <>
            {canImport ? <LinkButton href="/hq/growth/import">Import</LinkButton> : null}
            {canWrite ? (
              <LinkButton href={buildHref(PATH, sp, { log: "call" })} icon="phone">
                Log a call
              </LinkButton>
            ) : null}
            {canWrite ? (
              <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                Add contact
              </LinkButton>
            ) : null}
          </>
        }
      />

      {counts.ok ? (
        <StatBand label="Contacts at a glance" columns={4} className="mb-8">
          <Stat label="Contacts" value={counts.data.total} hint="Everyone currently listed." href={PATH} />
          <Stat label="Need verifying" value={counts.data.needsVerification} hint="Research leads not yet confirmed." href={buildHref(PATH, {}, { verify: "needs" })} />
          <Stat label="Follow-ups overdue" value={counts.data.overdue} hint="The follow-up date has passed." href={buildHref(PATH, {}, { followup: "overdue" })} />
          <Stat label="Quiet for 30+ days" value={counts.data.notContacted30} hint="Not contacted, or not for a month." href={buildHref(PATH, {}, { stale: 30 })} />
        </StatBand>
      ) : null}

      <FilterBar
        action={PATH}
        label="Filter contacts"
        hidden={{ sort: query.sort === "name" && query.dir === "asc" ? undefined : query.sort, dir: query.sort === "name" && query.dir === "asc" ? undefined : query.dir }}
        resetHref={PATH}
        active={query.filtered}
        moreActive={Boolean(query.region || ownerValue || query.followUp || query.staleDays || query.verify)}
        more={
          <>
            <Select name="region" label="Service region" hideLabel placeholder="Any region" defaultValue={query.region ?? ""} options={regionOptions.map((r) => ({ value: r, label: r }))} />
            <Select
              name="owner"
              label="Relationship owner"
              hideLabel
              placeholder="Any owner"
              defaultValue={ownerValue}
              options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id).map((s) => ({ value: s.value, label: s.label }))]}
            />
            <Select name="followup" label="Follow-up" hideLabel placeholder="Any follow-up" defaultValue={query.followUp ?? ""} options={[{ value: "overdue", label: "Follow-up overdue" }]} />
            <Select
              name="stale"
              label="Last contact"
              hideLabel
              placeholder="Any last contact"
              defaultValue={query.staleDays ? String(query.staleDays) : ""}
              options={STALE_DAY_CHOICES.map((d) => ({ value: String(d), label: `Not contacted in ${d}+ days` }))}
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
          </>
        }
      >
        <SearchInput placeholder="Search by name, organisation or email" defaultValue={query.q} />
        <Select
          name="category"
          label="Category"
          hideLabel
          placeholder="All categories"
          defaultValue={query.category ?? ""}
          options={PARTNER_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
        />
        <Select
          name="status"
          label="Relationship status"
          hideLabel
          placeholder="All statuses"
          defaultValue={query.status ?? ""}
          options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABEL[s] }))}
        />
        <Select name="priority" label="Priority" hideLabel placeholder="Any priority" defaultValue={query.priority ?? ""} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load contacts"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <ContactsTable
              rows={list.data.rows}
              caption={`Contacts, ${list.data.total} ${list.data.total === 1 ? "result" : "results"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              timezone={staff.timezone}
              today={today}
              empty={emptyState}
            />
            <Pagination page={list.data.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="contact" className="mt-6" />
          </>
        )}
      </div>

      {canWrite ? (
        <LogInteractionDrawer
          contact={null}
          organisation={null}
          contactOptions={pickerContacts}
          staffOptions={staffList}
          canCreateTasks={can("tasks.write")}
          staffId={staff.id}
          timezone={staff.timezone}
          serverNowLocal={nowLocalInput(staff.timezone)}
          today={today}
          returnTo="list"
        />
      ) : null}
    </>
  );
}
