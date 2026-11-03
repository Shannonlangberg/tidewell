import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CONVERSION_BASE,
  MIN_RETENTION_BASE,
  activityRows,
  annualFeeFromRent,
  briefing,
  change,
  changeText,
  conversionSteps,
  dollarsToCents,
  feeSummary,
  funnelTotals,
  goalProgress,
  growthSeries,
  hoursText,
  overallConversion,
  parseCeoOverview,
  parseTargets,
  pctText,
  retention,
  seriesIsEmpty,
  signingTarget,
  type Economics,
  type MonthPoint,
  type WeekPoint,
  type WindowGrowth,
  type WindowPortfolio,
} from "./rules.ts";

const growth = (over: Partial<WindowGrowth> = {}): WindowGrowth => ({
  newOpportunities: 0, newBySource: {}, qualified: 0, entered: {}, signed: 0, signedEstimatedValueCents: 0, signedFromPartners: 0,
  lost: 0, lostReasons: {}, referralsReceived: 0, referralsSent: 0, partnersIntroducing: 0, qualifiedReferrals: 0,
  relationshipActions: 0, partnerConversations: 0, discoveryConversations: 0, enquiriesReceived: 0, enquiriesHandled: 0, enquiryMedianHours: null, ...over,
});
const portfolio = (over: Partial<WindowPortfolio> = {}): WindowPortfolio => ({
  started: 0, startedLongTerm: 0, startedShortTerm: 0, ended: 0, endedReasons: {}, managedAtStart: 0, managedAtEnd: 0, feesAtEndCents: 0, feesAtEndWithTerms: 0, ...over,
});

test("parseCeoOverview: refuses the wrong shape, reads the right one, keeps nulls as nulls", () => {
  assert.equal(parseCeoOverview(null), null);
  assert.equal(parseCeoOverview({ as_of: "2026-11-03" }), null);
  const o = parseCeoOverview({
    as_of: "2026-11-03",
    generated_at: "2026-11-03T01:00:00Z",
    latest_change_at: null,
    period: { from: "2026-11-01", to: "2026-11-03", portfolio: null, growth: { signed: 2, entered: { proposal_sent: "3" }, enquiry_median_hours: null } },
    previous: null,
    series: [{ month: "2026-11-01", complete: false, long_term: { managed: 1 }, short_term: {} }],
    funnel: [{ stage: "qualified", count: 2, value_cents: 500000, average_days: "4.5" }, { stage: "lost", count: 9 }],
    conversion: [{ stage: "introduction_received", reached: 6 }],
    partners: null,
    weeks: null,
    targets: { signings: 1, bogus: 5, qualified: -1 },
    notes: ["x", 4],
  })!;
  assert.equal(o.period.growth?.signed, 2);
  assert.equal(o.period.growth?.entered.proposal_sent, 3);
  assert.equal(o.period.growth?.enquiryMedianHours, null);
  assert.equal(o.period.portfolio, null);
  assert.equal(o.series?.[0].longTerm.managed, 1);
  assert.equal(o.funnel?.length, 1, "lost is not an open stage");
  assert.equal(o.funnel?.[0].averageDays, 4.5);
  assert.deepEqual(o.targets, { signings: 1 });
  assert.deepEqual(o.notes, ["x"]);
  assert.equal(o.economics, null);
});

test("parseTargets: whole numbers 0..1000 only; nothing set is null", () => {
  assert.equal(parseTargets(null), null);
  assert.equal(parseTargets({}), null);
  assert.deepEqual(parseTargets({ appraisals: 0, proposals: 2.5, signings: 1001 }), { appraisals: 0 });
});

test("change: no percentage from zero, nothing without a comparison", () => {
  assert.equal(change(3, null), null);
  assert.deepEqual(change(3, 0), { delta: 3, pct: null, direction: "up" });
  assert.deepEqual(change(3, 4), { delta: -1, pct: -0.25, direction: "down" });
  assert.equal(changeText(change(5, 4), "October"), "+1 (+25%) on October");
  assert.equal(changeText(change(2, 0), "October"), "+2 on October");
  assert.equal(changeText(change(2, 2), "October"), "No change on October");
});

