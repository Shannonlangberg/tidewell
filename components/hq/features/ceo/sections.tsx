import Link from "next/link";
import type { ReactNode } from "react";
import { HQ_ROUTES } from "../../nav";
import { cx } from "../../cx";
import { Icon } from "../../icons";
import { formatAud, formatDate, plural } from "@/lib/hq/format";
import { STAGE_HINT, STAGE_LABEL as PATH_LABEL, RELATIONSHIP_STAGES, milestoneState, planningAmount, planningStatusLabel } from "@/lib/hq/leadership/rules";
import { HEALTH_LABEL } from "@/lib/hq/projects/rules";
import type { ProjectHealth } from "@/lib/hq/projects/types";
import type { Capability } from "@/lib/hq/constants";
import type { Period } from "@/lib/hq/ceo/periods";
import {
  LOST_REASON_LABEL,
  STAGE_LABEL,
  activityRows,
  change,
  changeText,
  conversionSteps,
  feeSummary,
  funnelTotals,
  goalProgress,
  hoursText,
  overallConversion,
  pctText,
  retention,
  signingTarget,
  type CeoOverview,
} from "@/lib/hq/ceo/rules";
import { PRIORITY_KIND_LABEL } from "@/lib/hq/ceo/priorities";
import { CEO_HREF, type CeoData } from "@/lib/hq/ceo/queries";
import type { BusinessSummary } from "@/lib/hq/portfolio/rules";
import { GrowthChart } from "./GrowthChart";
import { ceo as s, Delta, Empty, Failed, Figure, GoalRing, Kpi, Meter, Panel, Section, Setup, Sparkline, Tag } from "./parts";

/*
 * The CEO Command Centre's rows (docs/hq-ceo-command-centre.md), each drawn from what loadCeoData read.
 * A row the person's role does not include is not drawn; a panel whose read failed says so in itself.
 * Every figure here is a count of records, or a calculation from lib/hq/ceo/rules.ts with its basis shown.
 */

export type CeoView = {
  data: CeoData;
  period: Period;
  today: string;
  timezone: string;
  can: (c: Capability) => boolean;
};

const ok = <T,>(p: { ok: true; data: T } | { ok: false } | null): T | null => (p && p.ok ? p.data : null);
const failed = (p: { ok: boolean } | null) => !!p && !p.ok;
const PIPELINE = HQ_ROUTES.pipeline;
const PROPERTIES = HQ_ROUTES.portfolio;

export function derive(v: CeoView) {
  const o: CeoOverview | null = ok(v.data.overview);
  const b: BusinessSummary | null = ok(v.data.business);
  const managed = b?.managed ?? null;
  const goal = b ? goalProgress(managed?.managed ?? 0, b.goal.target, b.goal.date, v.today) : null;
  const totals = o?.funnel ? funnelTotals(o.funnel) : null;
  const fees = o?.economics ? feeSummary(o.economics) : null;
  const against = v.period.previous?.title ?? "the period before";
  return { o, b, managed, goal, totals, fees, against };
}

// ════════════════════════════════════════════════════════════
// Row 1: the CEO scorecard
// ════════════════════════════════════════════════════════════

