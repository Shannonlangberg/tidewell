import type { Metadata } from "next";
import Form from "next/form";
import { requireStaff } from "@/lib/hq/auth";
import { EMPTY_RESULTS, SEARCH_MIN, SEARCH_PAGE_LIMIT, normaliseQuery, parseSearchResults, queryState, totalHits } from "@/lib/hq/search";
import { Button, EmptyState, ErrorState, LinkButton, PageHeader, SearchInput, buildHref } from "@/components/hq";
import { SearchResultsView } from "@/components/hq/features/tasks/SearchResultsView";
import type { SearchResults } from "@/components/hq/types";

export const metadata: Metadata = { title: "Search" };

const PATH = "/hq/search";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = normaliseQuery(sp.q);

  // Any signed-in member of staff may search. What comes back is decided by row level security,
  // because hq.global_search runs as the caller: someone without growth.read simply gets no
  // contacts, organisations or referrals, and a person who is not tasks.read_all finds only their own tasks.
  const { db, can } = await requireStaff(undefined, false, buildHref(PATH, sp));
  const canGrowth = can("growth.read");

  const state = queryState(q);
  let results: SearchResults = EMPTY_RESULTS;
  let failed = false;
  if (state === "ready") {
    const { data, error } = await db.rpc("global_search", { p_query: q, p_limit: SEARCH_PAGE_LIMIT });
    if (error) {
      console.error("[hq] search page failed:", error.code ?? "unknown");
      failed = true;
    } else {
      results = parseSearchResults(data);
    }
  }
  const total = totalHits(results);

  return (
    <>
      <PageHeader
        eyebrow="HQ"
        title="Search"
        description={canGrowth ? "Find a contact, an organisation, a referral or a task." : "Find a task by its title."}
      />

      <Form action={PATH} role="search" aria-label="Search HQ" className="mt-6 flex max-w-3xl items-end gap-3">
        <div className="min-w-0 flex-1">
          <SearchInput label="Search HQ" placeholder={canGrowth ? "Name, organisation, referral number or task" : "Task title"} defaultValue={q} />
        </div>
        <Button type="submit" variant="primary">
          Search
        </Button>
      </Form>

      <div className="mt-8" aria-live="polite">
        {state === "empty" ? (
          <EmptyState title="Search HQ" compact>
            {canGrowth
              ? "Type a person's name, an organisation, a referral number such as REF-0012, or part of a task title."
              : "Type part of the title of a task."}
          </EmptyState>
        ) : state === "too_short" ? (
          <EmptyState title="Keep typing" compact>
            Search needs at least {SEARCH_MIN} characters.
          </EmptyState>
        ) : failed ? (
          <ErrorState
            title="Search is unavailable right now"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          >
            We couldn&rsquo;t run that search. Nothing was changed. Try again in a moment.
          </ErrorState>
        ) : total === 0 ? (
          <EmptyState
            title={`Nothing found for “${q}”`}
            action={
              <LinkButton href={PATH} variant="secondary">
                Clear search
              </LinkButton>
            }
          >
            Check the spelling, or try fewer words or just part of a name.
            {canGrowth ? " A referral can be found by its number, such as REF-0012." : ""}
          </EmptyState>
        ) : (
          <>
            <p className="hq-muted mb-6 text-[14px]">
              {total === 1 ? "1 result" : `${total} results`} for &ldquo;{q}&rdquo;
            </p>
            <SearchResultsView results={results} perGroupLimit={SEARCH_PAGE_LIMIT} />
          </>
        )}
      </div>
    </>
  );
}
