import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/hq/EmptyState";
import { LinkButton } from "@/components/hq/Button";
import { HQ_ROUTES } from "@/components/hq/nav";
import { Panel, PanelHeader, Skeleton, SkeletonText } from "@/components/hq/Primitives";
import { Timeline, TimelineItem } from "@/components/hq/Timeline";
import type { IconName } from "@/components/hq/icons";
import { INTERACTION_LABEL, STAGE_LABEL, OPEN_STAGES, type InteractionType } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import type { WidgetId } from "@/lib/hq/dashboard-widgets";
import { AwaitingVettingWidget, PreferredCoverageWidget, RecentContractorActivityWidget } from "../contractor-sections/widgets-contractors";
import { Rows, WidgetFailed, WidgetPanel, attempt, rowClass } from "./widget-chrome";
import { hasCap, loadOpenStageCounts, loadRecentInteractions, loadTopPartners, type DashCtx, type OpenStage } from "./data";

/*
 * The Reports panels (the registry is lib/hq/dashboard-widgets.ts). Server Components: each loads
 * its own data and renders it, so the page can stream them one by one inside Suspense boundaries.
 *
 * Rules every widget follows:
 *  - REAL data only. No placeholder figures. A widget with nothing to show says so and says what
 *    to do next, with a link to the right place.
 *  - A failure is contained. A loader that throws becomes a quiet error panel for that widget;
 *    the rest of the page carries on.
 *  - Figures are Hanken Grotesk (the kit's Stat); the display style appears only in empty-state titles.
 */

// ── chrome ───────────────────────────────────────────────────

/** What shows while a panel's data loads. */
export function PanelSkeleton({ id, title }: { id: WidgetId; title: string }) {
  return (
    <Panel aria-labelledby={`w-${id}`}>
      <PanelHeader id={`w-${id}`} title={title} />
      <div aria-busy="true" className="grid gap-3 pb-2">
        <Skeleton width="62%" />
        <SkeletonText lines={3} />
      </div>
    </Panel>
  );
}

// ── opportunities by stage ───────────────────────────────────

async function OpportunitiesByStage({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("opportunities-by-stage", () => loadOpenStageCounts());
  if (!r.ok) return <WidgetFailed id="opportunities-by-stage" title="Pipeline" />;
  const counts = r.data;
  const total = OPEN_STAGES.reduce((sum, s) => sum + counts[s as OpenStage], 0);
  const biggest = Math.max(1, ...OPEN_STAGES.map((s) => counts[s as OpenStage]));

  return (
    <WidgetPanel id="opportunities-by-stage" title="Pipeline" meta={total > 0 ? `${total} open` : undefined}>
      {total === 0 ? (
        <EmptyState
          compact
          title="No active opportunities"
          action={
            hasCap(ctx, "growth.write") ? (
              <LinkButton href={HQ_ROUTES.referralNew} size="sm">
                Record a referral
              </LinkButton>
            ) : (
              <LinkButton href={HQ_ROUTES.pipeline} size="sm">
                Open the pipeline
              </LinkButton>
            )
          }
        >
          Record a referral and it appears here as an opportunity, from introduction through to a signed management.
        </EmptyState>
      ) : (
        <>
          <Rows label="Open opportunities by stage">
            {OPEN_STAGES.map((s) => {
              const n = counts[s as OpenStage];
              return (
                <li key={s} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2rem] items-center gap-3 py-1.5 text-[14px]">
                  <span className={n === 0 ? "hq-muted" : undefined}>{STAGE_LABEL[s]}</span>
                  <span aria-hidden="true" className="block h-1.5 bg-line">
                    <span className="block h-full bg-charcoal" style={{ width: `${(n / biggest) * 100}%` }} />
                  </span>
                  <span className={`hq-nums text-right ${n === 0 ? "hq-muted" : "font-semibold"}`}>{n}</span>
                </li>
              );
            })}
          </Rows>
          <p className="mt-3 border-t border-line pt-3 text-[13px]">
            <Link href={HQ_ROUTES.pipeline} className="hq-muted underline underline-offset-2">
              Open the pipeline
            </Link>
          </p>
        </>
      )}
    </WidgetPanel>
  );
}

// ── partner activity: recent interactions ────────────────────

