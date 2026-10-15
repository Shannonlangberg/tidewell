/*
 * Reports: the daily brief, the growth report, the contractor report and the weekly report. Every
 * figure comes from a database function or view (growth_summary, partner_performance,
 * contractor_summary, contractor_expiry_watch, the task views), read as the person. Nothing is
 * estimated or filled in; an empty section says it is empty, and a section the person's role
 * cannot see says so rather than pretending to be zero.
 */
import { CONTRACTOR_CATEGORY_LABEL, CONTRACTOR_STATUS_LABEL, type ContractorCategory, type ContractorStatus } from "../../constants";
import { parseContractorSummary } from "../../contractors/widgets-summary";
import { formatAud } from "../../format";
import { formatConversion } from "../../referrals/numbers";
import { countAdditionalClaims, loadGrowthSummary } from "../../referrals/queries";
import { GROWTH_PERIOD_LABEL, growthPeriodStart, growthPeriodTitle, shiftDays, type GrowthPeriod } from "../../referrals/periods";
import { buildPredicate, plainQuery } from "../../tasks/rules";
import { countTasks, listTasks as loadTasks } from "../../tasks/queries";
import { HQ_PATHS, clean, compose, plural, result } from "./core";
import { can, day, defineTool, link, logDb, respond, today, type ToolContext } from "./kit";
import { stageLabel } from "./records";
import { contractorReportShape, dailyBriefShape, growthReportShape, weeklyReportShape } from "./schemas";

type Section = { title: string; summary: string; lines: string[]; figures: Record<string, unknown> };

const notIncluded = (title: string, capability: string): Section => ({
  title,
  summary: `Not included: your role does not include ${capability}.`,
  lines: [],
  figures: { included: false },
});

function sectionsText(head: string, sections: Section[], tail?: string): string {
  // Summaries are the tool's own sentences built from figures; record text (names, titles) goes in one data block.
  const summary = sections.map((s) => `${s.title}: ${s.summary}`).join("\n");
  const data = sections.flatMap((s) => (s.lines.length ? [`${s.title}:`, ...s.lines] : []));
  return compose({ head: [head, "", summary], data, tail: tail ?? null });
}

// ── sections ─────────────────────────────────────────────────

async function myTasksSection(ctx: ToolContext, opts: { upcomingDays?: number } = {}): Promise<Section> {
  const pctx = { meId: ctx.staff.id, today: today(ctx), now: new Date() };
  const overdueP = buildPredicate(plainQuery("overdue"), pctx);
  const todayP = buildPredicate(plainQuery("today"), pctx);
  const canG = can(ctx, "growth.read");
  const canC = can(ctx, "contractors.read");
  const [overdue, dueToday] = await Promise.all([
    loadTasks(ctx.db, overdueP, { sort: "due", dir: "asc", page: 1, pageSize: 8, canGrowth: canG, canContractors: canC }),
    loadTasks(ctx.db, todayP, { sort: "priority", dir: "desc", page: 1, pageSize: 8, canGrowth: canG, canContractors: canC }),
  ]);
  if (!overdue.ok || !dueToday.ok) throw new Error("tasks section");
  let upcoming: number | null = null;
  if (opts.upcomingDays) {
    upcoming = await countTasks(ctx.db, { ...buildPredicate(plainQuery("mine"), pctx), due: { gt: pctx.today, lte: shiftDays(pctx.today, opts.upcomingDays) } });
  }
  const lines = [
    ...overdue.data.rows.map((r) => `- OVERDUE: ${clean(r.title)} (due ${day(ctx, r.dueDate)}) [id: ${r.id}]`),
    ...dueToday.data.rows.map((r) => `- Today: ${clean(r.title)} (${r.priority} priority) [id: ${r.id}]`),
  ];
  const parts = [`${overdue.data.total} overdue`, `${dueToday.data.total} due today`];
  if (upcoming !== null) parts.push(`${upcoming} due in the next ${opts.upcomingDays} days`);
  return {
    title: "Your tasks",
    summary: overdue.data.total + dueToday.data.total === 0 && !upcoming ? "nothing overdue or due today." : `${parts.join(", ")}.`,
    lines,
    figures: { overdue: overdue.data.total, due_today: dueToday.data.total, ...(upcoming !== null ? { upcoming } : {}) },
  };
}

