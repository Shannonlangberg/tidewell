/*
 * "This week at Planted": the weekly executive report, built on demand from the same reads as the CEO
 * Command Centre (hq.ceo_overview for the last seven days against the seven before, business_summary, the
 * priorities and the risks). Pure: it turns those figures into labelled lines, so the page renders it today
 * and a scheduled email can render the same lines later without a second set of rules.
 *
 * Every line says what it is:
 *   fact            counted from records in HQ
 *   estimate        people's own estimates (pipeline value), never income
 *   assumption      a planning figure or a rule the figure depends on
 *   recommendation  what HQ suggests the CEO decides or does, with the reason
 * A heading with nothing to say says so in one fact; nothing is filled in to look busy.
 *
 * NO value imports (the unit tests run under Node's type stripping).
 */

import type { CeoOverview, Economics, FeeSummary, FunnelTotals, GoalProgress } from "./rules";

export type LineKind = "fact" | "estimate" | "assumption" | "recommendation";
export const LINE_KIND_LABEL: Record<LineKind, string> = { fact: "Fact", estimate: "Estimate", assumption: "Assumption", recommendation: "Recommended" };
export type ReportLine = { kind: LineKind; text: string };
export type ReportSection = { key: string; heading: string; lines: ReportLine[] };

export type ReportInput = {
  overview: CeoOverview | null;
  managed: { managed: number; onboarding: number } | null;
  goal: GoalProgress | null;
  totals: FunnelTotals | null;
  fees: FeeSummary | null;
  economics: Economics | null;
  priorities: ReadonlyArray<{ title: string; why: string }>;
  risks: readonly string[];
  planning: ReadonlyArray<{ title: string; status: string; amount: string | null }>;
  money: (cents: number) => string;
  hours: (h: number | null) => string | null;
  date: (d: string) => string;
};

const p = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "no change");

