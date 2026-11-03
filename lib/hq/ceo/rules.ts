/*
 * The CEO Command Centre's calculations (docs/hq-ceo-command-centre.md). The database counts records
 * (hq.ceo_overview, hq.business_summary); everything worked out FROM those counts is here, in one place, so
 * the page, the weekly report and the tests say the same thing.
 *
 * The rules every function keeps:
 *   - Only what the records support. No record, no figure: a function returns null and the page says what
 *     is missing. Zero is a real count and is shown as 0.
 *   - Actuals, estimates, targets and projections are different things and are labelled apart. Contracted
 *     fees are what agreements say; they are never income received (Ailo holds that) and never profit.
 *   - A rate needs a base: a percentage change from 0, a retention rate over a handful of properties, or a
 *     conversion rate over two leads would mislead, so they are null below the minimums here.
 *
 * Pure and with NO value imports (the unit tests run under Node's type stripping).
 */

// ════════════════════════════════════════════════════════════
// 1. The shape of hq.ceo_overview, checked
// ════════════════════════════════════════════════════════════

export const OPEN_STAGES = ["introduction_received", "contacted", "qualified", "appraisal_requested", "appraisal_completed", "proposal_sent"] as const;
export const FUNNEL_STAGES = [...OPEN_STAGES, "management_signed"] as const;
export type OpenStage = (typeof OPEN_STAGES)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const STAGE_LABEL: Record<FunnelStage, string> = {
  introduction_received: "Introduction received",
  contacted: "Contacted",
  qualified: "Qualified",
  appraisal_requested: "Appraisal requested",
  appraisal_completed: "Appraisal completed",
  proposal_sent: "Proposal sent",
  management_signed: "Management signed",
};

export const END_REASONS = ["owner_sold", "owner_self_managing", "moved_to_another_manager", "owner_moving_in", "service", "fees", "other"] as const;
export type EndReason = (typeof END_REASONS)[number];
export const END_REASON_LABEL: Record<EndReason | "not_recorded", string> = {
  owner_sold: "Owner sold",
  owner_self_managing: "Owner self-managing",
  moved_to_another_manager: "Moved to another manager",
  owner_moving_in: "Owner moving in",
  service: "Unhappy with service",
  fees: "Fees",
  other: "Other",
  not_recorded: "Reason not recorded",
};
export const isEndReason = (v: unknown): v is EndReason => typeof v === "string" && (END_REASONS as readonly string[]).includes(v);

export const LOST_REASON_LABEL: Record<string, string> = {
  price: "Price",
  chose_another_manager: "Chose another manager",
  self_managing: "Self-managing",
  not_ready: "Not ready",
  unresponsive: "Unresponsive",
  out_of_area: "Out of area",
  other: "Other",
};

export type WindowPortfolio = {
  started: number;
  startedLongTerm: number;
  startedShortTerm: number;
  ended: number;
  endedReasons: Record<string, number>;
  managedAtStart: number;
  managedAtEnd: number;
  feesAtEndCents: number;
  feesAtEndWithTerms: number;
};

export type WindowGrowth = {
  newOpportunities: number;
  newBySource: Record<string, number>;
  qualified: number;
  /** Leads that first reached each stage in the window (from stage history). */
  entered: Record<string, number>;
  signed: number;
  signedEstimatedValueCents: number;
  signedFromPartners: number;
  lost: number;
  lostReasons: Record<string, number>;
  referralsReceived: number;
  referralsSent: number;
  partnersIntroducing: number;
  qualifiedReferrals: number;
  relationshipActions: number;
  partnerConversations: number;
  discoveryConversations: number;
  enquiriesReceived: number;
  enquiriesHandled: number;
  enquiryMedianHours: number | null;
};