async function followUpsSection(ctx: ToolContext): Promise<Section> {
  if (!can(ctx, "growth.read")) return notIncluded("Partner follow-ups", "growth.read");
  const t = today(ctx);
  const [overdue, dueToday] = await Promise.all([
    ctx.db.from("overdue_followups").select("contact_id, full_name, organisation_name, next_follow_up_date, relationship_owner_id", { count: "exact" }).order("next_follow_up_date").limit(8),
    ctx.db.from("contact_directory").select("id, full_name, organisation_name", { count: "exact" }).eq("next_follow_up_date", t).neq("relationship_status", "inactive").order("full_name").limit(8),
  ]);
  if (overdue.error) {
    logDb("brief follow-ups", overdue.error);
    throw new Error("follow-ups");
  }
  if (dueToday.error) {
    logDb("brief follow-ups today", dueToday.error);
    throw new Error("follow-ups today");
  }
  const o = overdue.count ?? 0;
  const d = dueToday.count ?? 0;
  const lines = [
    ...(overdue.data ?? []).map((r) => `- Overdue since ${day(ctx, r.next_follow_up_date)}: ${clean(r.full_name)} (${clean(r.organisation_name ?? "independent")})${r.relationship_owner_id === ctx.staff.id ? " - yours" : ""} [id: ${r.contact_id}]`),
    ...(dueToday.data ?? []).map((r) => `- Due today: ${clean(r.full_name)} (${clean(r.organisation_name ?? "independent")}) [id: ${r.id}]`),
  ];
  return { title: "Partner follow-ups", summary: o + d === 0 ? "none overdue or due today." : `${o} overdue, ${d} due today (whole team).`, lines, figures: { overdue: o, due_today: d } };
}

async function expiriesSection(ctx: ToolContext): Promise<Section> {
  if (!can(ctx, "contractors.read")) return notIncluded("Contractor expiries", "contractors.read");
  const { data, error, count } = await ctx.db
    .from("contractor_expiry_watch")
    .select("contractor_id, business_name, contractor_status, kind, document_type, expires_on, days_remaining", { count: "exact" })
    .order("days_remaining")
    .limit(6);
  if (error) {
    logDb("brief expiries", error);
    throw new Error("expiries");
  }
  const rows = data ?? [];
  const expired = rows.filter((r) => (r.days_remaining ?? 0) < 0).length;
  const lines = rows.map((r) => {
    const what = r.kind === "document" ? `${(r.document_type ?? "document").replace(/_/g, " ")} document` : r.kind;
    const d = r.days_remaining ?? 0;
    return `- ${clean(r.business_name)}: ${what} ${d < 0 ? `expired ${day(ctx, r.expires_on)}` : `expires ${day(ctx, r.expires_on)} (${d} days)`}${(r.contractor_status === "approved" || r.contractor_status === "preferred") && d < 0 ? " - still approved, needs a decision" : ""} [id: ${r.contractor_id}]`;
  });
  return {
    title: "Contractor expiries",
    summary: (count ?? 0) === 0 ? "nothing expired or expiring within the warning window." : `${plural(count ?? 0, "item")} expired or expiring soon${expired ? ` (at least ${expired} already expired)` : ""}.`,
    lines,
    figures: { items: count ?? 0 },
  };
}