export function weeklyReport(r: ReportInput): ReportSection[] {
  const g = r.overview?.period.growth ?? null;
  const pg = r.overview?.previous?.growth ?? null;
  const pp = r.overview?.period.portfolio ?? null;
  const prevP = r.overview?.previous?.portfolio ?? null;
  const out: ReportSection[] = [];

  // What grew
  const grew: ReportLine[] = [];
  if (r.managed && pp) {
    grew.push({ kind: "fact", text: `Managed properties: ${r.managed.managed}${r.managed.onboarding ? ` (${r.managed.onboarding} onboarding)` : ""}; ${p(pp.started, "new management")} and ${p(pp.ended, "lost management")} this week.` });
  }
  if (r.goal) grew.push({ kind: "fact", text: `${r.goal.managed} of the goal of ${r.goal.target}${r.goal.goalDate ? ` by ${r.date(r.goal.goalDate)}` : ""}.` });
  if (g) {
    grew.push({ kind: "fact", text: `${p(g.newOpportunities, "new opportunity", "new opportunities")} (${pg ? signed(g.newOpportunities - pg.newOpportunities) : "no comparison"} on the week before), ${g.qualified} qualified, ${p(g.signed, "management")} signed.` });
  }
  out.push({ key: "grew", heading: "What grew", lines: grew.length ? grew : [{ kind: "fact", text: "Nothing your role can see grew or shrank this week." }] });

  // What changed
  const changed: ReportLine[] = [];
  if (g) {
    const entered = Object.entries(g.entered).filter(([, n]) => n > 0);
    if (entered.length) changed.push({ kind: "fact", text: `Leads moving forward: ${entered.map(([s, n]) => `${n} to ${s.replace(/_/g, " ")}`).join(", ")}.` });
    changed.push({ kind: "fact", text: `${p(g.referralsReceived, "referral")} received from ${p(g.partnersIntroducing, "partner")}; ${p(g.partnerConversations, "conversation")} with partners and ${p(g.discoveryConversations, "discovery conversation")} on leads.` });
    if (g.lost) changed.push({ kind: "fact", text: `${p(g.lost, "lead")} lost.` });
  }
  out.push({ key: "changed", heading: "What changed", lines: changed.length ? changed : [{ kind: "fact", text: "No changes recorded." }] });

  // Wins
  const wins: ReportLine[] = [];
  if (g && g.signed) wins.push({ kind: "fact", text: `${p(g.signed, "management")} signed${g.signedFromPartners ? `, ${g.signedFromPartners} credited to a referral partner` : ""}.` });
  if (g && g.qualifiedReferrals) wins.push({ kind: "fact", text: `${p(g.qualifiedReferrals, "referral")} reached Qualified.` });
  if (pp && pp.started) wins.push({ kind: "fact", text: `${p(pp.started, "property", "properties")} came under management.` });
  out.push({ key: "wins", heading: "Wins", lines: wins.length ? wins : [{ kind: "fact", text: "No signings or new managements this week." }] });

  // New risks
  out.push({ key: "risks", heading: "Risks", lines: r.risks.length ? r.risks.map((t) => ({ kind: "fact" as const, text: t })) : [{ kind: "fact", text: "No risks flagged by the records." }] });

  // Financial movement
  const money: ReportLine[] = [];
  if (r.fees) {
    if (r.fees.annualCents !== null) {
      const ch = pp && prevP && prevP.feesAtEndWithTerms > 0 ? pp.feesAtEndCents - prevP.feesAtEndCents : null;
      money.push({ kind: "fact", text: `Contracted fees: ${r.money(r.fees.annualCents)} a year across ${p(r.fees.withTerms, "property", "properties")}${ch !== null && ch !== 0 ? ` (${ch > 0 ? "+" : "−"}${r.money(Math.abs(ch))} on the week before)` : ""}. Agreements, not income received.` });
    } else if (r.fees.properties > 0) money.push({ kind: "fact", text: `No property has its rent and fee recorded, so there is no contracted-fee figure.` });
  }
  if (r.totals && r.totals.withEstimate > 0) money.push({ kind: "estimate", text: `Open pipeline: ${r.money(r.totals.valueCents)} a year as estimated on ${p(r.totals.withEstimate, "opportunity", "opportunities")}. Not income.` });
  for (const pl of r.planning) money.push({ kind: "assumption", text: `${pl.title}: ${pl.status}${pl.amount ? `, ${pl.amount}` : ""}. A planning figure, not money held.` });
  money.push({ kind: "fact", text: "Revenue, costs, profit and cash are not shown: accounting is not connected." });
  out.push({ key: "money", heading: "Financial movement", lines: money });

  // Service
  const service: ReportLine[] = [];
  if (g) {
    const h = r.hours(g.enquiryMedianHours);
    service.push({ kind: "fact", text: g.enquiriesReceived ? `${g.enquiriesHandled} of ${g.enquiriesReceived} website enquiries picked up${h ? `, in a median of ${h}` : ""}.` : "No website enquiries this week." });
  }
  if (r.economics && r.economics.handoverOpen) service.push({ kind: "fact", text: `${p(r.economics.handoverOpen, "property", "properties")} still in the Ailo handover.` });
  service.push({ kind: "assumption", text: "Maintenance, inspections, arrears and satisfaction are in Ailo and not yet connected to HQ." });
  out.push({ key: "service", heading: "Service", lines: service });

  // Upcoming opportunities
  const upcoming: ReportLine[] = [];
  if (r.totals) {
    upcoming.push({ kind: "fact", text: `${p(r.totals.open, "open opportunity", "open opportunities")}, ${r.totals.qualifiedOrLater} qualified or further, ${p(r.totals.proposals, "proposal")} awaiting a decision.` });
    if (r.totals.followUpsDue) upcoming.push({ kind: "fact", text: `${p(r.totals.followUpsDue, "lead follow-up")} due or overdue.` });
  }
  out.push({ key: "upcoming", heading: "Upcoming opportunities", lines: upcoming.length ? upcoming : [{ kind: "fact", text: "No open opportunities your role can see." }] });

  // Recommended decisions
  const recs: ReportLine[] = r.priorities.slice(0, 3).map((x) => ({ kind: "recommendation" as const, text: `${x.title} (${x.why}).` }));
  if (r.goal && r.goal.goalDate === null) recs.push({ kind: "recommendation", text: "Set a date for the managed-property goal, so HQ can show the signing pace needed." });
  if (r.overview && r.overview.targets === null) recs.push({ kind: "recommendation", text: "Set weekly activity targets, so the scorecard compares activity with what you intend." });
  if (r.fees && r.fees.missing > 0) recs.push({ kind: "recommendation", text: `Record the rent and fee on ${p(r.fees.missing, "property", "properties")}, so contracted fees cover the whole portfolio.` });
  out.push({ key: "decisions", heading: "Recommended CEO decisions", lines: recs.length ? recs : [{ kind: "fact", text: "Nothing needs a decision from the records this week." }] });

  return out;
}
