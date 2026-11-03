import test from "node:test";
import assert from "node:assert/strict";
import { weeklyReport, type ReportInput } from "./report.ts";
import { feeSummary, goalProgress, parseCeoOverview } from "./rules.ts";

const overview = parseCeoOverview({
  as_of: "2026-11-03",
  period: {
    from: "2026-10-28", to: "2026-11-03",
    portfolio: { started: 1, ended: 0, managed_at_start: 0, managed_at_end: 1, fees_at_end_cents: 300000, fees_at_end_with_terms: 1 },
    growth: { new_opportunities: 3, qualified: 1, signed: 1, signed_from_partners: 1, entered: { proposal_sent: 1 }, referrals_received: 2, partners_introducing: 1, enquiries_received: 2, enquiries_handled: 1, enquiry_median_hours: 3 },
  },
  previous: { from: "2026-10-21", to: "2026-10-27", portfolio: { fees_at_end_cents: 0, fees_at_end_with_terms: 0 }, growth: { new_opportunities: 1 } },
  targets: null,
})!;

const base: ReportInput = {
  overview,
  managed: { managed: 1, onboarding: 1 },
  goal: goalProgress(1, 20, null, "2026-11-03"),
  totals: { open: 4, valueCents: 900000, withEstimate: 2, stalled: 0, followUpsDue: 1, qualifiedOrLater: 2, proposals: 1 },
  fees: feeSummary({
    longTerm: { properties: 2, withRent: 1, averageWeeklyRentCents: 60000, withPercent: 2, averageFeePercent: 8, withFee: 1, annualFeesCents: 300000 },
    shortTerm: { properties: 0, withFee: 0, withPercent: 0, averageFeePercent: null, annualFeesCents: 0 },
    handoverOpen: 1, ailoLive: 0, offboarding: 0,
  }),
  economics: null,
  priorities: [{ title: "Call back J. Citizen", why: "Overdue by 2 days" }],
  risks: ["1 opportunity stalled"],
  planning: [{ title: "Business funding", status: "anticipated, not confirmed", amount: "about $25,000" }],
  money: (c) => `$${(c / 100).toLocaleString("en-AU")}`,
  hours: (h) => (h === null ? null : `${h} hours`),
  date: (d) => d,
};

test("every line is labelled; estimates and planning figures are never facts", () => {
  const r = weeklyReport(base);
  const lines = r.flatMap((s) => s.lines);
  assert.ok(lines.every((l) => ["fact", "estimate", "assumption", "recommendation"].includes(l.kind)));
  const pipeline = lines.find((l) => l.text.startsWith("Open pipeline"))!;
  assert.equal(pipeline.kind, "estimate");
  assert.match(pipeline.text, /Not income/);
  const funding = lines.find((l) => l.text.startsWith("Business funding"))!;
  assert.equal(funding.kind, "assumption");
  assert.match(funding.text, /not money held/);
  assert.ok(lines.some((l) => /accounting is not connected/.test(l.text)), "no profit figure is invented");
});

test("contracted fees are facts with their change; gaps become recommendations", () => {
  const r = weeklyReport(base);
  const money = r.find((s) => s.key === "money")!;
  assert.match(money.lines[0].text, /^Contracted fees: \$3,000 a year across 1 property\. Agreements, not income received\.$/, "no change from a week with no terms recorded");
  const recs = r.find((s) => s.key === "decisions")!.lines.map((l) => l.text);
  assert.equal(recs[0], "Call back J. Citizen (Overdue by 2 days).");
  assert.ok(recs.some((t) => /Set a date/.test(t)));
  assert.ok(recs.some((t) => /weekly activity targets/.test(t)));
  assert.ok(recs.some((t) => /rent and fee on 1 property/.test(t)));
});

test("an empty week says so instead of padding", () => {
  const r = weeklyReport({ ...base, overview: null, managed: null, goal: null, totals: null, fees: null, priorities: [], risks: [], planning: [] });
  assert.equal(r.find((s) => s.key === "grew")!.lines[0].text, "Nothing your role can see grew or shrank this week.");
  assert.equal(r.find((s) => s.key === "risks")!.lines[0].text, "No risks flagged by the records.");
  assert.equal(r.find((s) => s.key === "decisions")!.lines[0].text, "Nothing needs a decision from the records this week.");
});