export type Window = { from: string; to: string; portfolio: WindowPortfolio | null; growth: WindowGrowth | null };
export type ServicePoint = { managed: number; started: number; ended: number };
export type MonthPoint = { month: string; complete: boolean; longTerm: ServicePoint; shortTerm: ServicePoint };
export type FunnelRow = { stage: OpenStage; count: number; valueCents: number; withEstimate: number; averageDays: number | null; stalled: number; followUpsDue: number };
export type Economics = {
  longTerm: { properties: number; withRent: number; averageWeeklyRentCents: number | null; withPercent: number; averageFeePercent: number | null; withFee: number; annualFeesCents: number };
  shortTerm: { properties: number; withFee: number; withPercent: number; averageFeePercent: number | null; annualFeesCents: number };
  handoverOpen: number;
  ailoLive: number;
  offboarding: number;
};
export type AttentionPartner = { id: string; name: string; status: string; lastContactAt: string | null; nextFollowUpDate: string | null };
export type SourceRow = { id: string; name: string; kind: "organisation" | "contact"; received: number; signed: number };
export type WeekPoint = { week: string; complete: boolean; figures: WindowGrowth };

export const TARGET_KEYS = ["relationship_actions", "discovery_conversations", "qualified", "appraisals", "proposals", "signings"] as const;
export type TargetKey = (typeof TARGET_KEYS)[number];
export type Targets = Partial<Record<TargetKey, number>>;
export const TARGET_LABEL: Record<TargetKey, string> = {
  relationship_actions: "Relationship actions",
  discovery_conversations: "Discovery conversations",
  qualified: "Qualified opportunities",
  appraisals: "Appraisals completed",
  proposals: "Proposals sent",
  signings: "Managements signed",
};
export const TARGET_HINT: Record<TargetKey, string> = {
  relationship_actions: "Calls, meetings, emails and messages with referral partners",
  discovery_conversations: "Calls and meetings logged on a lead",
  qualified: "Leads that reached Qualified for the first time",
  appraisals: "Leads that reached Appraisal completed",
  proposals: "Leads that reached Proposal sent",
  signings: "Managements marked signed",
};

export type CeoOverview = {
  asOf: string;
  generatedAt: string;
  latestChangeAt: string | null;
  period: Window;
  previous: Window | null;
  series: MonthPoint[] | null;
  economics: Economics | null;
  funnel: FunnelRow[] | null;
  conversion: Array<{ stage: FunnelStage; reached: number }> | null;
  partners: { needingAttention: number; attention: AttentionPartner[]; topSources: SourceRow[] } | null;
  weeks: WeekPoint[] | null;
  targets: Targets | null;
  stallRule: { daysInStage: number; quietDays: number };
  notes: string[];
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v) ?? {})) out[k] = num(x);
  return out;
};

function parsePortfolio(v: unknown): WindowPortfolio | null {
  const o = obj(v);
  if (!o) return null;
  return {
    started: num(o.started),
    startedLongTerm: num(o.started_long_term),
    startedShortTerm: num(o.started_short_term),
    ended: num(o.ended),
    endedReasons: counts(o.ended_reasons),
    managedAtStart: num(o.managed_at_start),
    managedAtEnd: num(o.managed_at_end),
    feesAtEndCents: num(o.fees_at_end_cents),
    feesAtEndWithTerms: num(o.fees_at_end_with_terms),
  };
}

export function parseGrowthWindow(v: unknown): WindowGrowth | null {
  const o = obj(v);
  if (!o) return null;
  return {
    newOpportunities: num(o.new_opportunities),
    newBySource: counts(o.new_by_source),
    qualified: num(o.qualified),
    entered: counts(o.entered),
    signed: num(o.signed),
    signedEstimatedValueCents: num(o.signed_estimated_value_cents),
    signedFromPartners: num(o.signed_from_partners),
    lost: num(o.lost),
    lostReasons: counts(o.lost_reasons),
    referralsReceived: num(o.referrals_received),
    referralsSent: num(o.referrals_sent),
    partnersIntroducing: num(o.partners_introducing),
    qualifiedReferrals: num(o.qualified_referrals),
    relationshipActions: num(o.relationship_actions),
    partnerConversations: num(o.partner_conversations),
    discoveryConversations: num(o.discovery_conversations),
    enquiriesReceived: num(o.enquiries_received),
    enquiriesHandled: num(o.enquiries_handled),
    enquiryMedianHours: numOrNull(o.enquiry_median_hours),
  };
}