async function newReferralsSection(ctx: ToolContext, since: string, label: string): Promise<Section> {
  if (!can(ctx, "growth.read")) return notIncluded("New referrals", "growth.read");
  const { data, error, count } = await ctx.db
    .from("referral_overview")
    .select("id, ref_label, direction, referral_date, prospect_name, partner_organisation_name, partner_contact_name, stage", { count: "exact" })
    .gte("referral_date", since)
    .order("referral_date", { ascending: false })
    .limit(8);
  if (error) {
    logDb("brief referrals", error);
    throw new Error("referrals");
  }
  const rows = data ?? [];
  const received = rows.filter((r) => r.direction === "received").length;
  const lines = rows.map(
    (r) =>
      `- ${r.ref_label} ${day(ctx, r.referral_date)} ${r.direction} ${r.direction === "received" ? "from" : "to"} ${clean([r.partner_contact_name, r.partner_organisation_name].filter(Boolean).join(", ") || "partner not recorded")}: ${clean(r.prospect_name ?? "no prospect name")}${r.direction === "received" ? ` (${stageLabel(r.stage)})` : ""} [id: ${r.id}]`,
  );
  return {
    title: "New referrals",
    summary: (count ?? 0) === 0 ? `none recorded ${label}.` : `${plural(count ?? 0, "referral")} recorded ${label}${rows.length < (count ?? 0) ? "" : ` (${received} received, ${rows.length - received} sent)`}.`,
    lines,
    figures: { count: count ?? 0 },
  };
}

const COUNTING_RULES = [
  "How these are counted (from hq.growth_summary):",
  "- Referrals received and sent: by referral date within the period. A further claim on a prospect already in the pipeline is a real referral but not a new prospect.",
  "- Qualified: prospects that first reached qualified (or a later stage) within the period, read from the stage history.",
  "- Managements signed: by signed date within the period, each counted once and credited to one source, however many partners claim it.",
  "- Conversion: managements signed divided by referrals received in the same period (shown as a dash when none were received).",
  "- Estimated value: the sum of the estimated annual values recorded on the signed managements (estimates, not revenue).",
  "- Partner figures below are all time (hq.partner_performance), not just this period.",
].join("\n");

async function growthSection(ctx: ToolContext, since: string, periodText: string): Promise<{ section: Section; partners: string[] }> {
  if (!can(ctx, "growth.read")) return { section: notIncluded("Growth", "growth.read"), partners: [] };
  const [summary, claims, partners] = await Promise.all([
    loadGrowthSummary(ctx.db, since),
    countAdditionalClaims(ctx.db, since),
    ctx.db.from("partner_performance").select("organisation_name, received, sent, qualified, signed, conversion, estimated_value_signed_cents").or("received.gt.0,sent.gt.0").order("signed", { ascending: false }).order("received", { ascending: false }).limit(5),
  ]);
  if (!summary.ok) throw new Error("growth_summary");
  if (partners.error) {
    logDb("partner_performance", partners.error);
    throw new Error("partner_performance");
  }
  const s = summary.data;
  const figures = {
    since: s.since,
    as_of: s.asOf,
    referrals_received: s.referralsReceived,
    further_claims: claims,
    referrals_sent: s.referralsSent,
    qualified: s.qualified,
    managements_signed: s.managementsSigned,
    conversion: s.conversion,
    estimated_value_signed_cents: s.estimatedValueSignedCents,
    active_opportunities: s.activeOpportunities,
    overdue_followups: s.overdueFollowups,
    contacts_not_contacted_30d: s.contactsNotContacted30d,
  };
  const nothing = s.referralsReceived === 0 && s.referralsSent === 0 && s.managementsSigned === 0 && s.qualified === 0;
  const summaryText = nothing
    ? `no referrals, qualified prospects or signed managements recorded ${periodText}. ${s.activeOpportunities} prospects are open in the pipeline; ${s.overdueFollowups} partner follow-ups are overdue.`
    : `${periodText}: ${s.referralsReceived} referrals received${claims ? ` (${claims} of them further claims on prospects already in the pipeline)` : ""}, ${s.referralsSent} sent, ${s.qualified} reached qualified, ${s.managementsSigned} managements signed (conversion ${formatConversion(s.conversion)}), estimated annual value signed ${formatAud(s.estimatedValueSignedCents) || "$0"}. Now: ${s.activeOpportunities} open prospects, ${s.overdueFollowups} overdue partner follow-ups, ${s.contactsNotContacted30d} active contacts not contacted in 30 days.`;
  const partnerLines = (partners.data ?? []).map(
    (p) => `- ${clean(p.organisation_name)}: ${p.received} received, ${p.sent} sent, ${p.qualified} qualified, ${p.signed} signed (conversion ${formatConversion(p.conversion)})${p.estimated_value_signed_cents ? `, est. ${formatAud(p.estimated_value_signed_cents)}/yr signed` : ""}`,
  );
  return { section: { title: "Growth", summary: summaryText, lines: [], figures }, partners: partnerLines };
}