test("growthSeries: mixes add up, net growth and a rate only from a non-zero base", () => {
  const series: MonthPoint[] = [
    { month: "2026-09-01", complete: true, longTerm: { managed: 0, started: 0, ended: 0 }, shortTerm: { managed: 0, started: 0, ended: 0 } },
    { month: "2026-10-01", complete: true, longTerm: { managed: 4, started: 4, ended: 0 }, shortTerm: { managed: 1, started: 1, ended: 0 } },
    { month: "2026-11-01", complete: false, longTerm: { managed: 5, started: 2, ended: 1 }, shortTerm: { managed: 1, started: 0, ended: 0 } },
  ];
  const all = growthSeries(series, "all");
  assert.deepEqual(all.map((p) => p.managed), [0, 5, 6]);
  assert.equal(all[1].growthRate, null, "growth from nothing has no rate");
  assert.equal(all[2].net, 1);
  assert.equal(all[2].growthRate, 1 / 5);
  assert.deepEqual(growthSeries(series, "short_term").map((p) => p.managed), [0, 1, 1]);
  assert.equal(seriesIsEmpty(all), false);
  assert.equal(seriesIsEmpty(growthSeries(series.slice(0, 1), "all")), true);
});

test("retention: no percentage below the minimum base; reasons as recorded", () => {
  const small = retention(portfolio({ managedAtStart: MIN_RETENTION_BASE - 1, ended: 1, endedReasons: { owner_sold: 1 } }));
  assert.equal(small.pct, null);
  assert.equal(small.retained, MIN_RETENTION_BASE - 2);
  const big = retention(portfolio({ managedAtStart: 20, ended: 2, endedReasons: { not_recorded: 1, fees: 1 } }));
  assert.equal(big.pct, 0.9);
  assert.deepEqual(big.reasons.map((r) => r.label), ["Fees", "Reason not recorded"]);
  assert.equal(retention(portfolio({ managedAtStart: 0, ended: 3 })).retained, 0, "never negative");
});

test("goalProgress: needed per month only with a date; reached and passed", () => {
  const noDate = goalProgress(0, 20, null, "2026-11-03");
  assert.deepEqual([noDate.pct, noDate.remaining, noDate.neededPerMonth, noDate.monthsLeft], [0, 20, null, null]);
  const g = goalProgress(5, 20, "2027-12-31", "2026-11-03");
  assert.equal(g.pct, 0.25);
  assert.equal(g.monthsLeft, 13.9);
  assert.equal(g.neededPerMonth, 1.1);
  assert.equal(goalProgress(20, 20, "2027-12-31", "2026-11-03").neededPerMonth, 0);
  assert.equal(goalProgress(25, 20, null, "2026-11-03").pct, 1);
  const passed = goalProgress(3, 20, "2026-01-01", "2026-11-03");
  assert.equal(passed.datePassed, true);
  assert.equal(passed.neededPerMonth, null);
  assert.equal(signingTarget(null, 30), null);
  assert.equal(signingTarget(1.1, 30.4375), 1.1);
});

test("contracted fees: rent x 52 x percent; properties without terms are left out and counted", () => {
  assert.equal(annualFeeFromRent(65000, 8.8), 297440);
  const e: Economics = {
    longTerm: { properties: 3, withRent: 2, averageWeeklyRentCents: 60000, withPercent: 3, averageFeePercent: 8.5, withFee: 2, annualFeesCents: 500000 },
    shortTerm: { properties: 1, withFee: 0, withPercent: 0, averageFeePercent: null, annualFeesCents: 0 },
    handoverOpen: 1, ailoLive: 0, offboarding: 0,
  };
  assert.deepEqual(feeSummary(e), { annualCents: 500000, withTerms: 2, properties: 4, missing: 2, perPropertyCents: 250000 });
  const none = feeSummary({ ...e, longTerm: { ...e.longTerm, withFee: 0, annualFeesCents: 0 } });
  assert.equal(none.annualCents, null, "no terms is not $0 of revenue");
  assert.equal(none.perPropertyCents, null);
  assert.equal(dollarsToCents("$1,200.50"), 120050);
  assert.equal(dollarsToCents(""), null);
  assert.ok(Number.isNaN(dollarsToCents("12.345")));
});

test("conversion: rates from stage history only above the minimum base", () => {
  const steps = conversionSteps([
    { stage: "introduction_received", reached: 10 },
    { stage: "contacted", reached: 8 },
    { stage: "qualified", reached: 4 },
    { stage: "appraisal_requested", reached: 3 },
  ]);
  assert.equal(steps[0].rate, 0.8);
  assert.equal(steps[1].rate, 0.5);
  assert.equal(steps[2].rate, null, `fewer than ${MIN_CONVERSION_BASE} reached qualified`);
  assert.equal(steps.length, 6);
  assert.equal(overallConversion([{ stage: "introduction_received", reached: 4 }, { stage: "management_signed", reached: 1 }]), null);
  assert.equal(overallConversion([{ stage: "introduction_received", reached: 10 }, { stage: "management_signed", reached: 1 }]), 0.1);
});

