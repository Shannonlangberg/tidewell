import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AppShell,
  Avatar,
  Breadcrumbs,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  InlineNote,
  KeyValueList,
  LinkButton,
  MobileList,
  MobileListItem,
  PageHeader,
  Pagination,
  Panel,
  PanelHeader,
  PriorityChip,
  RelationshipChip,
  ResponsiveTable,
  SearchInput,
  SectionLabel,
  Select,
  Skeleton,
  SkeletonText,
  Stat,
  StatBand,
  StageChip,
  StatusChip,
  Tabs,
  TaskStatusChip,
  Timeline,
  TimelineItem,
  Wordmark,
  buildHref,
  type Column,
  type SearchResults,
  type SortState,
} from "@/components/hq";
import { ChoiceDemo, ConfirmDemo, DrawerDemo, FormDemo, ShellOpeners, StatesDemo, SubmitDemo, ToastDemo } from "@/components/hq/dev/GalleryDemos";
import {
  CAPABILITIES,
  CATEGORY_LABEL,
  OPPORTUNITY_STAGES,
  RELATIONSHIP_LABEL,
  RELATIONSHIP_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type PartnerCategory,
  type RelationshipStatus,
} from "@/lib/hq/constants";
import { FormReader, fail, succeed, type ActionState } from "@/lib/hq/forms";

/*
 * DEV GALLERY: every HQ component in realistic states, inside the real AppShell.
 * Development only: it 404s in production. All people, organisations and figures here
 * are obviously fake sample data.
 */

export const metadata: Metadata = { title: "Dev gallery" };

// ── sample server actions (the shell expects Server Actions as props) ──

async function sampleSignOut() {
  "use server";
  // The gallery has no session. Signing out is a no-op here.
}

const SAMPLE_PEOPLE = [
  { id: "sample-1", title: "Alex Sample", subtitle: "Mortgage broker, Sample Lending Co." },
  { id: "sample-2", title: "Sam Sample", subtitle: "Mortgage broker, Sample Lending Co." },
  { id: "sample-3", title: "Jo Example", subtitle: "Conveyancer, Example Conveyancing" },
  { id: "sample-4", title: "Robin Placeholder", subtitle: "Real estate sales, Placeholder Realty" },
];
const SAMPLE_ORGS = [
  { id: "sample-o1", title: "Sample Lending Co.", subtitle: "2 contacts" },
  { id: "sample-o2", title: "Example Conveyancing", subtitle: "1 contact" },
];
const SAMPLE_REFS = [{ id: "sample-r1", title: "REF-0001", subtitle: "Received, Introduction received" }];
const SAMPLE_TASKS = [{ id: "sample-t1", title: "Call Alex Sample about the sample referral", subtitle: "Due Tue 20 Oct, To do" }];

async function sampleSearch(query: string): Promise<SearchResults> {
  "use server";
  await new Promise((r) => setTimeout(r, 350));
  const q = query.trim().toLowerCase();
  if (q.startsWith("boom")) throw new Error("Sample failure to show the error state");
  const hit = <T extends { title: string; subtitle: string }>(list: T[]) =>
    list.filter((x) => x.title.toLowerCase().includes(q) || x.subtitle.toLowerCase().includes(q));
  return { contacts: hit(SAMPLE_PEOPLE), organisations: hit(SAMPLE_ORGS), referrals: hit(SAMPLE_REFS), tasks: hit(SAMPLE_TASKS) };
}

async function sampleSubmit() {
  "use server";
  await new Promise((r) => setTimeout(r, 1400));
}

async function sampleSave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  "use server";
  await new Promise((r) => setTimeout(r, 600));
  const f = new FormReader(formData);
  f.requiredText("fullName", { label: "Full name", max: 120 });
  f.email("email");
  f.phone("phone");
  f.oneOf("category", ["real_estate_sales", "mortgage_broker", "conveyancer", "lawyer", "accountant", "bank_lending", "buyers_agent", "property_developer", "builder", "financial_adviser", "other"], { required: true });
  f.uuid("organisation");
  if (f.ok) return succeed("Sample saved (nothing was stored).");
  // React 19 resets an uncontrolled form once its action finishes, so hand the typed values
  // back in `data` and let the page use them as defaultValue: nothing the person typed is lost.
  const values = Object.fromEntries([...formData].filter((e): e is [string, string] => typeof e[1] === "string"));
  return { ...f.fail(), data: { values } };
}

