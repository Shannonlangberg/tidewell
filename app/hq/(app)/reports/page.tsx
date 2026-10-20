import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LinkButton } from "@/components/hq/Button";
import { ErrorState } from "@/components/hq/EmptyState";
import { HQ_ROUTES } from "@/components/hq/nav";
import { PageHeader } from "@/components/hq/PageHeader";
import { SectionLabel } from "@/components/hq/Primitives";
import { Stat, StatBand } from "@/components/hq/Stat";
import { Tabs } from "@/components/hq/Tabs";
import { buildHref } from "@/components/hq/url";
import type { DashCtx } from "@/components/hq/features/dashboard/data";
import { PanelSkeleton, renderPanel } from "@/components/hq/features/dashboard/widgets";
import { attempt } from "@/components/hq/features/dashboard/widget-chrome";
import { loadContractorSummary } from "@/lib/hq/contractors/widgets-data";
import { requireStaff } from "@/lib/hq/auth";
import { reportPanels, widgetDef, type WidgetId } from "@/lib/hq/dashboard-widgets";
import { formatAud, formatDate, plural, todayIn } from "@/lib/hq/format";
import { formatConversion } from "@/lib/hq/referrals/numbers";
import { DEFAULT_GROWTH_PERIOD, GROWTH_PERIODS, GROWTH_PERIOD_LABEL, growthPeriodStart, growthPeriodTitle, parseGrowthPeriod } from "@/lib/hq/referrals/periods";
import { countAdditionalClaims, loadGrowthSummary } from "@/lib/hq/referrals/queries";

export const metadata: Metadata = { title: "Reports" };

const PATH = HQ_ROUTES.reports;
type SP = Record<string, string | string[] | undefined>;

/*
 * Reports: the figures and trends that used to crowd the dashboard. Referral figures for a chosen
 * period (the same growth_summary the Growth overview reads), the pipeline, the partners sending
 * referrals, and contractor coverage. Every number is a count of real rows, read as the signed-in
 * person, so row level security decides what each person sees; a section the person's role does
 * not include is not drawn at all.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { staff, db, can } = await requireStaff(undefined, false, buildHref(PATH, sp));
  const growth = can("growth.read");

  const todayResult = await db.rpc("today");
  const today = typeof todayResult.data === "string" ? todayResult.data : todayIn(staff.timezone);
  const period = parseGrowthPeriod(sp.period);
  const since = growthPeriodStart(period, today);

  const [summary, claims] = growth ? await Promise.all([loadGrowthSummary(db, since), countAdditionalClaims(db, since)]) : [null, null];
  const s = summary?.ok ? summary.data : null;

  // The reporting panels (lib/hq/dashboard-widgets.ts), each shown only to people whose capabilities allow it.
  const growthPanels = reportPanels("growth", staff.capabilities);
  const allowedContractorPanels = reportPanels("contractors", staff.capabilities);
  // An empty "Being vetted" box says nothing: when nobody is being vetted it becomes one line instead.
  const vetting = allowedContractorPanels.includes("contractors-awaiting-vetting") ? await attempt("reports: vetting", () => loadContractorSummary()) : null;
  const nobodyVetting = vetting?.ok === true && vetting.data.awaitingVetting === 0;
  const contractorPanels = allowedContractorPanels.filter((id) => !(nobodyVetting && id === "contractors-awaiting-vetting"));
  const ctx: DashCtx = { staffId: staff.id, timezone: staff.timezone, today, capabilities: staff.capabilities };

  const periodTitle = growthPeriodTitle(period, today);
  const referrals = HQ_ROUTES.referrals;
  const registerFrom = period === "all" ? {} : { from: since };
  const signedValue = s && s.managementsSigned > 0 && s.estimatedValueSignedCents > 0 ? formatAud(s.estimatedValueSignedCents) : null;

  const panels = (ids: readonly WidgetId[]) => (
    <div className="hq-reports__grid">
      {ids.map((id) => (
        <Suspense key={id} fallback={<PanelSkeleton id={id} title={widgetDef(id).title} />}>
          {renderPanel(id, ctx)}
        </Suspense>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Reports" description="Figures from the records in HQ. For what to do today, go to Today." />

      {growth ? (
        <section aria-labelledby="referrals-h" className="hq-reports__section">
          <div className="hq-reports__head">
            <SectionLabel as="h2" id="referrals-h">
              Referrals
            </SectionLabel>
            <Tabs
              label="Period for the referral figures"
              items={GROWTH_PERIODS.map((p) => ({
                label: GROWTH_PERIOD_LABEL[p],
                href: buildHref(PATH, sp, { period: p === DEFAULT_GROWTH_PERIOD ? null : p, toast: null, toast_tone: null }),
                current: p === period,
              }))}
            />
          </div>
          {s ? (
            <>
              <StatBand label={`Referrals and managements, ${periodTitle.toLowerCase()}`} columns={3}>
                <Stat label="Received" value={s.referralsReceived} href={buildHref(referrals, {}, { direction: "received", ...registerFrom })} hint="Introductions from partners." />
                <Stat label="Sent" value={s.referralsSent} href={buildHref(referrals, {}, { direction: "sent", ...registerFrom })} hint="Introductions you made." />
                <Stat label="Qualified" value={s.qualified} href={HQ_ROUTES.pipeline} hint="Reached Qualified." />
                <Stat label="Managements signed" value={s.managementsSigned} href={HQ_ROUTES.pipeline} hint="Each counted once." />
                <Stat label="Conversion" value={s.conversion === null ? null : formatConversion(s.conversion)} hint={s.conversion === null ? "Needs a referral received." : "Signed out of received."} />
                <Stat label="Estimated value signed" value={signedValue} hint={signedValue ? "Your own yearly estimates." : "Needs a signed management with an estimate."} />
              </StatBand>
              <details className="hq-reports__how">
                <summary>How these are counted</summary>
                <p>
                  {periodTitle}
                  {period === "all" ? "" : `, from ${formatDate(since, staff.timezone)} to today`}. Referrals count by the date of the introduction, managements by the date they were
                  signed. A management is counted once and credited to the partner who first introduced the prospect.
                  {claims ? ` Received includes ${plural(claims, "further claim")} on prospects already in the pipeline.` : ""}
                </p>
              </details>
              <p className="hq-reports__link">
                <Link href={HQ_ROUTES.growth}>Every partner&rsquo;s figures, in Growth</Link>
              </p>
            </>
          ) : (
            <ErrorState
              title="We could not load the referral figures"
              action={
                <LinkButton href={buildHref(PATH, sp)} size="sm">
                  Try again
                </LinkButton>
              }
            />
          )}
          {growthPanels.length > 0 ? panels(growthPanels) : null}
        </section>
      ) : null}

      {contractorPanels.length > 0 ? (
        <section aria-labelledby="contractors-h" className="hq-reports__section">
          <div className="hq-reports__head">
            <SectionLabel as="h2" id="contractors-h">
              Contractors
            </SectionLabel>
          </div>
          {nobodyVetting ? <p className="hq-reports__link hq-muted">Nobody is being vetted at the moment.</p> : null}
          {panels(contractorPanels)}
        </section>
      ) : null}

      {!growth && contractorPanels.length === 0 ? <p className="hq-today__quiet">There are no reports for your role yet.</p> : null}
    </>
  );
}