function parseWindow(v: unknown): Window | null {
  const o = obj(v);
  if (!o || !str(o.from) || !str(o.to)) return null;
  return { from: str(o.from)!, to: str(o.to)!, portfolio: parsePortfolio(o.portfolio), growth: parseGrowthWindow(o.growth) };
}

const point = (v: unknown): ServicePoint => {
  const o = obj(v) ?? {};
  return { managed: num(o.managed), started: num(o.started), ended: num(o.ended) };
};

export function parseTargets(v: unknown): Targets | null {
  const o = obj(v);
  if (!o) return null;
  const out: Targets = {};
  for (const k of TARGET_KEYS) {
    const x = o[k];
    if (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1000) out[k] = x;
  }
  return Object.keys(out).length ? out : null;
}

/** The jsonb from hq.ceo_overview(), checked into a typed shape; null when it is not that shape. */
export function parseCeoOverview(raw: unknown): CeoOverview | null {
  const r = obj(raw);
  if (!r || !str(r.as_of)) return null;
  const period = parseWindow(r.period);
  if (!period) return null;
  const isOpen = (s: unknown): s is OpenStage => typeof s === "string" && (OPEN_STAGES as readonly string[]).includes(s);
  const isStage = (s: unknown): s is FunnelStage => typeof s === "string" && (FUNNEL_STAGES as readonly string[]).includes(s);
  const p = obj(r.partners);
  const e = obj(r.economics);
  const lt = obj(e?.long_term) ?? {};
  const st = obj(e?.short_term) ?? {};
  const rule = obj(r.stall_rule) ?? {};
  return {
    asOf: str(r.as_of)!,
    generatedAt: str(r.generated_at) ?? "",
    latestChangeAt: str(r.latest_change_at),
    period,
    previous: parseWindow(r.previous),
    series: arr(r.series)?.map((m) => {
      const o = obj(m) ?? {};
      return { month: str(o.month) ?? "", complete: o.complete === true, longTerm: point(o.long_term), shortTerm: point(o.short_term) };
    }).filter((m) => m.month) ?? null,
    economics: e
      ? {
          longTerm: {
            properties: num(lt.properties),
            withRent: num(lt.with_rent),
            averageWeeklyRentCents: numOrNull(lt.average_weekly_rent_cents),
            withPercent: num(lt.with_percent),
            averageFeePercent: numOrNull(lt.average_fee_percent),
            withFee: num(lt.with_fee),
            annualFeesCents: num(lt.annual_fees_cents),
          },
          shortTerm: {
            properties: num(st.properties),
            withFee: num(st.with_fee),
            withPercent: num(st.with_percent),
            averageFeePercent: numOrNull(st.average_fee_percent),
            annualFeesCents: num(st.annual_fees_cents),
          },
          handoverOpen: num(e.handover_open),
          ailoLive: num(e.ailo_live),
          offboarding: num(e.offboarding),
        }
      : null,
    funnel:
      arr(r.funnel)
        ?.map((f) => obj(f) ?? {})
        .filter((f) => isOpen(f.stage))
        .map((f) => ({
          stage: f.stage as OpenStage,
          count: num(f.count),
          valueCents: num(f.value_cents),
          withEstimate: num(f.with_estimate),
          averageDays: numOrNull(f.average_days),
          stalled: num(f.stalled),
          followUpsDue: num(f.follow_ups_due),
        })) ?? null,
    conversion:
      arr(r.conversion)
        ?.map((c) => obj(c) ?? {})
        .filter((c) => isStage(c.stage))
        .map((c) => ({ stage: c.stage as FunnelStage, reached: num(c.reached) })) ?? null,
    partners: p
      ? {
          needingAttention: num(p.needing_attention),
          attention: (arr(p.attention) ?? []).map((a) => obj(a) ?? {}).filter((a) => str(a.id)).map((a) => ({
            id: str(a.id)!,
            name: str(a.name) ?? "Unnamed",
            status: str(a.status) ?? "",
            lastContactAt: str(a.last_contact_at),
            nextFollowUpDate: str(a.next_follow_up_date),
          })),
          topSources: (arr(p.top_sources) ?? []).map((a) => obj(a) ?? {}).filter((a) => str(a.id)).map((a) => ({
            id: str(a.id)!,
            name: str(a.name) ?? "Unnamed",
            kind: a.kind === "contact" ? "contact" : "organisation",
            received: num(a.received),
            signed: num(a.signed),
          })),
        }
      : null,
    weeks:
      arr(r.weeks)
        ?.map((w) => obj(w) ?? {})
        .filter((w) => str(w.week) && parseGrowthWindow(w.figures))
        .map((w) => ({ week: str(w.week)!, complete: w.complete === true, figures: parseGrowthWindow(w.figures)! })) ?? null,
    targets: parseTargets(r.targets),
    stallRule: { daysInStage: num(rule.days_in_stage) || 21, quietDays: num(rule.quiet_days) || 14 },
    notes: (arr(r.notes) ?? []).filter((n): n is string => typeof n === "string"),
  };
}