const INTERACTION_ICON: Record<InteractionType, IconName> = {
  phone_call: "phone",
  coffee_meeting: "coffee",
  office_meeting: "calendar",
  email: "mail",
  message: "message",
  note: "note",
};

async function PartnerActivity({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("partner-activity", () => loadRecentInteractions());
  if (!r.ok) return <WidgetFailed id="partner-activity" title="Latest calls and meetings" />;

  return (
    <WidgetPanel id="partner-activity" title="Latest calls and meetings" meta={r.data.length > 0 ? "Latest" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState compact title="Nothing logged yet">
          Calls, coffees and emails you record against a partner build the relationship timeline here.
        </EmptyState>
      ) : (
        <Timeline label="Latest partner activity">
          {r.data.map((i) => {
            const who = i.contactName ?? i.organisationName ?? "a partner";
            const href = i.contactId ? `${HQ_ROUTES.contacts}/${i.contactId}` : i.organisationId ? `${HQ_ROUTES.organisations}/${i.organisationId}` : null;
            return (
              <TimelineItem
                key={i.id}
                icon={INTERACTION_ICON[i.type]}
                title={
                  <>
                    {INTERACTION_LABEL[i.type]} with{" "}
                    {href ? (
                      <Link href={href} className="underline-offset-2 hover:underline">
                        {who}
                      </Link>
                    ) : (
                      who
                    )}
                  </>
                }
                meta={[formatDateTime(i.occurredAt, ctx.timezone), i.staffName].filter(Boolean).join(" · ")}
              >
                <span className="line-clamp-2">{i.summary}</span>
              </TimelineItem>
            );
          })}
        </Timeline>
      )}
    </WidgetPanel>
  );
}

// ── referral partners ────────────────────────────────────────

async function PartnerReferrals({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("partner-referrals", () => loadTopPartners());
  if (!r.ok) return <WidgetFailed id="partner-referrals" title="Partners sending referrals" />;

  return (
    <WidgetPanel id="partner-referrals" title="Partners sending referrals" meta={r.data.length > 0 ? "Most referrals first" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState
          compact
          title="No referrals recorded yet"
          action={
            hasCap(ctx, "growth.write") ? (
              <LinkButton href={HQ_ROUTES.referralNew} size="sm">
                Record a referral
              </LinkButton>
            ) : (
              <LinkButton href={HQ_ROUTES.referrals} size="sm">
                Open referrals
              </LinkButton>
            )
          }
        >
          When referrals are recorded, the partners sending and receiving them appear here with how many signed.
        </EmptyState>
      ) : (
        <Rows label="Referral partners">
          {r.data.map((p) => (
            <li key={p.id} className={rowClass}>
              <Link href={`${HQ_ROUTES.organisations}/${p.id}`} className="min-w-0 font-medium underline-offset-2 hover:underline">
                {p.name}
              </Link>
              <p className="hq-muted hq-nums text-[13px]">
                {p.received} received · {p.sent} sent · {p.signed} signed
              </p>
            </li>
          ))}
        </Rows>
      )}
      {r.data.length > 0 ? (
        <p className="mt-3 border-t border-line pt-3 text-[13px]">
          <Link href={HQ_ROUTES.referralPartners} className="hq-muted underline underline-offset-2">
            All referral partners
          </Link>
        </p>
      ) : null}
    </WidgetPanel>
  );
}

// ── the registry's components ────────────────────────────────

/** Draws one Reports panel. Every id in the registry has a case here. */
export function renderPanel(id: WidgetId, ctx: DashCtx): ReactNode {
  switch (id) {
    case "opportunities-by-stage":
      return <OpportunitiesByStage ctx={ctx} />;
    case "partner-activity":
      return <PartnerActivity ctx={ctx} />;
    case "partner-referrals":
      return <PartnerReferrals ctx={ctx} />;
    case "contractors-awaiting-vetting":
      return <AwaitingVettingWidget ctx={ctx} />;
    case "contractors-preferred-coverage":
      return <PreferredCoverageWidget ctx={ctx} />;
    case "contractors-recent-activity":
      return <RecentContractorActivityWidget ctx={ctx} />;
    default:
      // A new registry id without a case here fails the type check.
      return id satisfies never;
  }
}