const INITIAL_ERRORS: ActionState = fail("Please check the highlighted fields and try again.", {
  fullName: "Full name is required.",
  email: "That doesn't look like an email address.",
  category: "Choose an option.",
});

// ── sample table rows ──

type Row = {
  id: string;
  name: string;
  org: string;
  category: PartnerCategory;
  status: RelationshipStatus;
  owner: string;
  last: string | null;
  followUp: string | null;
  overdue?: boolean;
};

const ROWS: Row[] = [
  { id: "1", name: "Alex Sample", org: "Sample Lending Co.", category: "mortgage_broker", status: "met", owner: "Sample owner A", last: "Today", followUp: "Tue 20 Oct" },
  { id: "2", name: "Sam Sample", org: "Sample Lending Co.", category: "mortgage_broker", status: "identified", owner: "Sample owner A", last: null, followUp: null },
  { id: "3", name: "Jo Example", org: "Example Conveyancing", category: "conveyancer", status: "referring_partner", owner: "Sample owner B", last: "Yesterday", followUp: "Fri 23 Oct" },
  { id: "4", name: "Robin Placeholder", org: "Placeholder Realty", category: "real_estate_sales", status: "meeting_booked", owner: "Sample owner A", last: "3 days ago", followUp: "Mon 19 Oct" },
  { id: "5", name: "Kim Demo", org: "Demo Buyers Agency", category: "buyers_agent", status: "contacted", owner: "Sample owner B", last: "12 days ago", followUp: "Overdue", overdue: true },
  { id: "6", name: "Pat Mockup", org: "Mockup Legal", category: "lawyer", status: "identified", owner: "Sample owner A", last: null, followUp: null },
  { id: "7", name: "Lee Illustrative", org: "Illustrative Finance", category: "mortgage_broker", status: "active_relationship", owner: "Sample owner A", last: "6 days ago", followUp: "Thu 29 Oct" },
  { id: "8", name: "Drew Specimen", org: "Specimen Property Group", category: "buyers_agent", status: "inactive", owner: "Sample owner B", last: "94 days ago", followUp: null },
  { id: "9", name: "Montgomery-Featherstonehaugh Sample", org: "Sample Conveyancing and Settlement Services Proprietary Limited (very long sample name)", category: "conveyancer", status: "contacted", owner: "Sample owner A", last: "2 days ago", followUp: "Wed 21 Oct" },
  { id: "10", name: "Quinn Fixture", org: "Fixture Accounting", category: "accountant", status: "met", owner: "Sample owner B", last: "8 days ago", followUp: "Overdue", overdue: true },
  { id: "11", name: "Blake Stand-in", org: "Stand-in Builders", category: "builder", status: "meeting_booked", owner: "Sample owner A", last: "5 days ago", followUp: "Fri 30 Oct" },
  { id: "12", name: "Avery Dummy", org: "Dummy Developments", category: "property_developer", status: "identified", owner: "Sample owner B", last: null, followUp: null },
];

const SORTABLE: Record<string, (r: Row) => string> = {
  name: (r) => r.name.toLowerCase(),
  category: (r) => CATEGORY_LABEL[r.category],
  status: (r) => RELATIONSHIP_STATUSES.indexOf(r.status).toString().padStart(2, "0"),
  owner: (r) => r.owner,
};

