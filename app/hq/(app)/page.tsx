import type { Metadata } from "next";
import { Suspense } from "react";
import { LinkButton } from "@/components/hq/Button";
import { EmptyState } from "@/components/hq/EmptyState";
import { HQ_ROUTES } from "@/components/hq/nav";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote, SectionLabel } from "@/components/hq/Primitives";
import { Tabs } from "@/components/hq/Tabs";
import { buildHref } from "@/components/hq/url";
import { CustomiseDashboard } from "@/components/hq/features/dashboard/CustomiseDashboard";
import type { DashCtx } from "@/components/hq/features/dashboard/data";
import { PanelSkeleton, StatsBand, StatsSkeleton, renderPanel } from "@/components/hq/features/dashboard/widgets";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { availableWidgets, hasCustomLayout, resolveWidgets, widgetDef } from "@/lib/hq/dashboard-widgets";
import { todayIn } from "@/lib/hq/format";
import { longDateIn, welcomeTitle } from "@/lib/hq/greeting";
import { DEFAULT_PERIOD, PERIODS, PERIOD_SHORT_LABEL, parsePeriod, periodStart } from "@/lib/hq/periods";

export const metadata: Metadata = { title: "Dashboard" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/*
 * The dashboard: role-aware, real data only. Which widgets appear comes from the registry in
 * lib/hq/dashboard-widgets.ts: the person's own choice (staff_profiles.dashboard_widgets) or
 * the default for their role, limited to what their capabilities allow. The figures sit in one
 * band across the top; every other widget is a panel that loads on its own inside Suspense, so
 * a slow or failing widget never holds up or breaks the rest of the page.
 *
 * requireStaff() here is the page's own gate: the (app) layout is only the first one.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, db, can } = await requireStaff();
  const sp = await searchParams;

  const [todayResult, layoutResult] = await Promise.all([
    db.rpc("today"),
    db.from("staff_profiles").select("dashboard_widgets").eq("id", staff.id).maybeSingle(),
  ]);
  if (todayResult.error) console.error("[hq] today() failed:", todayResult.error.code);
  if (layoutResult.error) console.error("[hq] reading the dashboard layout failed:", layoutResult.error.code);

  // Dates in the business timezone (the same day the database uses for "overdue"); moments in the person's own.
  const today = typeof todayResult.data === "string" ? todayResult.data : todayIn(staff.timezone);
  const saved = layoutResult.data?.dashboard_widgets ?? null;

  const widgets = resolveWidgets({ role: staff.role, capabilities: staff.capabilities, saved });
  const statIds = widgets.filter((id) => widgetDef(id).kind === "stat");
  const panelIds = widgets.filter((id) => widgetDef(id).kind === "panel");

  const period = parsePeriod(sp.period);
  const since = periodStart(period, today);
  const ctx: DashCtx = { staffId: staff.id, timezone: staff.timezone, today, capabilities: staff.capabilities };

  // Where "Complete" and friends come back to: this page as it is now, without any one-off toast parameters.
  const quiet = { toast: null, toast_tone: null, denied: null } as const;
  const returnTo = buildHref(HQ_BASE, sp, quiet);
  const denied = Boolean(one(sp.denied));

  return (
    <>
      <PageHeader
        variant="welcome"
        eyebrow={longDateIn(staff.timezone)}
        title={welcomeTitle(staff.firstName, staff.timezone)}
        actions={
          <>
            <CustomiseDashboard
              options={availableWidgets(staff.capabilities).map((w) => ({ id: w.id, title: w.title, description: w.description }))}
              selected={widgets}
              customised={hasCustomLayout(saved)}
            />
            {can("growth.write") ? (
              <LinkButton href={HQ_ROUTES.referralNew} variant="primary">
                Record a referral
              </LinkButton>
            ) : null}
          </>
        }
      />

      {denied ? (
        <InlineNote className="mt-6">
          Your role does not include that part of Planted HQ. If you think it should, ask a director or an administrator.
        </InlineNote>
      ) : null}

      {statIds.length > 0 ? (
        <section aria-label="At a glance" className="mt-8">
          {statIds.includes("referrals-summary") ? (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <SectionLabel>Referral figures</SectionLabel>
              <Tabs
                label="Period for the referral figures"
                items={PERIODS.map((p) => ({
                  label: PERIOD_SHORT_LABEL[p],
                  href: buildHref(HQ_BASE, sp, { ...quiet, period: p === DEFAULT_PERIOD ? null : p }),
                  current: p === period,
                }))}
              />
            </div>
          ) : null}
          <Suspense fallback={<StatsSkeleton />}>
            <StatsBand ids={statIds} period={period} since={since} />
          </Suspense>
        </section>
      ) : null}

      {panelIds.length > 0 ? (
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-2">
          {panelIds.map((id) => (
            <Suspense key={id} fallback={<PanelSkeleton id={id} title={widgetDef(id).title} />}>
              {renderPanel(id, ctx, returnTo)}
            </Suspense>
          ))}
        </div>
      ) : null}

      {widgets.length === 0 ? (
        <EmptyState title="Nothing to show yet">Use Customise to choose what your dashboard shows.</EmptyState>
      ) : null}
    </>
  );
}