// ════════════════════════════════════════════════════════════
// 2. Comparisons
// ════════════════════════════════════════════════════════════

export type Change = { delta: number; pct: number | null; direction: "up" | "down" | "flat" };

/**
 * The change from the comparison period. pct is null when the earlier figure is 0 (a change "from nothing"
 * has no percentage). null altogether when there is no earlier figure.
 */
export function change(current: number, previous: number | null | undefined): Change | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  return { delta, pct: previous === 0 ? null : delta / previous, direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat" };
}

/** "+2 vs the same 3 days of October", "+12% vs ...", "No change vs ...". */
export function changeText(c: Change | null, against: string, money = false, format: (n: number) => string = String): string | null {
  if (!c) return null;
  if (c.direction === "flat") return `No change on ${against}`;
  const sign = c.delta > 0 ? "+" : "−";
  const amount = money ? format(Math.abs(c.delta)) : String(Math.abs(c.delta));
  const pct = c.pct === null ? "" : ` (${sign}${Math.round(Math.abs(c.pct) * 100)}%)`;
  return `${sign}${amount}${pct} on ${against}`;
}

// ════════════════════════════════════════════════════════════
// 3. Portfolio: growth over time, retention, the goal
// ════════════════════════════════════════════════════════════

export type Mix = "all" | "long_term" | "short_term";
export const MIX_LABEL: Record<Mix, string> = { all: "All", long_term: "Long-term", short_term: "Short-term" };

export type GrowthPoint = { month: string; complete: boolean; managed: number; started: number; ended: number; net: number; growthRate: number | null };

/** The months for one mix, with net growth and the monthly growth rate (net over the previous month's managed; null from 0). */
export function growthSeries(series: readonly MonthPoint[], mix: Mix): GrowthPoint[] {
  const pick = (m: MonthPoint): ServicePoint =>
    mix === "long_term"
      ? m.longTerm
      : mix === "short_term"
        ? m.shortTerm
        : { managed: m.longTerm.managed + m.shortTerm.managed, started: m.longTerm.started + m.shortTerm.started, ended: m.longTerm.ended + m.shortTerm.ended };
  return series.map((m, i) => {
    const p = pick(m);
    const before = i > 0 ? pick(series[i - 1]).managed : null;
    const net = p.started - p.ended;
    return { month: m.month, complete: m.complete, managed: p.managed, started: p.started, ended: p.ended, net, growthRate: before && before > 0 ? net / before : null };
  });
}

/** True when nothing in the series has ever been managed (the chart shows its pre-launch state). */
export function seriesIsEmpty(points: readonly GrowthPoint[]): boolean {
  return points.every((p) => p.managed === 0 && p.started === 0 && p.ended === 0);
}

/** Below this many properties at the start of a period, a retention percentage says more about luck than service. */
export const MIN_RETENTION_BASE = 10;

export type Retention = { base: number; lost: number; retained: number; pct: number | null; reasons: Array<{ reason: string; label: string; count: number }> };