const PATH = "/hq/dev-gallery";
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="mt-14 border-t border-line pt-8 first:mt-0">
      <SectionLabel as="h2" id={`${id}-h`}>
        {title}
      </SectionLabel>
      {note ? <p className="hq-muted mt-2 max-w-3xl text-[14px]">{note}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Swatch({ name, token, text }: { name: string; token: string; text?: string }) {
  return (
    <div className="border border-line">
      <div className="flex h-16 items-end p-2 text-[11px]" style={{ background: `var(${token})`, color: text ? `var(${text})` : undefined }}>
        {text ? "Aa" : ""}
      </div>
      <div className="p-2 text-[12px] leading-tight">
        <b className="block font-semibold">{name}</b>
        <code className="hq-muted">{token}</code>
      </div>
    </div>
  );
}

export default async function DevGalleryPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (process.env.NODE_ENV === "production") notFound();

  const sp = await searchParams;
  const restricted = one(sp.as) === "restricted";

  const staff = restricted
    ? { fullName: "Sample Restricted", role: "read_only" as const, capabilities: [] }
    : { fullName: "Sample User", role: "director" as const, capabilities: CAPABILITIES };

  const sortKey = one(sp.sort) && one(sp.sort)! in SORTABLE ? one(sp.sort)! : "name";
  const dir = one(sp.dir) === "desc" ? "desc" : "asc";
  const sort: SortState = { key: sortKey, dir };
  const sorted = [...ROWS].sort((a, b) => {
    const x = SORTABLE[sortKey](a);
    const y = SORTABLE[sortKey](b);
    return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1);
  });
  const page = Number(one(sp.page)) || 1;
  const hrefForSort = (s: SortState) => buildHref(PATH, sp, { sort: s.key, dir: s.dir, page: null });

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      primary: true,
      sortable: true,
      cell: (r) => (
        <>
          <a href={`#row-${r.id}`}>{r.name}</a>
          <span className="hq-cell-sub">{r.org}</span>
        </>
      ),
    },
    { key: "category", header: "Category", sortable: true, hideBelow: "lg", cell: (r) => CATEGORY_LABEL[r.category] },
    { key: "status", header: "Status", sortable: true, cell: (r) => <RelationshipChip status={r.status} /> },
    { key: "owner", header: "Owner", sortable: true, hideBelow: "xl", cell: (r) => r.owner },
    { key: "last", header: "Last contact", nowrap: true, cell: (r) => (r.last ?? <span className="hq-cell-nil">Not yet</span>) },
    {
      key: "followUp",
      header: "Next follow-up",
      nowrap: true,
      cell: (r) => (r.overdue ? <StatusChip tone="error">Overdue</StatusChip> : (r.followUp ?? <span className="hq-cell-nil">Not set</span>)),
    },
  ];

  return (
    <AppShell
      staff={staff}
      active="growth"
      signOutAction={sampleSignOut}
      searchAction={sampleSearch}
      breadcrumb={<Breadcrumbs tone="bar" items={[{ label: "Dev gallery" }]} />}
    >
      <PageHeader
        eyebrow="Development only"
        title="Component gallery"
        description="Every Planted HQ component in realistic states, inside the real shell. Everything below is sample data and nothing is saved."
        actions={
          <>
            <LinkButton href={restricted ? PATH : `${PATH}?as=restricted`}>{restricted ? "View as a director" : "View as a restricted person"}</LinkButton>
            <LinkButton href={`${PATH}?toast=Contact+saved`} variant="primary">
              Flash toast from the URL
            </LinkButton>
          </>
        }
      />
      <InlineNote>
        <b>Sample data, development only.</b> The signed-in person is a labelled sample. Try the restricted view to see navigation and Quick add shrink to what that person may use. Press Ctrl or Cmd
        K to search; type &ldquo;sample&rdquo; for results or &ldquo;boom&rdquo; for the error state.
      </InlineNote>

      <div className="mt-12">
        <Section id="brand" title="Brand: wordmark, palette, type">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-wrap gap-8">
              <div className="bg-charcoal p-8">
                <Wordmark href={false} />
              </div>
              <div className="border border-line bg-ivory p-8">
                <Wordmark tone="onLight" href={false} />
              </div>
              <div className="bg-charcoal p-8">
                <Wordmark size="sm" descriptor={false} href={false} />
              </div>
            </div>
            <div>
              <p className="hq-display text-[46px] leading-none">Good morning, Sample.</p>
              <p className="hq-muted mt-3 text-[14px]">Cormorant Garamond appears only in the wordmark, the dashboard welcome, sign-in, and empty-state titles. Never in data.</p>
              <p className="mt-4 text-[34px] font-semibold leading-none hq-nums">1,284 &nbsp;<span className="font-normal text-[14px] hq-muted">every figure is DM Sans</span></p>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            <Swatch name="Soft white" token="--planted-white" />
            <Swatch name="Ivory" token="--planted-ivory" />
            <Swatch name="Stone" token="--planted-stone" text="--planted-charcoal" />
            <Swatch name="Charcoal" token="--planted-charcoal" text="--planted-ivory" />
            <Swatch name="Deep black" token="--planted-black" text="--planted-ivory" />
            <Swatch name="Taupe" token="--planted-taupe" text="--planted-charcoal" />
            <Swatch name="Clay (marker only)" token="--planted-clay" />
            <Swatch name="Border" token="--planted-border" />
            <Swatch name="Grey text" token="--planted-grey-text" text="--planted-white" />
            <Swatch name="Clay text" token="--planted-clay-text" text="--planted-white" />
          </div>
        </Section>

        <Section id="buttons" title="Buttons" note="Primary, secondary, ghost, danger; md and sm; with icons; disabled; loading. Tab to see the focus ring.">
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="primary" icon="plus">
                With icon
              </Button>
              <Button variant="secondary" trailingIcon="arrow-up-right">
                Trailing icon
              </Button>
              <LinkButton href="#buttons" variant="secondary">
                Link button
              </LinkButton>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Small primary
              </Button>
              <Button variant="secondary" size="sm">
                Small secondary
              </Button>
              <Button variant="primary" disabled>
                Disabled primary
              </Button>
              <Button variant="secondary" disabled>
                Disabled secondary
              </Button>
              <Button variant="primary" loading pendingLabel="Saving">
                Loading
              </Button>
              <Button variant="secondary" loading pendingLabel="Loading">
                Loading secondary
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <IconButton icon="more" label="More actions" variant="secondary" />
              <IconButton icon="filter" label="Filter" />
              <IconButton icon="close" label="Close" size="sm" />
              <Avatar name="Sample User" />
              <Avatar name="Alex Sample" size="sm" />
              <Avatar name="Robin Placeholder" size="lg" />
            </div>
            <SubmitDemo action={sampleSubmit} />
          </div>
        </Section>

        <Section id="chips" title="Status chips" note="4px radius, always a dot and a label. Tones come from lib/hq/constants label maps via the tone helpers.">
          <div className="grid gap-5">
            <div className="flex flex-wrap gap-2">
              <StatusChip>Neutral</StatusChip>
              <StatusChip tone="info">Info</StatusChip>
              <StatusChip tone="success">Success</StatusChip>
              <StatusChip tone="warning">Warning</StatusChip>
              <StatusChip tone="error">Error</StatusChip>
              <StatusChip plain>Plain tag</StatusChip>
            </div>
            <div className="flex flex-wrap gap-2">
              {RELATIONSHIP_STATUSES.map((s) => (
                <RelationshipChip key={s} status={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {OPPORTUNITY_STAGES.map((s) => (
                <StageChip key={s} stage={s} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {TASK_STATUSES.map((s) => (
                <TaskStatusChip key={s} status={s} />
              ))}
              {TASK_PRIORITIES.map((p) => (
                <PriorityChip key={p} priority={p} />
              ))}
            </div>
          </div>
        </Section>

        <Section id="header" title="Page header and breadcrumbs">
          <div className="grid gap-10">
            <PageHeader
              breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Contacts", href: "/hq/growth/contacts" }, { label: "Alex Sample" }]}
              title="Alex Sample"
              description="Senior Broker, Sample Lending Co."
              meta={
                <>
                  <RelationshipChip status="met" />
                  <StatusChip plain>Mortgage broker</StatusChip>
                  <PriorityChip priority="high" />
                </>
              }
              actions={
                <>
                  <Button>Log a call</Button>
                  <Button variant="primary">Create follow-up</Button>
                </>
              }
            />
            <PageHeader variant="welcome" eyebrow="Thursday 15 October, Copper Coast" title="Good morning, Sample." actions={<Button variant="primary">Record a referral</Button>} />
          </div>
        </Section>

        <Section id="stats" title="Stat band" note="A flat band divided by hairlines. A null value shows an em dash and says why. Zero is quiet, as in the reference.">
          <StatBand label="Sample figures">
            <Stat label="Contacts identified" value={27} hint="Across 19 organisations. None contacted yet." />
            <Stat label="Need verifying" value={27} hint="Research leads, not confirmed relationships." />
            <Stat label="Referrals received" value={0} hint="None recorded yet." />
            <Stat label="Managed properties" value={null} hint="Appears once connected to Ailo or entered in Insights." />
          </StatBand>
          <div className="mt-6">
            <StatBand columns={3} label="Linked sample figures">
              <Stat label="Overdue follow-ups" value={4} hint="Oldest first." href="#stats" />
              <Stat label="Conversion" value="12%" hint="Sample figure." />
              <Stat label="Estimated value" value="$48,000" hint="Sample estimate." />
            </StatBand>
          </div>
        </Section>

        <Section id="panels" title="Panels, empty, error and loading states">
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Panel aria-labelledby="p1">
              <PanelHeader id="p1" title="Who to call this week" meta="Overdue first" />
              <EmptyState
                compact
                title="No follow-ups scheduled"
                action={
                  <LinkButton href="/hq/growth" size="sm">
                    Open Growth
                  </LinkButton>
                }
              >
                When you log a call or meeting, set the next follow-up and it will appear here, oldest first.
              </EmptyState>
            </Panel>
            <Panel aria-labelledby="p2">
              <PanelHeader id="p2" title="Referral pipeline" meta="Open" />
              <EmptyState
                compact
                title="No referrals recorded yet"
                action={
                  <LinkButton href="/hq/growth/referrals/new" size="sm">
                    Record a referral
                  </LinkButton>
                }
              >
                Add your first introduction and follow it through to a signed management.
              </EmptyState>
            </Panel>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <ErrorState
              action={
                <Button size="sm" icon="arrow-up">
                  Try again
                </Button>
              }
            />
            <Panel aria-labelledby="p3">
              <PanelHeader id="p3" title="Loading (skeletons)" meta="Aria-busy" />
              <div aria-busy="true" className="grid gap-4">
                <Skeleton variant="heading" width="55%" />
                <SkeletonText lines={3} />
                <div className="flex items-center gap-3">
                  <Skeleton variant="circle" width={32} height={32} />
                  <Skeleton width="40%" />
                </div>
                <Skeleton variant="block" />
              </div>
            </Panel>
          </div>
        </Section>

        <Section
          id="table"
          title="Table, filters, tabs, pagination"
          note="Above 768px this is a semantic table (sort headers are links; Category hides below 1024px and Owner below 1280px). Below 768px the same rows are a list. Both are in the page; CSS picks one."
        >
          <Tabs
            label="Contact views"
            items={[
              { label: "All", href: `${PATH}?view=all`, current: one(sp.view) !== "overdue" && one(sp.view) !== "mine", count: 27 },
              { label: "Mine", href: `${PATH}?view=mine`, current: one(sp.view) === "mine", count: 14 },
              { label: "Overdue", href: `${PATH}?view=overdue`, current: one(sp.view) === "overdue", count: 2 },
            ]}
          />
          <FilterBar action={PATH} label="Filter sample contacts" hidden={{ sort: sortKey, dir, view: one(sp.view) }} resetHref={PATH} active={Boolean(one(sp.q) || one(sp.status))}>
            <SearchInput placeholder="Search by name or organisation" defaultValue={one(sp.q)} />
            <Select
              name="status"
              label="Status"
              hideLabel
              placeholder="All statuses"
              defaultValue={one(sp.status) ?? ""}
              options={RELATIONSHIP_STATUSES.map((s) => ({ value: s, label: RELATIONSHIP_LABEL[s] }))}
            />
          </FilterBar>
          <ResponsiveTable
            table={<DataTable caption="Sample contacts, 27 results" columns={columns} rows={sorted} rowKey={(r) => r.id} sort={sort} hrefForSort={hrefForSort} />}
            list={
              <MobileList label="Sample contacts">
                {sorted.map((r) => (
                  <MobileListItem
                    key={r.id}
                    href={`#row-${r.id}`}
                    title={r.name}
                    subtitle={r.org}
                    status={<RelationshipChip status={r.status} />}
                    meta={r.overdue ? "Follow-up overdue" : r.followUp ? `Follow up ${r.followUp}` : r.last ? `Last: ${r.last}` : "Not contacted"}
                  />
                ))}
              </MobileList>
            }
          />
          <Pagination page={page} pageSize={12} total={27} pathname={PATH} searchParams={sp} noun="contact" />

          <h3 className="hq-label mt-12">Empty table</h3>
          <DataTable
            caption="No matching contacts"
            columns={columns}
            rows={[] as Row[]}
            rowKey={(r) => r.id}
            empty={
              <EmptyState title="No contacts match those filters">
                Try a shorter search, or clear the filters to see all 27 contacts.
              </EmptyState>
            }
          />

          <h3 className="hq-label mt-12">Sticky header (scrolls inside its own region)</h3>
          <div style={{ maxWidth: 720 }}>
            <DataTable
              caption="Sample contacts with a sticky header"
              stickyHeader
              columns={[columns[0], columns[2]]}
              rows={[...sorted, ...sorted.map((r) => ({ ...r, id: `${r.id}b` })), ...sorted.map((r) => ({ ...r, id: `${r.id}c` }))]}
              rowKey={(r) => r.id}
            />
          </div>
        </Section>

        <Section id="detail" title="Timeline and key / value list">
          <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
            <div>
              <SectionLabel className="border-b border-line pb-3.5 mb-5">Relationship timeline</SectionLabel>
              <Timeline label="Sample timeline">
                <TimelineItem icon="phone" title="Phone call" meta="Today, 9:40 am · Sample owner A" footer={<StatusChip tone="warning">Follow-up Tue 20 Oct</StatusChip>}>
                  Two clients looking at Copper Coast investments. Warm about managing locally.
                </TimelineItem>
                <TimelineItem icon="coffee" title="Coffee meeting" meta="Mon 5 Oct · Sample owner B">
                  Introduced Planted. Agreed to keep each other in mind for referrals.
                </TimelineItem>
                <TimelineItem icon="mail" title="Email" meta="Mon 28 Sep · Sample owner A">
                  First introduction sent.
                </TimelineItem>
                <TimelineItem icon="note" title="Note" meta="Fri 25 Sep · Sample owner A">
                  A very long unbroken sample string to test wrapping: supercalifragilisticexpialidocious-sample-of-an-extremely-long-identifier-0123456789.
                </TimelineItem>
              </Timeline>
            </div>
            <div>
              <SectionLabel className="mb-3.5">Details</SectionLabel>
              <KeyValueList
                items={[
                  { label: "Phone", value: null },
                  { label: "Email", value: "alex@sample.example" },
                  { label: "Region", value: "Adelaide" },
                  { label: "Owner", value: "Sample owner A" },
                  { label: "Next follow-up", value: "Tue 20 Oct" },
                  { label: "Last contact", value: "Today" },
                  { label: "Website", value: "https://a-very-long-sample-address.example/with/a/long/path/that/must/wrap/nicely" },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section id="forms" title="Forms" note="Native controls, labels above, errors linked with aria-describedby and aria-invalid. The first form starts in an error state: click a link in the summary to jump to its field, or submit it to validate on the server.">
          <FormDemo action={sampleSave} initial={INITIAL_ERRORS} />
          <h3 className="hq-label mb-5 mt-12">States</h3>
          <StatesDemo />
          <h3 className="hq-label mb-5 mt-12">Choices</h3>
          <ChoiceDemo />
        </Section>

        <Section id="overlays" title="Overlays: drawer, palette, Ask Planted, confirm, toasts">
          <div className="grid gap-6">
            <ShellOpeners />
            <DrawerDemo />
            <ConfirmDemo />
            <ToastDemo />
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
