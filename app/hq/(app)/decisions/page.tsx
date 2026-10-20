import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { DECISION_CATEGORIES, DECISION_CATEGORY_LABEL, DECISION_STATUSES, DECISION_STATUS_LABEL, LIST_PAGE_SIZE, parseDecisionListQuery } from "@/lib/hq/decisions/rules";
import { listDecisions } from "@/lib/hq/decisions/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { DateInput, EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, SearchInput, Select, buildHref } from "@/components/hq";
import { DecisionsTable } from "@/components/hq/features/decisions/DecisionParts";

export const metadata: Metadata = { title: "Decisions" };

const PATH = "/hq/decisions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DecisionsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, can } = await requireStaff("decisions.read", false, buildHref(PATH, sp));
  const canWrite = can("decisions.write");

  const query = parseDecisionListQuery(sp);
  const [list, staff] = await Promise.all([
    listDecisions(db, query, { offset: (query.page - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE }),
    staffOptions(db),
  ]);

  const record = canWrite ? (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
      Record a decision
    </LinkButton>
  ) : null;

  const empty = query.filtered ? (
    <EmptyState
      title="No decisions match"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try fewer words, or clear the filters to see the whole register.
    </EmptyState>
  ) : (
    <EmptyState title="No decisions recorded yet" action={record ?? undefined}>
      {canWrite
        ? "Record what the business decides, and why, so anyone can look it up later. Start with the decision you would most hate to forget."
        : "When a director or administrator records a decision, it will appear here with the reasons behind it."}
    </EmptyState>
  );

  return (
    <>
      <PageHeader title="Decisions" description="What the business has decided, why, and whether it still stands." actions={record} />

      <FilterBar
        action={PATH}
        label="Search and filter decisions"
        resetHref={PATH}
        active={query.filtered}
        more={
          <>
            <Select
              name="category"
              label="Category"
              hideLabel
              placeholder="Any category"
              defaultValue={query.category ?? ""}
              options={DECISION_CATEGORIES.map((c) => ({ value: c, label: DECISION_CATEGORY_LABEL[c] }))}
            />
            <Select
              name="status"
              label="Status"
              hideLabel
              placeholder="Any status"
              defaultValue={query.status ?? ""}
              options={DECISION_STATUSES.map((s) => ({ value: s, label: DECISION_STATUS_LABEL[s] }))}
            />
            <Select name="maker" label="Decision maker" hideLabel placeholder="Anyone" defaultValue={query.maker ?? ""} options={staff} />
            <DateInput name="from" label="Decided from" defaultValue={query.from ?? ""} />
            <DateInput name="to" label="Decided to" defaultValue={query.to ?? ""} />
          </>
        }
        moreActive={query.moreActive}
        moreLabel="Filter"
      >
        <SearchInput placeholder="Search decisions, or DEC-0001" defaultValue={query.q} label="Search decisions" />
      </FilterBar>

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load the decisions"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <DecisionsTable rows={list.data.rows} caption={`Decisions, ${list.data.total} ${list.data.total === 1 ? "decision" : "decisions"}, newest first`} empty={empty} />
            <Pagination page={query.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="decision" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