async function contractorSection(ctx: ToolContext): Promise<{ section: Section; coverage: string[] }> {
  if (!can(ctx, "contractors.read")) return { section: notIncluded("Contractors", "contractors.read"), coverage: [] };
  const { data, error } = await ctx.db.rpc("contractor_summary");
  if (error) {
    logDb("contractor_summary", error);
    throw new Error("contractor_summary");
  }
  const s = parseContractorSummary(data);
  const byStatus = (data as { by_status?: Record<string, number> } | null)?.by_status ?? {};
  const statusText = (Object.keys(CONTRACTOR_STATUS_LABEL) as ContractorStatus[])
    .filter((k) => (byStatus[k] ?? 0) > 0)
    .map((k) => `${byStatus[k]} ${CONTRACTOR_STATUS_LABEL[k].toLowerCase()}`)
    .join(", ");
  const label = (c: string) => (c in CONTRACTOR_CATEGORY_LABEL ? CONTRACTOR_CATEGORY_LABEL[c as ContractorCategory] : c);
  const covered = s.coverage.filter((r) => r.total > 0).map((r) => `- ${label(r.category)}: ${r.approved} approved, ${r.preferred} preferred`);
  const summary =
    s.total === 0
      ? "no contractors are recorded yet."
      : `${plural(s.total, "contractor")} (${statusText || "none by status"}). ${s.awaitingVetting} awaiting vetting. ${s.expired} expired and ${s.expiringSoon} expiring-soon items${s.clearedWithExpiredItems ? `; ${s.clearedWithExpiredItems} approved or preferred contractors have something expired and need a decision` : ""}. ${
          s.tradesWithoutCover.length ? `Trades with no approved or preferred contractor: ${s.tradesWithoutCover.map(label).join(", ")}.` : "Every trade has at least one approved or preferred contractor."
        }`;
  return {
    section: {
      title: "Contractors",
      summary,
      lines: [],
      figures: { total: s.total, by_status: byStatus, awaiting_vetting: s.awaitingVetting, expired: s.expired, expiring_soon: s.expiringSoon, cleared_with_expired_items: s.clearedWithExpiredItems, trades_without_cover: s.tradesWithoutCover },
    },
    coverage: covered,
  };
}

// ── the tools ────────────────────────────────────────────────

export const dailyBrief = defineTool({
  name: "daily_brief",
  title: "Daily brief",
  description:
    "Today's brief for you: your overdue and due-today tasks, partner follow-ups overdue or due today, contractor licences/insurance/documents expired or expiring soon, and referrals recorded since yesterday. Sections your role cannot see are named as not included, never shown as zero. Read-only.",
  inputSchema: dailyBriefShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: null,
  kind: "read",
  handler: async (_args, ctx) => {
    const t = today(ctx);
    const sections = await Promise.all([myTasksSection(ctx), followUpsSection(ctx), expiriesSection(ctx), newReferralsSection(ctx, shiftDays(t, -1), "since yesterday")]);
    const text = sectionsText(`Daily brief for ${ctx.staff.fullName}, ${day(ctx, t)}. HQ: ${link(ctx, HQ_PATHS.dashboard())}`, sections);
    return result("ok", text, { date: t, sections: Object.fromEntries(sections.map((s) => [s.title, s.figures])) });
  },
});

