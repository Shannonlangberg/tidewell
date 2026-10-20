import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { EmptyState } from "@/components/hq/EmptyState";
import { StatusChip } from "@/components/hq/StatusChip";
import { Timeline, TimelineItem } from "@/components/hq/Timeline";
import { HQ_ROUTES } from "@/components/hq/nav";
import { MoreLink, Rows, WidgetFailed, WidgetPanel, attempt, rowClass } from "@/components/hq/features/dashboard/widget-chrome";
import { hasCap, type DashCtx } from "@/components/hq/features/dashboard/data";
import { CONTRACTOR_STATUS_LABEL, CONTRACTOR_STATUS_TONE, VETTING_STEPS } from "@/lib/hq/constants";
import { coverageLabel, coveredTrades } from "@/lib/hq/contractors/widgets-summary";
import { loadAwaitingVetting, loadContractorSummary, loadRecentContractorActivity } from "@/lib/hq/contractors/widgets-data";
import { formatDateTime, plural } from "@/lib/hq/format";
import { timelineIcon } from "./TimelineSection";
import type { TimelineEvent } from "@/lib/hq/contractors/timeline-queries";

/*
 * The three contractor Reports panels (Phase 2). Server Components in the same mould as the Phase 1
 * widgets: each loads its own data as the signed-in person, shows REAL figures only, and turns a failing
 * loader into a quiet error panel. renderPanel() in dashboard/widgets.tsx decides who gets them, from the
 * registry in lib/hq/dashboard-widgets.ts (they need contractors.read).
 */

const profile = (id: string) => `${HQ_ROUTES.partners}/${id}`;

// ── awaiting vetting ─────────────────────────────────────────

export async function AwaitingVettingWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-awaiting-vetting", async () => {
    const [summary, items] = await Promise.all([loadContractorSummary(), loadAwaitingVetting()]);
    return { summary, items };
  });
  const title = "Being vetted";
  if (!r.ok) return <WidgetFailed id="contractors-awaiting-vetting" title={title} />;
  const { summary, items } = r.data;

  return (
    <WidgetPanel id="contractors-awaiting-vetting" title={title} meta={summary.awaitingVetting > 0 ? String(summary.awaitingVetting) : undefined}>
      {items.length === 0 ? (
        summary.total === 0 ? (
          <EmptyState
            compact
            title="No contractors yet"
            action={
              <LinkButton href={HQ_ROUTES.partners} size="sm">
                Open contractors
              </LinkButton>
            }
          >
            {hasCap(ctx, "contractors.write") ? "Add a contractor or import the maintenance prospects, and anyone being vetted appears here." : "Contractors being vetted will appear here."}
          </EmptyState>
        ) : (
          <EmptyState compact title="Nobody is awaiting vetting">
            Contractors in the vetting stage, or with checklist steps under way, appear here.
          </EmptyState>
        )
      ) : (
        <>
          <Rows label="Being vetted">
            {items.map((c) => (
              <li key={c.id} className={rowClass}>
                <div className="min-w-0">
                  <Link href={profile(c.id)} className="font-medium underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <p className="hq-muted hq-nums text-[13px]">
                    {c.doneCount} of {VETTING_STEPS.length} steps
                  </p>
                </div>
                <StatusChip tone={CONTRACTOR_STATUS_TONE[c.status]}>{CONTRACTOR_STATUS_LABEL[c.status]}</StatusChip>
              </li>
            ))}
          </Rows>
          <MoreLink shown={items.length} total={summary.awaitingVetting} href={HQ_ROUTES.partners} noun="contractor" />
        </>
      )}
    </WidgetPanel>
  );
}

// ── preferred contractor coverage ────────────────────────────


export async function PreferredCoverageWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-preferred-coverage", () => loadContractorSummary());
  const title = "Trades covered";
  if (!r.ok) return <WidgetFailed id="contractors-preferred-coverage" title={title} />;
  const s = r.data;
  const covered = coveredTrades(s.coverage);
  const uncovered = s.tradesWithoutCover;
  // Labels are the owner's, from hq.trades (contractor_summary sends them with each trade).
  const labelFor = (slug: string) => coverageLabel(s.coverage, slug);
  const tradeCount = covered.length + uncovered.length;

  return (
    <WidgetPanel id="contractors-preferred-coverage" title={title} meta={tradeCount > 0 ? `${covered.length} of ${tradeCount} trades` : undefined}>
      {s.total === 0 ? (
        <EmptyState
          compact
          title="No contractors yet"
          action={
            <LinkButton href={HQ_ROUTES.partners} size="sm">
              Open contractors
            </LinkButton>
          }
        >
          {hasCap(ctx, "contractors.write") ? "Once contractors are approved, this shows which trades have one and which do not." : "This shows which trades have an approved contractor."}
        </EmptyState>
      ) : (
        <>
          {uncovered.length > 0 ? (
            <div>
              <p className="text-[14px] font-medium">No approved contractor for {plural(uncovered.length, "trade")}</p>
              <p className="hq-muted mt-1 text-[14px]">{uncovered.map(labelFor).join(", ")}.</p>
            </div>
          ) : (
            <p className="text-[14px] font-medium">Every trade has at least one approved contractor.</p>
          )}
          {covered.length > 0 ? (
            <Rows label="Trades with an approved contractor">
              <li className="mt-4 border-t border-line pt-3" aria-hidden="true" />
              {covered.map((c) => (
                <li key={c.category} className={rowClass}>
                  <span className="font-medium">{labelFor(c.category)}</span>
                  <span className="hq-muted hq-nums text-[13px]">
                    {c.approved} approved
                    {c.preferred > 0 ? ` · ${c.preferred} preferred` : ""}
                  </span>
                </li>
              ))}
            </Rows>
          ) : null}
          <p className="hq-muted mt-4 border-t border-line pt-3 text-[13px]">
            Counts contractors a person has approved or marked preferred. Prospects and contractors being vetted do not count.{" "}
            <Link href={HQ_ROUTES.partnerTrades} className="text-charcoal underline underline-offset-2">
              See every trade
            </Link>
          </p>
        </>
      )}
    </WidgetPanel>
  );
}

// ── recent activity ──────────────────────────────────────────

export async function RecentContractorActivityWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-recent-activity", () => loadRecentContractorActivity());
  const title = "Latest contractor changes";
  if (!r.ok) return <WidgetFailed id="contractors-recent-activity" title={title} />;

  return (
    <WidgetPanel id="contractors-recent-activity" title={title} meta={r.data.length > 0 ? "Newest first" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState
          compact
          title="No activity yet"
          action={
            <LinkButton href={HQ_ROUTES.partners} size="sm">
              Open contractors
            </LinkButton>
          }
        >
          Status changes, checklist steps, documents, feedback and logged contacts across your contractors appear here.
        </EmptyState>
      ) : (
        <Timeline label="Latest contractor changes">
          {r.data.map((a) => (
            <TimelineItem
              key={a.key}
              icon={timelineIcon({ kind: a.kind as TimelineEvent["kind"], interactionType: a.interactionType })}
              title={
                <Link href={profile(a.contractorId)} className="underline-offset-2 hover:underline">
                  {a.name}
                </Link>
              }
              meta={[formatDateTime(a.occurredAt, ctx.timezone), a.actorName].filter(Boolean).join(" · ")}
            >
              <span className="line-clamp-2">{a.summary}</span>
            </TimelineItem>
          ))}
        </Timeline>
      )}
    </WidgetPanel>
  );
}
