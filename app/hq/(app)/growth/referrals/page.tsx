import type { Metadata } from "next";
import { OPPORTUNITY_STAGES, STAGE_LABEL } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { REFERRALS_PAGE_SIZE, parseReferralListParams, REFERRAL_SORT_COLUMNS } from "@/lib/hq/referrals/params";
import { listReferrals, referralPartnerOptions } from "@/lib/hq/referrals/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { todayIn } from "@/lib/hq/format";
import {
  DateInput,
  EmptyState,
  ErrorState,
  FilterBar,
  LinkButton,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  buildHref,
  type SortState,
} from "@/components/hq";
import { ReferralsTable } from "@/components/hq/features/referrals/ReferralsTable";

export const metadata: Metadata = { title: "Referrals" };

const PATH = "/hq/growth/referrals";

const SORT_LABEL: Record<keyof typeof REFERRAL_SORT_COLUMNS, string> = {
  ref: "reference",
  date: "date",
  prospect: "prospect",
  partner: "partner",
  stage: "stage",
  value: "estimate",
  signed: "signed date",
  assigned: "assigned to",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReferralRegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const canWrite = can("growth.write");
  const query = parseReferralListParams(sp);
  const today = todayIn(staff.timezone);

  const [list, partners, staffList] = await Promise.all([
    listReferrals(db, query, { staffId: staff.id }),
    referralPartnerOptions(db),
    staffOptions(db),
  ]);

  const sort: SortState = { key: query.sort, dir: query.dir };
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null });
  const defaultSort = query.sort === "date" && query.dir === "desc";
  const assignedValue = query.assigned ? (query.assigned.kind === "staff" ? query.assigned.id : query.assigned.kind) : "";

  // A partner in the URL that is no longer in the list (archived) must still be shown as chosen.
  const partnerChoices = query.partner && !partners.some((p) => p.value === query.partner) ? [{ value: query.partner, label: "Selected partner" }, ...partners] : partners;

  const recordAction = canWrite ? (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
      Record a referral
    </LinkButton>
  ) : undefined;

  const empty =
    list.ok && list.data.total === 0 && !query.filtered ? (
      <EmptyState title="No referrals recorded yet" action={recordAction}>
        {canWrite
          ? "Record an introduction from a partner, or one you have sent to them. Each one you add appears here, and a received referral becomes a prospect in the pipeline."
          : "Nothing has been recorded yet. Someone with write access can record the first introduction."}
      </EmptyState>
    ) : (
      <EmptyState
        title="No referrals match those filters"
        action={
          <LinkButton href={PATH} variant="secondary">
            Clear filters
          </LinkButton>
        }
      >
        Try a shorter search, a wider date range, or clear the filters to see every referral.
      </EmptyState>
    );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Referrals" }]}
        title="Referrals"
        description="Every introduction, received from partners and sent to them. A signed management is counted once, credited to the partner who first introduced the prospect."
        actions={
          <>
            <LinkButton href="/hq/growth/pipeline">Pipeline</LinkButton>
            {recordAction}
          </>
        }
      />

      <FilterBar
        action={PATH}
        label="Filter referrals"
        hidden={{ sort: defaultSort ? undefined : query.sort, dir: defaultSort ? undefined : query.dir }}
        resetHref={PATH}
        active={query.filtered}
      >
        <SearchInput placeholder="Search by prospect, reference or partner" defaultValue={query.q} />
        <Select
          name="direction"
          label="Direction"
          hideLabel
          placeholder="Received and sent"
          defaultValue={query.direction ?? ""}
          options={[
            { value: "received", label: "Received" },
            { value: "sent", label: "Sent" },
          ]}
        />
        <Select
          name="stage"
          label="Stage"
          hideLabel
          placeholder="Any stage"
          defaultValue={query.stage ?? ""}
          options={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
        />
        <Select name="partner" label="Partner organisation" hideLabel placeholder="Any partner" defaultValue={query.partner ?? ""} options={partnerChoices} />
        <Select
          name="assigned"
          label="Assigned to"
          hideLabel
          placeholder="Anyone"
          defaultValue={assignedValue}
          options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id).map((s) => ({ value: s.value, label: s.label }))]}
        />
        <Select name="signed" label="Signed managements" hideLabel placeholder="Signed or not" defaultValue={query.signedOnly ? "1" : ""} options={[{ value: "1", label: "Signed only" }]} />
        <div className="grid gap-1.5 md:flex md:items-center md:gap-2">
          <span aria-hidden="true" className="hq-muted text-[13px]">
            Dated from
          </span>
          <DateInput name="from" label="Dated from" hideLabel defaultValue={query.from ?? ""} max={today} />
          <span aria-hidden="true" className="hq-muted text-[13px]">
            to
          </span>
          <DateInput name="to" label="Dated to" hideLabel defaultValue={query.to ?? ""} max={today} />
        </div>
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load referrals"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <ReferralsTable
              rows={list.data.rows}
              caption={`Referrals, ${list.data.total} ${list.data.total === 1 ? "result" : "results"}, sorted by ${SORT_LABEL[query.sort]}`}
              sort={sort}
              hrefForSort={hrefForSort}
              timezone={staff.timezone}
              empty={empty}
            />
            <Pagination page={list.data.page} pageSize={REFERRALS_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="referral" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