export const growthReport = defineTool({
  name: "growth_report",
  title: "Growth report",
  description:
    "Referral and pipeline figures for a period (this month, last 30 days, financial year to date, or all time) from hq.growth_summary: referrals received and sent, qualified, managements signed, conversion, estimated value signed, plus the top partners (all time). States the period and exactly how each figure is counted. Read-only; figures are never estimated.",
  inputSchema: growthReportShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "growth.read",
  kind: "read",
  handler: async ({ period }, ctx) => {
    const p: GrowthPeriod = period ?? "30d";
    const t = today(ctx);
    const since = growthPeriodStart(p, t);
    const periodText = p === "all" ? "All time" : `${growthPeriodTitle(p, t)} (${day(ctx, since)} to ${day(ctx, t)})`;
    const { section, partners } = await growthSection(ctx, since, periodText);
    if (section.figures.included === false) return result("refused", `Refused: ${section.summary} Nothing was read.`);
    const text = compose({
      head: [`Growth report: ${periodText}. Growth overview: ${link(ctx, HQ_PATHS.growth())}`, "", section.summary, "", COUNTING_RULES],
      data: partners.length ? ["Top partners (all time):", ...partners] : null,
      tail: partners.length ? null : "Partners: no partner has a referral recorded yet.",
    });
    return result("ok", text, { period: p, period_label: GROWTH_PERIOD_LABEL[p], ...section.figures });
  },
});

export const contractorReport = defineTool({
  name: "contractor_report",
  title: "Contractor report",
  description:
    "The contractor position from hq.contractor_summary: counts by status, how many are awaiting vetting, expired and expiring items (and cleared contractors with something expired), and preferred coverage per trade, naming the trades with no approved or preferred contractor. Read-only.",
  inputSchema: contractorReportShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: "contractors.read",
  kind: "read",
  handler: async (_args, ctx) => {
    const { section, coverage } = await contractorSection(ctx);
    return respond("ok", [`Contractor report, ${day(ctx, today(ctx))}. Directory: ${link(ctx, HQ_PATHS.partners())}`, "", section.summary], coverage.length ? ["Trades with cover:", ...coverage] : null, section.figures);
  },
});

export const weeklyReport = defineTool({
  name: "weekly_report",
  title: "Weekly report",
  description:
    "A plain-language summary of the last seven days: growth figures (from hq.growth_summary, counted as growth_report explains), referrals recorded, your tasks (overdue, due today, due in the next seven days), partner follow-ups, and the contractor position and expiries. Sections your role cannot see are named as not included. Read-only.",
  inputSchema: weeklyReportShape,
  annotations: { readOnlyHint: true, openWorldHint: false },
  capability: null,
  kind: "read",
  handler: async (_args, ctx) => {
    const t = today(ctx);
    const since = shiftDays(t, -7);
    const periodText = `The last 7 days (${day(ctx, since)} to ${day(ctx, t)})`;
    const [growth, referrals, tasks, followUps, contractors, expiries] = await Promise.all([
      growthSection(ctx, since, periodText),
      newReferralsSection(ctx, since, "in the last 7 days"),
      myTasksSection(ctx, { upcomingDays: 7 }),
      followUpsSection(ctx),
      contractorSection(ctx),
      expiriesSection(ctx),
    ]);
    const sections = [growth.section, referrals, tasks, followUps, contractors.section, expiries];
    const head = `Weekly report for ${ctx.staff.fullName}: ${periodText}. HQ: ${link(ctx, HQ_PATHS.dashboard())}`;
    const tail = can(ctx, "growth.read") ? "Growth figures are counted as growth_report explains (by referral date, signed date, first reached qualified)." : null;
    const text = sectionsText(head, sections, tail ?? undefined);
    return result("ok", text, { since, as_of: t, sections: Object.fromEntries(sections.map((s) => [s.title, s.figures])) });
  },
});