export function Scorecard({ v }: { v: CeoView }) {
  const { o, managed, goal, totals, fees, against } = derive(v);
  const pp = o?.period.portfolio ?? null;
  const prevP = o?.previous?.portfolio ?? null;
  const pg = o?.period.growth ?? null;
  const prevG = o?.previous?.growth ?? null;
  const canP = v.can("portfolio.read");
  const canG = v.can("growth.read");
  const signedTarget = goal ? signingTarget(goal.neededPerMonth, v.period.days) : null;
  const ret = pp ? retention(pp) : null;
  const feesChange = pp && prevP && pp.feesAtEndWithTerms > 0 && prevP.feesAtEndWithTerms > 0 ? change(pp.feesAtEndCents, prevP.feesAtEndCents) : null;
  const netChange = pp ? change(pp.managedAtEnd, pp.managedAtStart) : null;

  return (
    <div className={s.kpis} role="list" aria-label="CEO scorecard">
      {canP ? (
        <div role="listitem" style={{ display: "contents" }}>
          <Kpi
            label="Managed properties"
            href={PROPERTIES}
            value={managed ? managed.managed : "—"}
            muted={!managed}
            unit={goal ? `of ${goal.target}` : undefined}
            sub={managed ? `${managed.active} active · ${managed.onboarding} onboarding · ${managed.longTerm.managed} long-term, ${managed.shortTerm.managed} short-term` : "Could not be loaded"}
          >
            {goal ? <Meter value={goal.managed} max={goal.target} label={`${goal.managed} of ${goal.target} managed properties`} /> : null}
            {netChange && pp ? <Delta change={netChange} text={pp.started || pp.ended ? `Net ${pp.started - pp.ended >= 0 ? "+" : "−"}${Math.abs(pp.started - pp.ended)} (${pp.started} new, ${pp.ended} lost)` : "No change this period"} /> : null}
          </Kpi>
        </div>
      ) : null}
      {canP ? (
        <div role="listitem" style={{ display: "contents" }}>
          <Kpi
            label="Contracted annual fees"
            href={PROPERTIES}
            value={fees?.annualCents !== null && fees?.annualCents !== undefined ? formatAud(fees.annualCents) : "Not recorded"}
            muted={fees?.annualCents === null || fees?.annualCents === undefined}
            sub={
              !fees
                ? "Could not be loaded"
                : fees.properties === 0
                  ? "Starts with the first management. Agreements only, never income received."
                  : fees.missing > 0
                    ? `${fees.withTerms} of ${fees.properties} properties have their rent and fee recorded`
                    : "From each agreement's rent and fee, excluding GST"
            }
          >
            <Delta change={feesChange} text={changeText(feesChange, against, true, formatAud)} />
            {totals && totals.valueCents > 0 ? <Tag kind="estimate">Pipeline estimate {formatAud(totals.valueCents)}, separate</Tag> : null}
          </Kpi>
        </div>
      ) : null}
      {canG ? (
        <div role="listitem" style={{ display: "contents" }}>
          <Kpi
            label="Growth pipeline"
            href={PIPELINE}
            value={totals ? totals.open : "—"}
            muted={!totals}
            unit={totals ? (totals.open === 1 ? "opportunity" : "opportunities") : undefined}
            sub={totals ? `${totals.qualifiedOrLater} qualified or further · ${plural(totals.proposals, "proposal")} awaiting a decision` : "Could not be loaded"}
          >
            {totals ? (
              totals.withEstimate > 0 ? (
                <Tag kind="estimate">{formatAud(totals.valueCents)} a year, estimated</Tag>
              ) : (
                <span className={s.kpiSub}>No yearly-fee estimates recorded yet</span>
              )
            ) : null}
          </Kpi>
        </div>
      ) : null}
      {canG ? (
        <div role="listitem" style={{ display: "contents" }}>
          <Kpi label="Managements signed" href={PIPELINE} value={pg ? pg.signed : "—"} muted={!pg} unit={signedTarget !== null ? `of ${signedTarget} on pace` : undefined} sub={v.period.title}>
            {pg && prevG ? <Delta change={change(pg.signed, prevG.signed)} text={changeText(change(pg.signed, prevG.signed), against)} /> : null}
            {signedTarget === null && goal ? <span className={s.kpiSub}>Set a goal date for a signing pace</span> : null}
          </Kpi>
        </div>
      ) : null}
      {canP ? (
        <div role="listitem" style={{ display: "contents" }}>
          <Kpi
            label="Client retention"
            href={`${PROPERTIES}?status=ended`}
            value={ret && ret.base > 0 ? (ret.pct !== null ? pctText(ret.pct) : `${ret.retained} of ${ret.base}`) : "—"}
            muted={!ret || ret.base === 0}
            sub={
              !ret
                ? "Could not be loaded"
                : ret.base === 0
                  ? "Shown once properties have been managed through a period"
                  : `${ret.lost === 0 ? "No managements lost" : `${plural(ret.lost, "management")} lost`}${ret.pct === null ? ` · a rate shows from 10 properties` : ""}`
            }
          >
            {ret && ret.reasons.length ? <span className={s.kpiSub}>{ret.reasons.map((r) => `${r.label} ${r.count}`).join(" · ")}</span> : null}
          </Kpi>
        </div>
      ) : null}
      <div role="listitem" style={{ display: "contents" }}>
        <Kpi label="Financial health" href="#finance" value="Not connected" muted sub="Revenue, costs, profit and cash appear once accounting is connected. Nothing is estimated.">
          <Tag kind="awaiting">Needs accounting</Tag>
        </Kpi>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Row 2: portfolio intelligence
// ════════════════════════════════════════════════════════════

export function Portfolio({ v }: { v: CeoView }) {
  if (!v.can("portfolio.read")) return null;
  const { o, b, managed, goal, fees } = derive(v);
  const e = o?.economics ?? null;
  return (
    <Section id="ceo-portfolio" eyebrow="Portfolio" title="Portfolio growth" aside={<Link href={PROPERTIES} className={s.panelLink}>All properties <Icon name="chevron-right" size={13} /></Link>}>
      <div className={s.grid}>
        <Panel span="span7" className={s.wideTablet} title="Managed properties over time" hint="Thirteen months to today. A management counts from the month it began until the month it ended.">
          {o?.series ? <GrowthChart series={o.series} /> : <Failed what="The portfolio history" />}
        </Panel>
        <div className={cx(s.span5, s.wideTablet)} style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <Panel title="Goal" hint="The target directors set in Settings." link={v.can("settings.admin") ? { href: `${HQ_ROUTES.settings}#goal`, label: "Edit" } : null}>
            {goal && b ? (
              <div className={s.goal}>
                <GoalRing value={goal.managed} target={goal.target} />
                <div style={{ display: "grid", gap: 8 }}>
                  <p className={s.rowTitle}>
                    {goal.reached ? "Goal reached." : `${goal.remaining} to go${goal.goalDate ? ` by ${formatDate(goal.goalDate, v.timezone)}` : ""}.`}
                  </p>
                  {goal.goalDate === null ? (
                    <p className={s.panelHint}>No goal date yet, so there is no pace. {v.can("settings.admin") ? "Set one in Settings." : "A director sets it."}</p>
                  ) : goal.datePassed ? (
                    <p className={s.panelHint}>The goal date has passed.</p>
                  ) : (
                    <p className={s.panelHint}>
                      Needs {goal.neededPerMonth} a month for {goal.monthsLeft} months
                      {b.pace ? `; signing ${b.pace.actualPerMonth} a month over the last three months` : ""}.
                    </p>
                  )}
                  <Tag kind="target">Target {goal.target}</Tag>
                </div>
              </div>
            ) : (
              <Failed what="The goal" />
            )}
          </Panel>
          <Panel title="Portfolio mix" hint="Active and onboarding properties.">
            {managed && e ? (
              <>
                <div className={s.figures}>
                  <Figure value={managed.longTerm.managed} label="Long-term residential" />
                  <Figure value={managed.shortTerm.managed} label="Short-term accommodation" />
                </div>
                {managed.managed > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <Meter value={managed.longTerm.managed} max={managed.managed} label={`${managed.longTerm.managed} of ${managed.managed} long-term`} />
                  </div>
                ) : null}
                <p className={s.panelFoot}>
                  {managed.managed === 0
                    ? "No managed properties yet."
                    : `${plural(e.handoverOpen, "property", "properties")} still in the Ailo handover · ${e.ailoLive} live in Ailo${e.offboarding ? ` · ${e.offboarding} offboarding` : ""}.`}
                </p>
              </>
            ) : (
              <Failed what="The portfolio mix" />
            )}
          </Panel>
        </div>
        <Panel span="span6" title="Long-term economics" hint="From the rent and fee on each agreement. Owner rent is not Planted's revenue; only the fee is." tag={<Tag>Contracted</Tag>}>
          {e ? (
            e.longTerm.properties === 0 ? (
              <Empty>Appears with the first long-term management: average weekly rent, average fee, contracted yearly fees and fees per property.</Empty>
            ) : (
              <div className={s.figures}>
                <Figure value={e.longTerm.averageWeeklyRentCents !== null ? formatAud(e.longTerm.averageWeeklyRentCents) : "—"} muted={e.longTerm.averageWeeklyRentCents === null} label={`Average weekly rent (${e.longTerm.withRent} of ${e.longTerm.properties} recorded)`} />
                <Figure value={e.longTerm.averageFeePercent !== null ? `${e.longTerm.averageFeePercent}%` : "—"} muted={e.longTerm.averageFeePercent === null} label={`Average management fee (${e.longTerm.withPercent} of ${e.longTerm.properties})`} />
                <Figure value={e.longTerm.withFee ? formatAud(e.longTerm.annualFeesCents) : "—"} muted={!e.longTerm.withFee} label={`Contracted fees a year (${e.longTerm.withFee} of ${e.longTerm.properties})`} />
                <Figure value={e.longTerm.withFee ? formatAud(Math.round(e.longTerm.annualFeesCents / e.longTerm.withFee)) : "—"} muted={!e.longTerm.withFee} label="Fees a year per property" />
              </div>
            )
          ) : (
            <Failed what="The long-term economics" />
          )}
        </Panel>
        <Panel span="span6" title="Short-term economics" hint="Commission on bookings. Gross booking revenue and cleaning pass-throughs are not Planted's revenue." tag={<Tag>Contracted</Tag>}>
          {e ? (
            <div style={{ display: "grid", gap: 14 }}>
              {e.shortTerm.properties === 0 ? (
                <Empty>Appears with the first short-term management.</Empty>
              ) : (
                <div className={s.figures}>
                  <Figure value={e.shortTerm.averageFeePercent !== null ? `${e.shortTerm.averageFeePercent}%` : "—"} muted={e.shortTerm.averageFeePercent === null} label={`Average commission (${e.shortTerm.withPercent} of ${e.shortTerm.properties})`} />
                  <Figure value={e.shortTerm.withFee ? formatAud(e.shortTerm.annualFeesCents) : "—"} muted={!e.shortTerm.withFee} label={`Agreed yearly fees (${e.shortTerm.withFee} of ${e.shortTerm.properties})`} />
                </div>
              )}
              <p className={s.panelHint}>
                Occupancy, average daily rate and commissionable booking revenue need a booking integration. <Tag kind="awaiting">Needs bookings</Tag>
              </p>
            </div>
          ) : (
            <Failed what="The short-term economics" />
          )}
          {fees && fees.missing > 0 ? <p className={s.panelFoot}>Record the rent and fee on each property (Properties, then the property) so these figures cover the whole portfolio.</p> : null}
        </Panel>
      </div>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════
// Row 3: the growth engine
// ════════════════════════════════════════════════════════════

export function GrowthEngine({ v, targetsForm }: { v: CeoView; targetsForm: ReactNode }) {
  if (!v.can("growth.read")) return null;
  const { o, totals, against } = derive(v);
  const pg = o?.period.growth ?? null;
  const prev = o?.previous?.growth ?? null;
  const panel = ok(v.data.growthPanel);
  const steps = o?.conversion ? conversionSteps(o.conversion) : [];
  const overall = o?.conversion ? overallConversion(o.conversion) : null;
  const maxCount = Math.max(1, ...(o?.funnel ?? []).map((f) => f.count));
  const rows = o?.weeks ? activityRows(o.weeks, o.targets) : null;

  return (
    <Section id="ceo-growth" eyebrow="Growth engine" title="Are we growing fast enough?" aside={<Link href={HQ_ROUTES.growth} className={s.panelLink}>Growth <Icon name="chevron-right" size={13} /></Link>}>
      <div className={s.grid}>
        <Panel
          span="span7"
          className={s.wideTablet}
          title="Pipeline"
          hint={`Open opportunities by stage, today. Stalled: ${o?.stallRule.daysInStage ?? 21}+ days in the stage and nothing logged for ${o?.stallRule.quietDays ?? 14} days.`}
          link={{ href: PIPELINE, label: "Pipeline" }}
          foot={
            totals ? (
              <>
                {plural(totals.stalled, "stalled opportunity", "stalled opportunities")} · {plural(totals.followUpsDue, "follow-up")} due or overdue · conversion, introduction to signed:{" "}
                {overall === null ? "shown once five leads have been through the pipeline" : pctText(overall)}
                {pg ? ` · ${plural(pg.lost, "lead")} lost ${v.period.key === "30d" ? "in the last 30 days" : "this period"}${pg.lost ? ` (${Object.entries(pg.lostReasons).map(([k, n]) => `${LOST_REASON_LABEL[k] ?? k} ${n}`).join(", ")})` : ""}` : ""}
              </>
            ) : null
          }
        >
          {o?.funnel ? (
            <div className={s.funnel}>
              {o.funnel.map((f) => {
                const step = steps.find((x) => x.from === f.stage);
                const pct = f.count / maxCount;
                return (
                  <div key={f.stage} className={s.stage}>
                    <span className={s.stageName}>{STAGE_LABEL[f.stage]}</span>
                    <span className={s.stageBar} aria-hidden="true">
                      <span className={s.stageFill} style={{ width: f.count ? `${Math.max(pct * 100, 4)}%` : 0 }} />
                      <span className={cx(s.stageCount, pct < 0.18 && s.stageCountOut)} style={pct < 0.18 ? { left: `calc(${Math.max(pct * 100, f.count ? 4 : 0)}% + 8px)` } : undefined}>
                        {f.count}
                      </span>
                    </span>
                    <span className={s.stageMeta}>
                      {f.withEstimate ? `${formatAud(f.valueCents)} est.` : "No estimate"}
                      {f.averageDays !== null ? ` · ${f.averageDays} days` : ""}
                      {f.stalled ? ` · ${f.stalled} stalled` : ""}
                    </span>
                    <span className="sr-only">
                      {STAGE_LABEL[f.stage]}: {f.count} open{f.withEstimate ? `, ${formatAud(f.valueCents)} estimated a year` : ""}
                      {f.averageDays !== null ? `, ${f.averageDays} days in the stage on average` : ""}.
                    </span>
                    {step && step.rate !== null ? (
                      <span className={s.stageConv}>
                        {pctText(step.rate)} went on to {STAGE_LABEL[step.to].toLowerCase()} ({step.reached} of {step.base}, all time)
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <Failed what="The pipeline" />
          )}
        </Panel>

        <Panel span="span5" className={s.wideTablet} title="Referral partners" hint="The Connect, Cultivate, Champion pathway, and what partners brought in this period." link={{ href: HQ_ROUTES.referralPartners, label: "Partners" }}>
          {panel ? (
            <div className={s.pathway} aria-label="Referral partners by step">
              {RELATIONSHIP_STAGES.map((st) => (
                <div key={st} className={cx(s.step, st === "champion" && s.stepChampion)} title={STAGE_HINT[st]}>
                  <div className={s.stepValue}>{panel.stages[st]}</div>
                  <div className={s.stepLabel}>{PATH_LABEL[st]}</div>
                </div>
              ))}
            </div>
          ) : v.data.growthPanel ? (
            <Failed what="The partner pathway" />
          ) : null}
          {pg ? (
            <div className={s.figures} style={{ marginTop: 16 }}>
              <Figure value={pg.partnerConversations} label={<>Partner conversations{prev ? <><br /><Delta change={change(pg.partnerConversations, prev.partnerConversations)} text={changeText(change(pg.partnerConversations, prev.partnerConversations), "before")} /></> : null}</>} />
              <Figure value={pg.partnersIntroducing} label="Partners who introduced someone" />
              <Figure value={pg.qualifiedReferrals} label="Referrals that reached Qualified" />
              <Figure value={pg.signedFromPartners} label="Signed managements credited to a partner" />
            </div>
          ) : null}
          {o?.partners ? (
            <>
              {o.partners.topSources.length ? (
                <div style={{ marginTop: 16 }}>
                  <p className={s.panelTitle} style={{ fontSize: 13 }}>Top sources this period</p>
                  <ul className={s.list}>
                    {o.partners.topSources.map((t) => (
                      <li key={t.id}>
                        <Link className={s.row} href={t.kind === "organisation" ? CEO_HREF.organisation(t.id) : CEO_HREF.contact(t.id)}>
                          <span className={s.rowTitle}>{t.name}</span>
                          <span className={s.rowValue}>
                            {t.received} in{t.signed ? ` · ${t.signed} signed` : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className={s.panelFoot}>
                {o.partners.needingAttention === 0 ? (
                  "No met or active partner has gone quiet for 30 days."
                ) : (
                  <>
                    {plural(o.partners.needingAttention, "relationship")} to tend (met or active, quiet 30 days or a follow-up overdue):{" "}
                    {o.partners.attention.map((a, i) => (
                      <span key={a.id}>
                        {i ? ", " : ""}
                        <Link href={CEO_HREF.contact(a.id)}>{a.name}</Link>
                      </span>
                    ))}
                    {o.partners.needingAttention > o.partners.attention.length ? " and more" : ""}.
                  </>
                )}
                {panel ? ` ${panel.partners} partners in all; ${panel.partnersNever} never contacted.` : ""}
              </p>
            </>
          ) : null}
        </Panel>

        <Panel
          span="span12"
          className={s.wideTablet}
          title="Weekly activity"
          hint="The last eight weeks, Monday to Sunday; this week so far is the open point. Compared with the targets a director set, as trends, not scores."
          tag={o?.targets ? null : <Tag kind="awaiting">No targets set</Tag>}
        >
          {rows ? (
            <div className={s.activity} style={{ display: "grid", gap: "0 32px", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
              {rows.map((r) => (
                <div key={r.key} className={s.act} style={{ borderTop: "1px solid var(--planted-border)" }}>
                  <div>
                    <div className={s.actName}>{r.label}</div>
                    <div className={s.actSub}>
                      {r.fourWeekAverage === null ? r.hint : `4-week average ${r.fourWeekAverage}`}
                      {r.target !== null ? ` · target ${r.target}${r.lastWeekMet === null ? "" : r.lastWeekMet ? ", met last week" : ", not met last week"}` : ""}
                      {r.trend ? ` · ${r.trend === "up" ? "rising" : r.trend === "down" ? "falling" : "steady"}` : ""}
                    </div>
                  </div>
                  <Sparkline values={r.series} target={r.target} label={`${r.label}, last eight weeks: ${r.series.join(", ")}`} />
                  <div className={s.actNow}>
                    {r.thisWeek}
                    <small>this week</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Failed what="Weekly activity" />
          )}
          {v.can("settings.admin") ? (
            <details className={s.how} id="targets" style={{ marginTop: 18 }}>
              <summary>{o?.targets ? "Change the weekly targets" : "Set weekly targets"}</summary>
              <div style={{ marginTop: 14, maxWidth: 680 }}>{targetsForm}</div>
            </details>
          ) : null}
        </Panel>
      </div>
      {pg ? (
        <p className={s.panelFoot} style={{ paddingTop: 12 }}>
          {v.period.title}: {plural(pg.newOpportunities, "new opportunity", "new opportunities")}, {pg.qualified} qualified, {plural(pg.referralsReceived, "referral")} received. Compared with {against}.
        </p>
      ) : null}
    </Section>
  );
}

// ════════════════════════════════════════════════════════════
// Row 4: priorities, strategy, risks
// ════════════════════════════════════════════════════════════

export type Risk = { key: string; text: string; href: string; tone: "warn" | "plain" };

export function risksOf(v: CeoView): Risk[] {
  const { o, b, goal, totals } = derive(v);
  const out: Risk[] = [];
  const launch = ok(v.data.launch);
  if (launch) {
    const late = launch.milestones.filter((m) => m.launchGate && milestoneState(m, v.today) === "overdue");
    if (late.length) out.push({ key: "gates", text: `${plural(late.length, "launch requirement")} past due: ${late.map((m) => m.name).join(", ")}`, href: CEO_HREF.project(launch.project.id), tone: "warn" });
  }
  for (const p of ok(v.data.projects) ?? []) {
    if (p.health === "at_risk" || p.health === "off_track") out.push({ key: `p-${p.id}`, text: `${p.name} is ${HEALTH_LABEL[p.health as ProjectHealth]?.toLowerCase() ?? p.health}${p.healthReasons[0] ? `: ${p.healthReasons[0]}` : ""}`, href: CEO_HREF.project(p.id), tone: "warn" });
  }
  if (totals?.stalled) out.push({ key: "stalled", text: `${plural(totals.stalled, "opportunity", "opportunities")} stalled in the pipeline`, href: PIPELINE, tone: "warn" });
  if (goal && b?.pace && goal.neededPerMonth !== null && b.pace.actualPerMonth < goal.neededPerMonth) {
    out.push({ key: "pace", text: `Signing ${b.pace.actualPerMonth} a month against ${goal.neededPerMonth} needed for the goal`, href: PIPELINE, tone: "warn" });
  }
  if (v.data.newEnquiries) out.push({ key: "enq", text: `${plural(v.data.newEnquiries, "website enquiry", "website enquiries")} waiting more than a day`, href: HQ_ROUTES.communications, tone: "warn" });
  if (o?.economics?.offboarding) out.push({ key: "off", text: `${plural(o.economics.offboarding, "property", "properties")} offboarding`, href: `${PROPERTIES}?status=offboarding`, tone: "warn" });
  if (o?.partners?.needingAttention) out.push({ key: "partners", text: `${plural(o.partners.needingAttention, "partner relationship")} going quiet`, href: HQ_ROUTES.referralPartners, tone: "plain" });
  return out;
}

export function Leadership({ v }: { v: CeoView }) {
  const pri = v.data.priorities;
  const launch = ok(v.data.launch);
  const projects = ok(v.data.projects);
  const decisions = ok(v.data.decisions);
  const risks = risksOf(v);
  const others = (projects ?? []).filter((p) => p.id !== launch?.project.id).slice(0, launch ? 3 : 4);
  const planning = (ok(v.data.planning) ?? []).filter((p) => p.kind === "funding" || p.kind === "dependency");
  return (
    <Section id="ceo-lead" eyebrow="Leadership" title="What needs you">
      <div className={s.grid}>
        <Panel span="span5" className={s.wideTablet} title="Your priorities" hint="Ranked by the command center's own score: urgency, impact, deadlines and what each unblocks. Each opens its record." link={{ href: HQ_ROUTES.dashboard, label: "Today" }}>
          {pri === null ? (
            <Empty>Your role has no tasks, leads or decisions to rank.</Empty>
          ) : !pri.ok ? (
            <Failed what="Your priorities" />
          ) : pri.data.length === 0 ? (
            <Empty>
              <strong>Nothing is pressing.</strong> No overdue tasks, lead follow-ups, waiting decisions or unanswered enquiries.
            </Empty>
          ) : (
            <ol className={s.list}>
              {pri.data.map((p, i) => (
                <li key={`${p.kind}-${p.id}`}>
                  <Link href={p.href} className={s.priority}>
                    <span className={s.priorityRank}>{i + 1}</span>
                    <span>
                      <span className={s.priorityKind}>
                        {PRIORITY_KIND_LABEL[p.kind]}
                        {p.ref ? ` · ${p.ref}` : ""}
                      </span>
                      <span className={s.priorityTitle} style={{ display: "block" }}>
                        {p.title}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={15} className={s.priorityGo} />
                    <span className={s.priorityWhy}>
                      {p.weight} · {p.why}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel span="span4" title="Strategic priorities" hint="Projects and the Decisions Register." link={v.can("projects.read") ? { href: HQ_ROUTES.projects, label: "Projects" } : null}>
          {!v.can("projects.read") ? null : failed(v.data.launch) || failed(v.data.projects) ? (
            <Failed what="Projects" />
          ) : (
            <>
              {launch ? (
                <Link href={CEO_HREF.project(launch.project.id)} className={s.row} style={{ paddingTop: 0 }}>
                  <span>
                    <span className={s.priorityKind}>Business launch</span>
                    <span className={s.rowTitle} style={{ display: "block" }}>
                      {launch.project.name}
                    </span>
                  </span>
                  <span className={s.rowValue}>{launch.project.progressTotal ? pctText(launch.project.progressDone / launch.project.progressTotal) : "—"}</span>
                  <span className={s.rowMeta}>
                    <span className={s.milestones} aria-hidden="true">
                      {[...launch.milestones].map((m) => (
                        <span key={m.id} className={cx(s.milestoneSeg, m.status === "done" && s.milestoneDone, milestoneState(m, v.today) === "overdue" && s.milestoneLate)} />
                      ))}
                    </span>
                    {launch.readiness.gatesTotal
                      ? `${launch.readiness.gatesDone} of ${launch.readiness.gatesTotal} launch requirements met`
                      : `${launch.milestones.filter((m) => m.status === "done").length} of ${launch.milestones.length} milestones done`}
                    {launch.readiness.nextMilestone ? ` · next: ${launch.readiness.nextMilestone.name}${launch.readiness.nextMilestone.dueDate ? `, ${formatDate(launch.readiness.nextMilestone.dueDate, v.timezone)}` : ""}` : ""}
                    {launch.readiness.nextAction ? ` · next action: ${launch.readiness.nextAction.title}` : ""}
                  </span>
                </Link>
              ) : (
                <Empty>No business launch project found. Name a project &ldquo;Business launch&rdquo;, or choose it on Today.</Empty>
              )}
              {others.length ? (
                <ul className={s.list} style={{ borderTop: "1px solid var(--planted-border)" }}>
                  {others.map((p) => (
                    <li key={p.id}>
                      <Link href={CEO_HREF.project(p.id)} className={s.row}>
                        <span className={s.rowTitle}>{p.name}</span>
                        <span className={s.rowValue}>{p.progressTotal ? pctText(p.progressDone / p.progressTotal) : "—"}</span>
                        <span className={s.rowMeta}>
                          {HEALTH_LABEL[p.health as ProjectHealth] ?? p.health}
                          {p.ownerName ? ` · ${p.ownerName}` : ""}
                          {p.targetDate ? ` · target ${formatDate(p.targetDate, v.timezone)}` : ""}
                          {p.blocked ? ` · ${p.blocked} blocked` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
          {decisions ? (
            <p className={s.panelFoot}>
              <Link href={HQ_ROUTES.decisions}>Decisions Register</Link>: {plural(decisions.proposed, "proposed decision")} open, {decisions.decidedInPeriod} decided {v.period.complete ? "in the period" : "so far this period"}.
            </p>
          ) : null}
        </Panel>

        <Panel span="span3" className={s.wideTablet} title="Risks" hint="Read from the records, not guessed.">
          {risks.length === 0 ? (
            <Empty>No risks flagged by the records today.</Empty>
          ) : (
            <ul className={s.list}>
              {risks.map((r) => (
                <li key={r.key}>
                  <Link href={r.href} className={s.row}>
                    <span className={s.rowTitle} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span aria-hidden="true" style={{ flexShrink: 0, width: 7, height: 7, borderRadius: "50%", background: r.tone === "warn" ? "var(--status-warning-dot)" : "var(--status-neutral-dot)", transform: "translateY(-1px)" }} />
                      {r.text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {planning.length ? (
            <p className={s.panelFoot}>
              {planning.map((p) => (
                <span key={p.id} style={{ display: "block" }}>
                  {p.title}: {planningStatusLabel(p.kind, p.status).toLowerCase()}
                  {p.amountAnticipated !== null ? `, ${planningAmount(p.amountAnticipated)}` : ""} (a planning figure, not money held).
                </span>
              ))}
            </p>
          ) : null}
        </Panel>
      </div>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════
// Row 5: the Planted Standard, and money
// ════════════════════════════════════════════════════════════

export function StandardAndFinance({ v }: { v: CeoView }) {
  const { o, fees, against } = derive(v);
  const pg = o?.period.growth ?? null;
  const prev = o?.previous?.growth ?? null;
  const e = o?.economics ?? null;
  const needsAilo = ["Owner response times", "Maintenance outstanding and urgent", "Overdue inspections", "Tenant and guest concerns", "Complaints and resolution times", "Landlord satisfaction and reviews"];
  return (
    <Section id="ceo-standard" eyebrow="Service and money" title="The Planted Standard, and financial health">
      <div className={s.grid}>
        <Panel span="span6" className={s.wideTablet} title="The Planted Standard" hint="Service measures HQ holds today, and the ones that need Ailo. No combined score: too little is measured yet to justify one.">
          <div className={s.service}>
            {v.can("growth.read") ? (
              <div className={s.serviceRow}>
                <div>
                  <div className={s.rowTitle}>Website enquiry response</div>
                  <div className={s.rowMeta}>
                    Median time from an enquiry to someone picking it up in HQ. {pg ? `${pg.enquiriesHandled} of ${pg.enquiriesReceived} picked up` : ""}
                    {pg && prev && pg.enquiryMedianHours !== null && prev.enquiryMedianHours !== null ? ` · ${hoursText(prev.enquiryMedianHours)} in ${against}` : ""}
                  </div>
                </div>
                <div className={s.serviceValue}>{pg ? (hoursText(pg.enquiryMedianHours) ?? <span className={s.panelHint}>No enquiries</span>) : "—"}</div>
              </div>
            ) : null}
            {v.can("portfolio.read") && e ? (
              <div className={s.serviceRow}>
                <div>
                  <div className={s.rowTitle}>Onboarding into Ailo</div>
                  <div className={s.rowMeta}>Managed properties whose nine-step handover is still open.</div>
                </div>
                <div className={s.serviceValue}>{e.handoverOpen}</div>
              </div>
            ) : null}
            {needsAilo.map((n) => (
              <div key={n} className={s.serviceRow}>
                <div className={s.rowTitle} style={{ color: "var(--planted-grey-text)" }}>
                  {n}
                </div>
                <Tag kind="awaiting">Needs Ailo</Tag>
              </div>
            ))}
          </div>
          <p className={s.panelFoot}>Ailo holds rent, trust, tenancies, maintenance and inspections. HQ shows none of it until an Ailo connection exists, so a growing property count can never hide a falling service measure.</p>
        </Panel>

        <Panel span="span6" className={s.wideTablet} title="Financial performance" hint="Revenue, costs, profit, cash and break-even." labelledBy="finance">
          <Setup
            title="Connect accounting to see the money"
            needs={["Recognised revenue by stream (long-term, short-term, leasing, other)", "Costs: staff and contractors, software, marketing, insurance, operating", "Operating profit and margin, cash, and the break-even property count"]}
          >
            HQ has no accounting data, so it shows no revenue, profit or cash figure. Owner funds, bonds, trust balances and cleaning pass-throughs will never be counted as Planted&rsquo;s money, and GST is not revenue.
          </Setup>
          <div className={s.figures} style={{ marginTop: 16 }}>
            <Figure value={fees?.annualCents !== null && fees?.annualCents !== undefined ? formatAud(fees.annualCents) : "—"} muted={!fees?.annualCents} label="Contracted fees a year (agreements, not income)" />
            <Figure value={fees?.perPropertyCents ? formatAud(fees.perPropertyCents) : "—"} muted={!fees?.perPropertyCents} label="Contracted fees per property" />
          </div>
          <p className={s.panelFoot}>Forecasts and scenarios will be labelled apart from actuals once actuals exist.</p>
        </Panel>
      </div>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════
// What is live and what is waiting on an integration
// ════════════════════════════════════════════════════════════

export function Awaiting() {
  const items: Array<{ title: string; text: string }> = [
    { title: "Accounting", text: "Revenue, expenses, operating profit, cash, margin, cost per property and break-even." },
    { title: "Ailo operations", text: "Rent and arrears, maintenance, inspections, owner and tenant response times, satisfaction." },
    { title: "Short-term bookings", text: "Commissionable booking revenue, occupancy, average daily rate, service costs and contribution margin." },
    { title: "Offices and teams", text: "Copper Coast, Adelaide and later regions compared side by side, once HQ records which office manages each property." },
  ];
  return (
    <Section id="ceo-awaiting" eyebrow="Coverage" title="Waiting on an integration">
      <div className={s.awaiting}>
        {items.map((i) => (
          <div key={i.title} className={s.awaitItem}>
            <p className={s.awaitTitle}>
              <Icon name="link" size={14} /> {i.title}
            </p>
            <p className={s.awaitText}>{i.text}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function HowCounted({ v }: { v: CeoView }) {
  return (
    <details className={s.how}>
      <summary>How these figures are worked out</summary>
      <dl>
        <dt>Period</dt>
        <dd>
          {v.period.title}, {formatDate(v.period.from, v.timezone)} to {formatDate(v.period.to, v.timezone)}.{" "}
          {v.period.previous ? `Compared with ${v.period.previous.title} (${formatDate(v.period.previous.from, v.timezone)} to ${formatDate(v.period.previous.to, v.timezone)}), so a period still running is never set against a whole one.` : ""}
        </dd>
        <dt>Managed properties</dt>
        <dd>Active and onboarding property records (the same count as Reports). A management counts in the history from its start date (managed from, else the agreement date) until its end date.</dd>
        <dt>Contracted annual fees</dt>
        <dd>Weekly rent on the agreement × 52 × the fee percentage, or the agreed yearly fee for flat fees and short-term accommodation, excluding GST. What agreements say, never income received or profit. Properties without their terms recorded are left out and counted.</dd>
        <dt>Pipeline value</dt>
        <dd>The yearly values people estimated on open opportunities. An estimate, shown apart from contracted fees.</dd>
        <dt>Signed and the pace</dt>
        <dd>Managements marked signed in the period. The pace is the goal&rsquo;s remaining properties over the months to the goal date, scaled to the period; without a goal date there is none.</dd>
        <dt>Retention</dt>
        <dd>Of the properties managed at the start of the period, those that did not end in it. A percentage from 10 properties.</dd>
        <dt>Conversion</dt>
        <dd>From stage history: of the leads that ever reached a stage, how many went on to the next. A rate from five leads.</dd>
        <dt>Activity</dt>
        <dd>Relationship actions: calls, meetings, emails and messages with referral partners. Discovery conversations: calls and meetings logged on a lead. Qualified, appraisals, proposals and signings: leads reaching that stage for the first time.</dd>
        <dt>Priorities</dt>
        <dd>The command center&rsquo;s focus score (overdue, due soon, priority, launch requirements, what it unblocks), with lead follow-ups, decisions and waiting enquiries scored as tasks would be.</dd>
      </dl>
    </details>
  );
}

