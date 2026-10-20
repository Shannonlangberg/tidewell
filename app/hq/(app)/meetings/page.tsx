import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { todayIn } from "@/lib/hq/format";
import { LIST_PAGE_SIZE, MEETING_TYPES, MEETING_TYPE_LABEL, addDays, parseMeetingListQuery, sinceDaysIso } from "@/lib/hq/meetings/rules";
import { listMeetings, openMeetingActions, recentMeetings } from "@/lib/hq/meetings/queries";
import { organisationOptions, staffOptions } from "@/lib/hq/queries/options";
import { Checkbox, DateInput, EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, Pagination, SearchInput, SectionLabel, Select, buildHref } from "@/components/hq";
import { FAILED_LINE, QuietLine, TodaySection } from "@/components/hq/features/today/sections";
import { MeetingsTable, OpenActionRows, WeekCards } from "@/components/hq/features/meetings/MeetingParts";

export const metadata: Metadata = { title: "Meetings" };

const PATH = `${HQ_BASE}/meetings`;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Meetings, summary first. At the top: the meetings of the last seven days as short cards, and the open
 * actions from meetings (with the usual Done button). Below: every meeting, with search and a Filter
 * button. Everything is read as the person: confidential meetings appear only for their staff
 * attendees, their recorder and directors and administrators.
 */
export default async function MeetingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("meetings.read", false, buildHref(PATH, sp));
  const canWrite = can("meetings.write");
  const tz = staff.timezone;
  const today = todayIn(tz);
  const since = sinceDaysIso(today, 7, tz);

  const query = parseMeetingListQuery(sp);
  const [week, actions, list, people, orgs] = await Promise.all([
    recentMeetings(db, since, 9),
    openMeetingActions(db, { limit: 8 }),
    listMeetings(db, query, { offset: (query.page - 1) * LIST_PAGE_SIZE, limit: LIST_PAGE_SIZE }, { staffId: staff.id, timeZone: tz }),
    staffOptions(db),
    organisationOptions(db),
  ]);

  const record = canWrite ? (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
      Record a meeting
    </LinkButton>
  ) : null;

  const nothingYet = list.ok && list.data.total === 0 && !query.filtered && week.ok && week.data.total === 0 && actions.ok && actions.data.total === 0;
  const returnTo = buildHref(PATH, sp, { toast: null, toast_tone: null });

  const empty = query.filtered ? (
    <EmptyState
      title="No meetings match"
      action={
        <LinkButton href={PATH} variant="secondary">
          Clear filters
        </LinkButton>
      }
    >
      Try fewer words, or clear the filters to see every meeting.
    </EmptyState>
  ) : (
    <EmptyState title="No meetings saved yet" action={record ?? undefined}>
      Tell ChatGPT or Claude about a meeting and ask it to save the minutes to Planted HQ. It writes the summary, the minutes, the decisions and the actions; HQ keeps them here, turns the actions into tasks and logs the meeting on the partner or lead it was about. HQ does not record audio.
    </EmptyState>
  );

  return (
    <>
      <PageHeader
        title="Meetings"
        description="Summaries, minutes and actions from your meetings. Most are saved from chat: tell ChatGPT or Claude about a meeting and ask it to save the minutes to Planted HQ."
        actions={record}
      />

      {nothingYet ? (
        empty
      ) : (
        <>
          <div className="hq-mtg-top">
            {!week.ok ? (
              <QuietLine id="this-week">This week: {FAILED_LINE}</QuietLine>
            ) : week.data.rows.length === 0 ? (
              <QuietLine id="this-week">No meetings saved in the last 7 days.</QuietLine>
            ) : (
              <TodaySection id="this-week" title="This week" count={week.data.total} link={week.data.total > week.data.rows.length ? { href: `${PATH}?from=${addDays(today, -6)}`, label: `All ${week.data.total}` } : undefined}>
                <WeekCards rows={week.data.rows} timezone={tz} />
              </TodaySection>
            )}
            {!actions.ok ? (
              <QuietLine id="meeting-actions">Open actions: {FAILED_LINE}</QuietLine>
            ) : actions.data.rows.length === 0 ? (
              <QuietLine id="meeting-actions">No open actions from meetings.</QuietLine>
            ) : (
              <TodaySection id="meeting-actions" title="Open actions from meetings" count={actions.data.total} link={actions.data.total > actions.data.rows.length ? { href: `${PATH}?open=1`, label: "Meetings with open actions" } : undefined}>
                <OpenActionRows rows={actions.data.rows} today={today} canComplete={can("tasks.write")} returnTo={returnTo} />
              </TodaySection>
            )}
          </div>

          <section aria-labelledby="all-meetings" className="mt-12">
            <SectionLabel as="h2" id="all-meetings" className="mb-4 border-b border-line pb-3.5">
              All meetings
            </SectionLabel>
            <FilterBar
              action={PATH}
              label="Search and filter meetings"
              resetHref={PATH}
              active={query.filtered}
              more={
                <>
                  <Select name="type" label="Kind" hideLabel placeholder="Any kind" defaultValue={query.type ?? ""} options={MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABEL[t] }))} />
                  <Select name="person" label="Team member there" hideLabel placeholder="Anyone from the team" defaultValue={query.person ?? ""} options={people} />
                  {orgs.length > 0 ? <Select name="org" label="Organisation" hideLabel placeholder="Any organisation" defaultValue={query.org ?? ""} options={orgs} /> : null}
                  <DateInput name="from" label="Held from" defaultValue={query.from ?? ""} />
                  <DateInput name="to" label="Held to" defaultValue={query.to ?? ""} />
                  <Checkbox name="open" value="1" label="Has open actions" defaultChecked={query.open} />
                  <Checkbox name="mine" value="1" label="Mine (I was there or saved it)" defaultChecked={query.mine} />
                </>
              }
              moreActive={query.moreActive}
              moreLabel="Filter"
            >
              <SearchInput placeholder="Search meetings, or MTG-0001" defaultValue={query.q} label="Search meetings" />
            </FilterBar>

            <div className="mt-6">
              {!list.ok ? (
                <ErrorState
                  title="We could not load the meetings"
                  action={
                    <LinkButton href={buildHref(PATH, sp)} size="sm">
                      Try again
                    </LinkButton>
                  }
                />
              ) : (
                <>
                  <MeetingsTable rows={list.data.rows} caption={`Meetings, ${list.data.total} ${list.data.total === 1 ? "meeting" : "meetings"}, newest first`} empty={empty} timezone={tz} />
                  <Pagination page={query.page} pageSize={LIST_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="meeting" className="mt-6" />
                </>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
