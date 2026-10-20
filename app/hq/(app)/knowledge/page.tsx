import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_CATEGORY_LABEL, LIST_PAGE_SIZE, STATUS_FILTERS, STATUS_FILTER_LABEL, parseKnowledgeListQuery } from "@/lib/hq/knowledge/rules";
import { listKnowledge } from "@/lib/hq/knowledge/queries";
import { staffOptions } from "@/lib/hq/queries/options";
import { Checkbox, EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, SearchInput, Select, buildHref } from "@/components/hq";
import { KnowledgeTable } from "@/components/hq/features/knowledge/KnowledgeParts";

export const metadata: Metadata = { title: "Knowledge" };

const PATH = "/hq/knowledge";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function KnowledgePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, can } = await requireStaff("knowledge.read", false, buildHref(PATH, sp));
  const canWrite = can("knowledge.write");

  const query = parseKnowledgeListQuery(sp);
  const [list, staff] = await Promise.all([listKnowledge(db, query, { offset: (query.page - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE }), staffOptions(db)]);

  const write = canWrite ? (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
      Write a document
    </LinkButton>
  ) : null;

  const empty = query.filtered ? (
    <EmptyState
      title="Nothing matches"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try fewer words, or clear the filters to see every document.
    </EmptyState>
  ) : (
    <EmptyState title="Nothing written down yet" action={write ?? undefined}>
      {canWrite
        ? "Start with the thing people ask about most: how we onboard a landlord, how we vet a plumber, or how we sound in an email. Write it in your own words; a director or administrator approves it before it counts."
        : "When procedures, policies and checklists are written and approved, they will be here for everyone to read."}
    </EmptyState>
  );

  const rows = list.ok ? list.data.rows : [];
  const templates = rows.filter((r) => r.isTemplate).length;

  return (
    <>
      <PageHeader title="Knowledge" description="How we do things at PLANTED.: procedures, policies, checklists and how we speak." actions={write} />

      <FilterBar
        action={PATH}
        label="Search and filter knowledge documents"
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
              options={KNOWLEDGE_CATEGORIES.map((c) => ({ value: c, label: KNOWLEDGE_CATEGORY_LABEL[c] }))}
            />
            <Select name="status" label="Status" hideLabel placeholder="Any status" defaultValue={query.status ?? ""} options={STATUS_FILTERS.map((s) => ({ value: s, label: STATUS_FILTER_LABEL[s] }))} />
            <Select name="owner" label="Owner" hideLabel placeholder="Any owner" defaultValue={query.owner ?? ""} options={staff} />
            <Checkbox name="review" value="due" label="Review due (overdue or within 30 days)" defaultChecked={query.reviewDue} />
          </>
        }
        moreActive={query.moreActive}
        moreLabel="Filter"
      >
        <SearchInput placeholder="Search knowledge, or KB-0001" defaultValue={query.q} label="Search knowledge" />
      </FilterBar>

      {templates > 0 && !query.filtered ? (
        <p className="hq-muted mt-4 text-[14px]">
          {templates === 1 ? "One starter template is" : `${templates} starter templates are`} waiting to be written: open one, replace the prompts in square brackets with your own words, and save.
        </p>
      ) : null}

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load the knowledge base"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <KnowledgeTable rows={rows} caption={`Knowledge documents, ${list.data.total} ${list.data.total === 1 ? "document" : "documents"}`} empty={empty} />
            <Pagination page={query.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="document" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
