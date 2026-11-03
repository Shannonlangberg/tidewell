import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton, buttonClass } from "@/components/hq/Button";
import { cx } from "@/components/hq/cx";
import { HQ_ROUTES } from "@/components/hq/nav";
import { buildHref } from "@/components/hq/url";
import { ceo as s } from "@/components/hq/features/ceo/parts";
import { Awaiting, GrowthEngine, HowCounted, Leadership, Portfolio, Scorecard, StandardAndFinance, derive, type CeoView } from "@/components/hq/features/ceo/sections";
import { TargetsForm } from "@/components/hq/features/ceo/TargetsForm";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { formatDate, formatDateTime, todayIn } from "@/lib/hq/format";
import { longDateIn, welcomeTitle } from "@/lib/hq/greeting";
import { PERIODS, PERIOD_LABEL, parsePeriodParams, resolvePeriod } from "@/lib/hq/ceo/periods";
import { briefing } from "@/lib/hq/ceo/rules";
import { loadCeoData } from "@/lib/hq/ceo/queries";
import { setCeoTargets } from "./actions";

export const metadata: Metadata = { title: "Command Centre" };

const PATH = `${HQ_BASE}/ceo`;
type SP = Record<string, string | string[] | undefined>;

/*
 * The CEO Command Centre (docs/hq-ceo-command-centre.md): how the business is performing, whether it is
 * growing fast enough, whether it is financially healthy, whether service is excellent, and what needs a
 * decision today. Live, from the records in HQ, for whoever holds planning.read (directors; administrators
 * read). Each row also needs the capability of the records it reads, and is simply absent without it.
 *
 * Read-only: nothing on this page changes a record except the weekly targets (directors). Every figure
 * links to the HQ page that holds its records.
 */
export default async function CeoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { staff, db, can } = await requireStaff("planning.read", false, buildHref(PATH, sp));

  const t = await db.rpc("today");
  const today = typeof t.data === "string" ? t.data : todayIn(staff.timezone);
  const pp = parsePeriodParams(sp);
  const period = resolvePeriod(pp.key, today, { from: pp.from, to: pp.to });
  const data = await loadCeoData(db, staff, can, period, today);
  const v: CeoView = { data, period, today, timezone: staff.timezone, can };
  const { o, b, managed, totals } = derive(v);

  const launch = data.launch?.ok ? data.launch.data : null;
  const lines = briefing(
    {
      managed: managed ? managed.managed : null,
      onboarding: managed ? managed.onboarding : null,
      target: b ? b.goal.target : null,
      goalDate: b ? b.goal.date : null,
      openOpportunities: totals ? totals.open : null,
      proposalsAwaiting: totals ? totals.proposals : null,
      followUpsDue: totals ? totals.followUpsDue : null,
      priorities: data.priorities?.ok ? data.priorities.data.length : null,
      launchOpenGates: launch ? launch.readiness.openGates.length : null,
      decisionsForMe: data.decisionsForMe,
    },
    (d) => formatDate(d, staff.timezone),
  );

  const periodHref = (key: string) => buildHref(PATH, sp, { period: key === "month" ? null : key, from: null, to: null });

  return (
    <div>
      <header className={s.header}>
        <div>
          <p className={s.eyebrow}>{longDateIn(staff.timezone)} · Command Centre</p>
          <h1 className={s.greeting}>{welcomeTitle(staff.firstName, staff.timezone)}</h1>
          {lines.length ? (
            <p className={s.briefing}>
              {lines.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </p>
          ) : null}
        </div>
        <div className={s.headerAside}>
          <div className={s.headerActions}>
            <LinkButton href={buildHref(`${PATH}/report`, {}, {})} variant="primary" icon="note">
              This week at Planted
            </LinkButton>
          </div>
          {o ? (
            <p className={s.fresh} title="Every figure is read from HQ when the page loads.">
              Live · read {formatDateTime(o.generatedAt, staff.timezone)}
              {o.latestChangeAt ? ` · last record change ${formatDateTime(o.latestChangeAt, staff.timezone)}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      <div className={s.periodBar}>
        <p className={s.periodTitle}>
          <strong>{period.title}</strong>
          {period.previous ? <> · compared with {period.previous.title}</> : null}
        </p>
        <nav aria-label="Period" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className={s.segments}>
            {PERIODS.filter((p) => p !== "custom").map((p) => (
              <Link key={p} href={periodHref(p)} className={s.segment} aria-current={period.key === p ? "true" : undefined} scroll={false}>
                {PERIOD_LABEL[p]}
              </Link>
            ))}
          </div>
          <details className={s.custom}>
            <summary className={cx(s.segments)} style={{ padding: 3 }}>
              <span className={s.segment} aria-current={period.key === "custom" ? "true" : undefined}>
                {PERIOD_LABEL.custom}
              </span>
            </summary>
            <form method="get" action={PATH} className={s.customForm}>
              <input type="hidden" name="period" value="custom" />
              <label>
                From
                <input type="date" name="from" required max={today} defaultValue={period.key === "custom" ? period.from : ""} />
              </label>
              <label>
                To
                <input type="date" name="to" required max={today} defaultValue={period.key === "custom" ? period.to : today} />
              </label>
              <button type="submit" className={buttonClass({ variant: "primary", size: "sm" })}>
                Show this range
              </button>
            </form>
          </details>
        </nav>
      </div>
      {period.adjusted ? <p className={s.adjusted}>{period.adjusted}</p> : null}

      <Scorecard v={v} />
      <Portfolio v={v} />
      <GrowthEngine v={v} targetsForm={<TargetsForm action={setCeoTargets} targets={o?.targets ?? null} />} />
      <Leadership v={v} />
      <StandardAndFinance v={v} />
      <Awaiting />
      {o?.notes.length ? <p className={s.how}>{o.notes.join(" ")}</p> : null}
      <HowCounted v={v} />
      <p className={s.how}>
        Figures for the whole business also live in <Link href={HQ_ROUTES.reports}>Reports</Link>; today&rsquo;s own work is on <Link href={HQ_ROUTES.dashboard}>Today</Link>.
      </p>
    </div>
  );
}