test("funnelTotals: open, estimated value and qualified-or-later", () => {
  const t = funnelTotals([
    { stage: "introduction_received", count: 3, valueCents: 0, withEstimate: 0, averageDays: 2, stalled: 1, followUpsDue: 1 },
    { stage: "qualified", count: 2, valueCents: 400000, withEstimate: 2, averageDays: 5, stalled: 0, followUpsDue: 0 },
    { stage: "proposal_sent", count: 1, valueCents: 300000, withEstimate: 1, averageDays: 9, stalled: 1, followUpsDue: 1 },
  ]);
  assert.deepEqual(t, { open: 6, valueCents: 700000, withEstimate: 3, stalled: 2, followUpsDue: 2, qualifiedOrLater: 3, proposals: 1 });
});

test("activityRows: this week is not in the average; met only against a set target; a trend needs four weeks", () => {
  const w = (week: string, complete: boolean, g: Partial<WindowGrowth>): WeekPoint => ({ week, complete, figures: growth(g) });
  const weeks = [
    w("2026-10-05", true, { relationshipActions: 2 }),
    w("2026-10-12", true, { relationshipActions: 2 }),
    w("2026-10-19", true, { relationshipActions: 4, entered: { proposal_sent: 1 } }),
    w("2026-10-26", true, { relationshipActions: 6 }),
    w("2026-11-02", false, { relationshipActions: 50 }),
  ];
  const rows = activityRows(weeks, { relationship_actions: 5 });
  const ra = rows.find((r) => r.key === "relationship_actions")!;
  assert.deepEqual(ra.series, [2, 2, 4, 6, 50]);
  assert.equal(ra.thisWeek, 50);
  assert.equal(ra.fourWeekAverage, 3.5);
  assert.equal(ra.lastWeekMet, true);
  assert.equal(ra.trend, "up");
  const pr = rows.find((r) => r.key === "proposals")!;
  assert.equal(pr.target, null);
  assert.equal(pr.lastWeekMet, null);
  assert.equal(activityRows(weeks.slice(-2), null)[0].trend, null);
});

test("briefing: only clauses whose figures were loaded; nothing invented", () => {
  const fmt = (d: string) => (d === "2027-12-31" ? "December 2027" : d);
  const empty = briefing({ managed: null, onboarding: null, target: null, goalDate: null, openOpportunities: null, proposalsAwaiting: null, followUpsDue: null, priorities: null, launchOpenGates: null, decisionsForMe: null }, fmt);
  assert.deepEqual(empty, []);
  const pre = briefing({ managed: 0, onboarding: 0, target: 20, goalDate: "2027-12-31", openOpportunities: 2, proposalsAwaiting: 0, followUpsDue: 2, priorities: 3, launchOpenGates: 2, decisionsForMe: 0 }, fmt);
  assert.deepEqual(pre, [
    "Planted manages no properties yet; the goal is 20 by December 2027.",
    "You have 2 active opportunities and 2 lead follow-ups due or overdue.",
    "3 actions need your attention today and 2 launch requirements still to meet.",
  ]);
  const one = briefing({ managed: 1, onboarding: 1, target: 20, goalDate: null, openOpportunities: 1, proposalsAwaiting: 1, followUpsDue: 0, priorities: 1, launchOpenGates: 0, decisionsForMe: 1 }, fmt);
  assert.equal(one[0], "Planted manages 1 property (1 onboarding) against a goal of 20 (no goal date set yet).");
  assert.equal(one[1], "You have 1 active opportunity and 1 proposal awaiting a decision.");
  assert.equal(one[2], "1 action needs your attention today and 1 decision waits on you.");
});

test("formatting: percentages and response times", () => {
  assert.equal(pctText(null), "—");
  assert.equal(pctText(0.256), "26%");
  assert.equal(pctText(0.256, 1), "25.6%");
  assert.equal(hoursText(null), null);
  assert.equal(hoursText(0.2), "12 minutes");
  assert.equal(hoursText(3.25), "3.3 hours");
  assert.equal(hoursText(72), "3 days");
});