/**
 * Owners retained over a period: of the properties managed at its start, how many did not end in it. The
 * percentage only with MIN_RETENTION_BASE properties at the start. Reasons are as recorded ("not recorded" is
 * said, never guessed).
 */
export function retention(p: WindowPortfolio): Retention {
  const base = p.managedAtStart;
  const lost = p.ended;
  const retained = Math.max(0, base - Math.min(lost, base));
  const reasons = Object.entries(p.endedReasons)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ reason, label: END_REASON_LABEL[reason as EndReason] ?? END_REASON_LABEL.other, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { base, lost, retained, pct: base >= MIN_RETENTION_BASE ? retained / base : null, reasons };
}

const MONTH_DAYS = 30.4375;

export type GoalProgress = {
  managed: number;
  target: number;
  pct: number;
  remaining: number;
  goalDate: string | null;
  monthsLeft: number | null;
  /** Signings a month needed to reach the target by the date; null without a date or once it has passed. */
  neededPerMonth: number | null;
  reached: boolean;
  datePassed: boolean;
};

export function goalProgress(managed: number, target: number, goalDate: string | null, today: string): GoalProgress {
  const t = Math.max(1, target);
  const remaining = Math.max(0, t - managed);
  const daysLeft = goalDate ? Math.round((Date.parse(`${goalDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  const monthsLeft = daysLeft === null ? null : Math.max(0, Math.round((daysLeft / MONTH_DAYS) * 10) / 10);
  const datePassed = daysLeft !== null && daysLeft < 0;
  const neededPerMonth = remaining === 0 ? 0 : monthsLeft === null || monthsLeft <= 0 ? null : Math.round((remaining / monthsLeft) * 10) / 10;
  return { managed, target: t, pct: Math.min(1, managed / t), remaining, goalDate, monthsLeft, neededPerMonth, reached: remaining === 0, datePassed };
}

/**
 * The signings a period should hold to stay on pace for the goal: the needed monthly rate over the period's
 * days. A target worked out from the goal, never a figure someone set; null when the goal has no date.
 */
export function signingTarget(neededPerMonth: number | null, days: number): number | null {
  if (neededPerMonth === null) return null;
  return Math.round(((neededPerMonth * days) / MONTH_DAYS) * 10) / 10;
}

// ════════════════════════════════════════════════════════════
// 4. Money: contracted fees and unit economics
// ════════════════════════════════════════════════════════════

export type FeeSummary = {
  /** Contracted yearly management fees (agreements), cents; null when no property has its terms recorded. */
  annualCents: number | null;
  withTerms: number;
  properties: number;
  /** Properties without the terms that give a fee: the figure leaves them out and says so. */
  missing: number;
  perPropertyCents: number | null;
};

export function feeSummary(e: Economics): FeeSummary {
  const properties = e.longTerm.properties + e.shortTerm.properties;
  const withTerms = e.longTerm.withFee + e.shortTerm.withFee;
  const annual = e.longTerm.annualFeesCents + e.shortTerm.annualFeesCents;
  return {
    annualCents: withTerms > 0 ? annual : null,
    withTerms,
    properties,
    missing: Math.max(0, properties - withTerms),
    perPropertyCents: withTerms > 0 ? Math.round(annual / withTerms) : null,
  };
}

/** The weekly rent x 52 x the percentage, in cents (the same sum as hq_private.mp_annual_fee_cents). */
export function annualFeeFromRent(weeklyRentCents: number, feePercent: number): number {
  return Math.round((weeklyRentCents * 52 * feePercent) / 100);
}

/** Dollars typed by a person ("650", "$650.50", "1,200") to cents; null for blank; NaN for nonsense. */
export function dollarsToCents(raw: string): number | null {
  const v = raw.replace(/[$,\s]/g, "");
  if (!v) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(v)) return Number.NaN;
  return Math.round(Number(v) * 100);
}

// ════════════════════════════════════════════════════════════
// 5. The funnel and conversion (from stage history only)
// ════════════════════════════════════════════════════════════

/** Fewer leads than this reached the earlier stage: no conversion rate is shown (two leads is not a rate). */
export const MIN_CONVERSION_BASE = 5;

export type ConversionStep = { from: FunnelStage; to: FunnelStage; base: number; reached: number; rate: number | null };

/** Each step's conversion: of the leads that ever reached a stage, how many went on to the next. */
export function conversionSteps(conversion: ReadonlyArray<{ stage: FunnelStage; reached: number }>): ConversionStep[] {
  const by = new Map(conversion.map((c) => [c.stage, c.reached]));
  const out: ConversionStep[] = [];
  for (let i = 0; i < FUNNEL_STAGES.length - 1; i += 1) {
    const from = FUNNEL_STAGES[i];
    const to = FUNNEL_STAGES[i + 1];
    const base = by.get(from) ?? 0;
    const reached = by.get(to) ?? 0;
    out.push({ from, to, base, reached, rate: base >= MIN_CONVERSION_BASE ? Math.min(1, reached / base) : null });
  }
  return out;
}

/** Introduction to signed, over every lead that has ever been in the pipeline; null below the minimum. */
export function overallConversion(conversion: ReadonlyArray<{ stage: FunnelStage; reached: number }>): number | null {
  const start = conversion.find((c) => c.stage === "introduction_received")?.reached ?? 0;
  const signed = conversion.find((c) => c.stage === "management_signed")?.reached ?? 0;
  return start >= MIN_CONVERSION_BASE ? signed / start : null;
}

export type FunnelTotals = { open: number; valueCents: number; withEstimate: number; stalled: number; followUpsDue: number; qualifiedOrLater: number; proposals: number };

export function funnelTotals(rows: readonly FunnelRow[]): FunnelTotals {
  const qualifiedOrLater: readonly OpenStage[] = ["qualified", "appraisal_requested", "appraisal_completed", "proposal_sent"];
  return rows.reduce<FunnelTotals>(
    (t, r) => ({
      open: t.open + r.count,
      valueCents: t.valueCents + r.valueCents,
      withEstimate: t.withEstimate + r.withEstimate,
      stalled: t.stalled + r.stalled,
      followUpsDue: t.followUpsDue + r.followUpsDue,
      qualifiedOrLater: t.qualifiedOrLater + (qualifiedOrLater.includes(r.stage) ? r.count : 0),
      proposals: t.proposals + (r.stage === "proposal_sent" ? r.count : 0),
    }),
    { open: 0, valueCents: 0, withEstimate: 0, stalled: 0, followUpsDue: 0, qualifiedOrLater: 0, proposals: 0 },
  );
}

// ════════════════════════════════════════════════════════════
// 6. Weekly activity against the targets a director set
// ════════════════════════════════════════════════════════════

export function activityValue(g: WindowGrowth, key: TargetKey): number {
  switch (key) {
    case "relationship_actions":
      return g.relationshipActions;
    case "discovery_conversations":
      return g.discoveryConversations;
    case "qualified":
      return g.qualified;
    case "appraisals":
      return g.entered.appraisal_completed ?? 0;
    case "proposals":
      return g.entered.proposal_sent ?? 0;
    case "signings":
      return g.signed;
  }
}

export type ActivityRow = {
  key: TargetKey;
  label: string;
  hint: string;
  /** Oldest first: the last eight weeks, this week last. */
  series: number[];
  thisWeek: number;
  /** The average of the last four COMPLETE weeks (this week is not finished, so it is not in it). */
  fourWeekAverage: number | null;
  target: number | null;
  /** The last complete week against the target; null without a target. */
  lastWeekMet: boolean | null;
  trend: "up" | "down" | "flat" | null;
};

/**
 * One row a measure. The trend compares the last two complete fortnights (weeks 5-6 against 7-8 ... i.e. the
 * latest two complete weeks against the two before), so one odd week does not swing it.
 */
export function activityRows(weeks: readonly WeekPoint[], targets: Targets | null): ActivityRow[] {
  const complete = weeks.filter((w) => w.complete);
  return TARGET_KEYS.map((key) => {
    const series = weeks.map((w) => activityValue(w.figures, key));
    const done = complete.map((w) => activityValue(w.figures, key));
    const last4 = done.slice(-4);
    const fourWeekAverage = last4.length ? Math.round((last4.reduce((a, b) => a + b, 0) / last4.length) * 10) / 10 : null;
    const target = targets?.[key] ?? null;
    const lastWeek = done.length ? done[done.length - 1] : null;
    const recent = done.slice(-2);
    const before = done.slice(-4, -2);
    const trend = recent.length === 2 && before.length === 2 ? (() => {
      const a = recent[0] + recent[1];
      const b = before[0] + before[1];
      return a > b ? "up" : a < b ? "down" : "flat";
    })() : null;
    return {
      key,
      label: TARGET_LABEL[key],
      hint: TARGET_HINT[key],
      series,
      thisWeek: series.length ? series[series.length - 1] : 0,
      fourWeekAverage,
      target,
      lastWeekMet: target === null || lastWeek === null ? null : lastWeek >= target,
      trend,
    };
  });
}

// ════════════════════════════════════════════════════════════
// 7. The briefing: sentences built only from what the records say
// ════════════════════════════════════════════════════════════

export type BriefingFacts = {
  managed: number | null;
  onboarding: number | null;
  target: number | null;
  goalDate: string | null;
  openOpportunities: number | null;
  proposalsAwaiting: number | null;
  followUpsDue: number | null;
  priorities: number | null;
  launchOpenGates: number | null;
  decisionsForMe: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Two or three sentences. Every clause is present only when its figure was loaded (a role that cannot see
 * properties gets no property sentence), and nothing is said about a figure HQ does not hold.
 */
export function briefing(f: BriefingFacts, formatDate: (d: string) => string): string[] {
  const out: string[] = [];
  if (f.managed !== null && f.target !== null) {
    const goal = f.goalDate ? `${f.target} by ${formatDate(f.goalDate)}` : `${f.target} (no goal date set yet)`;
    if (f.managed === 0) out.push(`Planted manages no properties yet; the goal is ${goal}.`);
    else out.push(`Planted manages ${plural(f.managed, "property", "properties")}${f.onboarding ? ` (${f.onboarding} onboarding)` : ""} against a goal of ${goal}.`);
  }
  const growth: string[] = [];
  if (f.openOpportunities !== null) growth.push(plural(f.openOpportunities, "active opportunity", "active opportunities"));
  if (f.proposalsAwaiting) growth.push(`${plural(f.proposalsAwaiting, "proposal")} awaiting a decision`);
  if (f.followUpsDue) growth.push(`${plural(f.followUpsDue, "lead follow-up")} due or overdue`);
  if (growth.length) out.push(`You have ${joinWords(growth)}.`);
  const today: string[] = [];
  if (f.priorities) today.push(`${plural(f.priorities, "action")} ${f.priorities === 1 ? "needs" : "need"} your attention today`);
  if (f.decisionsForMe) today.push(`${plural(f.decisionsForMe, "decision")} ${f.decisionsForMe === 1 ? "waits" : "wait"} on you`);
  if (f.launchOpenGates) today.push(`${plural(f.launchOpenGates, "launch requirement")} still to meet`);
  if (today.length) out.push(`${capitalise(joinWords(today))}.`);
  return out;
}

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ════════════════════════════════════════════════════════════
// 8. Small formatting helpers the page and report share
// ════════════════════════════════════════════════════════════

/** "12%", "4.5%", "—" for null. */
export function pctText(v: number | null, digits = 0): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${digits ? (Math.round(p * 10 ** digits) / 10 ** digits).toFixed(digits) : Math.round(p)}%`;
}

/** "3.5 hours", "2 days" for a response time. */
export function hoursText(h: number | null): string | null {
  if (h === null || !Number.isFinite(h)) return null;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  if (h < 48) return `${Math.round(h * 10) / 10} hours`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov", or "Nov 2026" with the year. */
export function monthShort(d: string, withYear = false): string {
  const m = Number(d.slice(5, 7)) - 1;
  return `${MONTHS[m] ?? ""}${withYear ? ` ${d.slice(0, 4)}` : ""}`;
}
