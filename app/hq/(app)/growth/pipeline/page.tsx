import type { Metadata } from "next";
import { STAGE_LABEL } from "@/lib/hq/constants";
import { requireStaff } from "@/lib/hq/auth";
import { formatAud, todayIn } from "@/lib/hq/format";
import { parsePipelineParams } from "@/lib/hq/referrals/params";
import { PIPELINE_LIMIT, loadPipeline, referralPartnerOptions } from "@/lib/hq/referrals/queries";
import { STAGE_ORDER, columnTotals, daysInStage, groupByStage } from "@/lib/hq/referrals/stages";
import { staffOptions } from "@/lib/hq/queries/options";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL } from "@/lib/hq/leads/rules";
import { EmptyState, ErrorState, FilterBar, InlineNote, LinkButton, PageHeader, Select, Tabs, buildHref } from "@/components/hq";
import { PipelineBoard, type BoardCard } from "@/components/hq/features/pipeline/PipelineBoard";

export const metadata: Metadata = { title: "Pipeline" };
const PATH = "/hq/growth/pipeline";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("growth.read", false, buildHref(PATH, sp));
  const canWrite = can("growth.write");
  const query = parsePipelineParams(sp);
  const today = todayIn(staff.timezone);

  const [pipeline, partners, staffList] = await Promise.all([
    loadPipeline(db, query, { staffId: staff.id }),
    referralPartnerOptions(db, "received"),
    staffOptions(db),
  ]);

  const now = new Date();
  const cards: BoardCard[] = pipeline.ok ? pipeline.data.cards.map((c) => ({ ...c, days: daysInStage(c.stageChangedAt, staff.timezone, now) })) : [];
  const counts = groupByStage(cards);
  const returnTo = buildHref(PATH, sp, { toast: null, toast_tone: null });

  const assignedValue = query.assigned ? (query.assigned.kind === "staff" ? query.assigned.id : query.assigned.kind) : "";
  const partnerChoices = query.partner && !partners.some((p) => p.value === query.partner) ? [{ value: query.partner, label: "Selected partner" }, ...partners] : partners;
  const defaultStage = query.stage === "introduction_received";

  const recordAction = canWrite ? (
    <span className="flex flex-wrap justify-center gap-3">
      <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
        Add a lead
      </LinkButton>
      <LinkButton href="/hq/growth/referrals/new">Record a referral</LinkButton>
    </span>
  ) : undefined;

  const openCount = cards.filter((c) => c.stage !== "management_signed" && c.stage !== "lost").length;
  const attentionCount = cards.filter((c) => c.needsAttention).length;
  const totalEstimate = columnTotals(cards.filter((c) => c.stage !== "management_signed" && c.stage !== "lost"));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Growth", href: "/hq/growth" }, { label: "Pipeline" }]}
        title="Pipeline"
        description="Every lead from first contact to signed management: your own marketing, the website, direct approaches and partner referrals. Each lead appears once, and a signed management is counted once."
        actions={
          <>
            <LinkButton href="/hq/growth/referrals">All referrals</LinkButton>
            {canWrite ? <LinkButton href="/hq/growth/referrals/new">Record a referral</LinkButton> : null}
            {canWrite ? (
              <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
                Add a lead
              </LinkButton>
            ) : null}
          </>
        }
      />

      {/* On a phone the board shows one stage at a time: the selector comes first, so it is near the top of the screen. */}
      {pipeline.ok && cards.length > 0 ? (
        <Tabs
          className="md:hidden"
          label="Choose a stage"
          items={STAGE_ORDER.map((s) => ({
            label: STAGE_LABEL[s],
            href: buildHref(PATH, sp, { stage: s === "introduction_received" ? null : s }),
            current: s === query.stage,
            count: counts[s].length,
          }))}
        />
      ) : null}

      <FilterBar
        action={PATH}
        label="Filter the pipeline"
        hidden={{ stage: defaultStage ? undefined : query.stage }}
        resetHref={buildHref(PATH, {}, { stage: defaultStage ? null : query.stage })}
        active={query.filtered}
      >
        <Select
          name="assigned"
          label="Assigned to"
          hideLabel
          placeholder="Anyone"
          defaultValue={assignedValue}
          options={[{ value: "me", label: "Me" }, { value: "none", label: "Unassigned" }, ...staffList.filter((s) => s.value !== staff.id).map((s) => ({ value: s.value, label: s.label }))]}
        />
        <Select name="source" label="Came from" hideLabel placeholder="Any source" defaultValue={query.source ?? ""} options={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))} />
        <Select name="partner" label="Partner organisation" hideLabel placeholder="Any partner" defaultValue={query.partner ?? ""} options={partnerChoices} />
        <Select name="attention" label="Needs attention" hideLabel placeholder="All leads" defaultValue={query.attention ? "1" : ""} options={[{ value: "1", label: "Needs attention" }]} />
        <Select name="hide_lost" label="Lost prospects" hideLabel placeholder="Show lost" defaultValue={query.hideLost ? "1" : ""} options={[{ value: "1", label: "Hide lost" }]} />
      </FilterBar>

      {!pipeline.ok ? (
        <div className="mt-8">
          <ErrorState
            title="We could not load the pipeline"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        </div>
      ) : cards.length === 0 ? (
        <div className="mt-6">
          {query.filtered ? (
            <EmptyState
              title="No prospects match those filters"
              action={
                <LinkButton href={PATH} variant="secondary">
                  Clear filters
                </LinkButton>
              }
            >
              Clear the filters to see every prospect in the pipeline.
            </EmptyState>
          ) : (
            <EmptyState title="No prospects in the pipeline yet" action={recordAction}>
              {canWrite
                ? "Add a lead from your own marketing, the website or a direct approach, or record a partner's referral. Each one appears here at Introduction received, with its owner and next step."
                : "Nothing has been recorded yet. A new lead or a received referral appears here at Introduction received."}
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <p className="hq-muted mt-5 text-[13px]">
            {openCount} open {openCount === 1 ? "lead" : "leads"}
            {attentionCount > 0 && !query.attention ? (
              <>
                {", "}
                <a href={buildHref(PATH, sp, { attention: "1" })} className="underline underline-offset-2">
                  {attentionCount} {attentionCount === 1 ? "needs" : "need"} attention
                </a>
              </>
            ) : null}
            {totalEstimate.withEstimate > 0 ? `, ${formatAud(totalEstimate.estimateCents)} in estimates` : ""}.
            Longest-waiting first in each open column. Signed and lost are collapsed: open them with their headings.
          </p>

          <h2 className="sr-only">Pipeline board</h2>
          <div className="mt-2">
            <PipelineBoard
              cards={cards}
              activeStage={query.stage}
              role={staff.role}
              canMove={canWrite}
              today={today}
              timezone={staff.timezone}
              returnTo={returnTo}
            />
          </div>
          {pipeline.data.truncated ? (
            <InlineNote className="mt-4">
              Showing the first {PIPELINE_LIMIT.toLocaleString("en-AU")} prospects. Use the filters to narrow the board.
            </InlineNote>
          ) : null}
        </>
      )}
    </>
  );
}
